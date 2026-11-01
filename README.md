# Sakura News Notifier

さくらインターネットの [RSS](https://www.sakura.ad.jp/rss/mainte.rdf) を15分ごとに確認し、タイトルに「さくらのVPS」を含む障害・メンテナンス記事の新規掲載と更新をtraQへ通知する。

## 初期設定

Node.jsとnpmは[mise](https://mise.jdx.dev/)で管理する。

1. traQでWebhookを作成し、シークレットを設定する。
3. スタンドアロンのGASプロジェクトを作成し、Apps Script APIを有効化。リポジトリ直下に`.clasp.json`を作成。

   ```json
   {"scriptId":"GASのスクリプトID","rootDir":"src"}
   ```

4. コードをGASへ反映

   ```sh
   mise trust
   mise install
   mise exec -- npm ci
   mise exec -- npx clasp login
   mise exec -- npx clasp push
   ```

5. GASの「プロジェクトの設定」でスクリプトプロパティを設定

   | キー | 値 |
   | --- | --- |
   | `WEBHOOK_ID` | Webhook ID |
   | `WEBHOOK_SECRET` | Webhookシークレット |

6. GAS上で`checkSakuraNews`を手動で実行し、正常に動くことを確認
7. 同じアカウントで`checkSakuraNews`のトリガーを15分間隔で設定


## 開発と更新

テスト：`mise exec -- npm test` を実行する。Node.jsとnpmのバージョンは`mise.toml`で更新する。
