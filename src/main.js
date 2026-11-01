const RSS_URL = 'https://www.sakura.ad.jp/rss/mainte.rdf';
const ARTICLE_PREFIX = 'ARTICLE:';
const MAX_VALUE_BYTES = 8 * 1024;
const MAX_STORE_BYTES = 400 * 1024;

function checkSakuraNews() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const properties = PropertiesService.getScriptProperties();
    const saved = properties.getProperties();
    if (!saved.WEBHOOK_ID || !saved.WEBHOOK_SECRET) {
      throw new Error('WEBHOOK_ID and WEBHOOK_SECRET are required');
    }
    if (saved.INITIALIZED && saved.INITIALIZED !== '1') {
      throw new Error('Invalid INITIALIZED property');
    }

    const articles = fetchArticles();
    const projected = { ...saved, INITIALIZED: '1' };
    for (const article of articles) {
      if (byteLength(article.snapshot) > MAX_VALUE_BYTES) {
        throw new Error(`RSS item is too large: ${article.guid}`);
      }
      projected[ARTICLE_PREFIX + article.guid] = article.snapshot;
    }
    if (byteLength(JSON.stringify(projected)) > MAX_STORE_BYTES) {
      throw new Error('Script Properties are close to the storage limit');
    }

    if (!saved.INITIALIZED) {
      for (const article of articles) {
        properties.setProperty(ARTICLE_PREFIX + article.guid, article.snapshot);
      }
      properties.setProperty('INITIALIZED', '1');
      return;
    }

    for (const article of articles) {
      const key = ARTICLE_PREFIX + article.guid;
      const previous = saved[key];
      if (previous === article.snapshot) continue;

      const heading = previous == null ? '【さくらインターネット】' : '【更新】';
      const url = article.link.replace(
        /^http:\/\/support\.sakura\.ad\.jp\//,
        'https://support.sakura.ad.jp/'
      );
      postWebhook(saved.WEBHOOK_ID, saved.WEBHOOK_SECRET, `${heading}${article.title}\n${url}`);
      properties.setProperty(key, article.snapshot);
    }
  } finally {
    lock.releaseLock();
  }
}

function fetchArticles() {
  const response = UrlFetchApp.fetch(RSS_URL);
  if (response.getResponseCode() !== 200) throw new Error('RSS fetch failed');

  const root = XmlService.parse(response.getContentText('UTF-8')).getRootElement();
  if (root.getName() !== 'rss') throw new Error('Unexpected RSS root');
  const channel = root.getChild('channel');
  if (!channel) throw new Error('RSS channel is missing');
  const items = channel.getChildren('item');
  if (items.length === 0) throw new Error('RSS has no items');

  const articles = [];
  const seen = new Set();
  for (const item of items) {
    const title = itemText(item, 'title');
    if (!title) throw new Error('RSS item title is missing');
    if (!/^\[(障害|メンテナンス)\]/.test(title) || !title.includes('さくらのVPS')) continue;

    const guid = itemText(item, 'guid');
    const link = itemText(item, 'link');
    const pubDate = itemText(item, 'pubDate');
    const description = itemText(item, 'description');
    if (!guid || !link || !pubDate || seen.has(guid)) {
      throw new Error(`Invalid RSS item: ${guid || title}`);
    }
    const timestamp = Date.parse(pubDate);
    if (Number.isNaN(timestamp)) throw new Error(`Invalid pubDate: ${guid}`);
    seen.add(guid);
    articles.push({
      guid,
      link,
      title,
      timestamp,
      snapshot: JSON.stringify([new Date(timestamp).toISOString(), title, description, link])
    });
  }
  return articles.sort((a, b) => a.timestamp - b.timestamp || a.guid.localeCompare(b.guid));
}

function itemText(item, name) {
  return (item.getChildText(name) || '').trim();
}

function byteLength(value) {
  return Utilities.newBlob(value).getBytes().length;
}

function postWebhook(id, secret, message) {
  const signature = Utilities.computeHmacSignature(
    Utilities.MacAlgorithm.HMAC_SHA_1,
    message,
    secret,
    Utilities.Charset.UTF_8
  ).map(byte => (byte & 255).toString(16).padStart(2, '0')).join('');

  const response = UrlFetchApp.fetch(`https://q.trap.jp/api/v3/webhooks/${encodeURIComponent(id)}`, {
    method: 'post',
    contentType: 'text/plain; charset=utf-8',
    headers: { 'X-TRAQ-Signature': signature },
    payload: message
  });
  if (response.getResponseCode() !== 204) throw new Error('traQ webhook post failed');
}
