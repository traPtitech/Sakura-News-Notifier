const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');

function article(id, changes = {}) {
  return {
    title: '[障害] さくらのVPSの一部',
    guid: `http://support.sakura.ad.jp/mainte/mainteentry.php?id=${id}`,
    link: `http://support.sakura.ad.jp/mainte/mainteentry.php?id=${id}`,
    pubDate: 'Fri, 30 Oct 2026 17:46:28 +0900',
    description: '障害が発生しました',
    ...changes
  };
}

function createTestEnvironment(feed, failAt = 0) {
  const values = new Map(Object.entries({ WEBHOOK_ID: 'webhook-id', WEBHOOK_SECRET: 'secret' }));
  const posts = [];
  const context = {
    LockService: {
      getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} })
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperties: () => Object.fromEntries(values),
        setProperty: (key, value) => values.set(key, value)
      })
    },
    UrlFetchApp: {
      fetch: (url, options) => {
        if (url === 'https://www.sakura.ad.jp/rss/mainte.rdf') {
          return { getResponseCode: () => 200, getContentText: () => '<rss />' };
        }
        posts.push({ url, options });
        if (posts.length === failAt) throw new Error('Webhook failed');
        return { getResponseCode: () => 204 };
      }
    },
    XmlService: {
      parse: () => ({
        getRootElement: () => ({
          getName: () => 'rss',
          getChild: name => name === 'channel' ? {
            getChildren: name => name === 'item' ? feed.map(fields => ({
              getChildText: name => fields[name] ?? null
            })) : []
          } : null
        })
      })
    },
    Utilities: {
      newBlob: value => ({ getBytes: () => Buffer.from(value, 'utf8') }),
      computeHmacSignature: (algorithm, message, secret, charset) => {
        assert.equal(algorithm, 'HMAC_SHA_1');
        assert.equal(charset, 'UTF_8');
        return Array.from(crypto.createHmac('sha1', secret).update(message, 'utf8').digest(),
          byte => byte > 127 ? byte - 256 : byte);
      },
      MacAlgorithm: { HMAC_SHA_1: 'HMAC_SHA_1' },
      Charset: { UTF_8: 'UTF_8' }
    }
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return {
    run: () => context.checkSakuraNews(),
    posts
  };
}

test('notifies matching new and updated articles once', () => {
  const feed = [article(1)];
  const env = createTestEnvironment(feed);
  env.run();
  assert.equal(env.posts.length, 0);

  const incident = article(2);
  const maintenance = article(3, { title: '[メンテナンス] さくらのVPSの一部' });
  feed.push(maintenance, article(4, { title: '[障害] 別サービス' }),
    article(5, { title: '[お知らせ] さくらのVPSの一部' }), incident);
  env.run();
  assert.deepEqual(env.posts.map(post => post.options.payload), [
    `【さくらインターネット】${incident.title}\nhttps://support.sakura.ad.jp/mainte/mainteentry.php?id=2`,
    `【さくらインターネット】${maintenance.title}\nhttps://support.sakura.ad.jp/mainte/mainteentry.php?id=3`
  ]);

  for (const change of [
    { description: '追記しました' },
    { title: '[障害] さくらのVPSの一部（追記）' },
    { pubDate: 'Fri, 30 Oct 2026 17:47:28 +0900' },
    { link: 'https://support.sakura.ad.jp/mainte/mainteentry.php?id=1' }
  ]) {
    feed[0] = { ...feed[0], ...change };
    const before = env.posts.length;
    env.run();
    assert.equal(env.posts.length, before + 1);
    assert.equal(env.posts.at(-1).options.payload,
      `【更新】${feed[0].title}\nhttps://support.sakura.ad.jp/mainte/mainteentry.php?id=1`);
    env.run();
    assert.equal(env.posts.length, before + 1);
  }

  for (const { url, options } of env.posts) {
    assert.equal(url, 'https://q.trap.jp/api/v3/webhooks/webhook-id');
    assert.equal(options.method, 'post');
    assert.equal(options.contentType, 'text/plain; charset=utf-8');
    assert.equal(options.headers['X-TRAQ-Signature'], crypto.createHmac('sha1', 'secret')
      .update(options.payload, 'utf8').digest('hex'));
  }
});

test('retries only the failed article after partial success', () => {
  const feed = [article(1)];
  const env = createTestEnvironment(feed, 2);
  env.run();
  feed.push(article(2), article(3));
  assert.throws(env.run, /Webhook failed/);
  assert.equal(env.posts.length, 2);
  env.run();
  assert.deepEqual(env.posts.slice(2), [env.posts[1]]);
});
