# QR勤怠システム

QRコード（またはPIN）で出退勤を打刻し、管理画面で記録の確認・出勤簿（Excel）の作成をするシステムです。
打刻用タブレット（ブラウザ版・Androidアプリ版）と管理用PCで、同じデータを使います。

詳しい仕様・ファイルの役割は `CLAUDE.md` にまとめています。

## 主な機能

- **打刻** — 出勤・休憩・戻り・退勤。QRコード（中身は従業員ID）か従業員PIN（4桁）で本人を確認
- **退勤時の業務入力** — 業務ごとの時間、本日の交通費。先週や過去の日の内容をコピーできる
- **勤務確認** — 従業員が自分の勤務と業務を確認・修正（今月と先月まで）
- **管理画面** — 記録一覧と勤務記録の編集、出勤簿・給与（Excel）、従業員管理、QR印刷、設定（管理者PIN・打刻端末・業務・最低賃金・交通費）
- **オフライン** — 打刻・業務は端末に保存してから送信。通信が戻ると自動で再送（二重登録にならない）

## 構成

- 画面：React 18 + Vite（CSS Modules）
- 公開：Cloudflare Pages、API：Pages Functions（`functions/api/[[route]].js`）
- データ：Cloudflare D1（テーブル定義は `schema.sql`）
- Androidアプリ版：Capacitor
- 案件ごとに Pages プロジェクトと D1 データベースを分ける（案件ID `abc` → `kintai-abc`）

## セットアップ・デプロイ

事前に `npm install --legacy-peer-deps` と `npx wrangler login` を済ませておきます。

```
node setup-new-client.js                  新しい案件を作る（DB作成→管理者PIN設定→デプロイ）
node setup-new-client.js --deploy <案件ID>  1つの案件に最新のコードを反映
node setup-new-client.js --deploy-all     全案件に最新のコードを反映
```

## ローカルで動かす

```
npx wrangler d1 execute qr-attendance-db --local --file=./schema.sql
npm run build
npx wrangler pages dev dist
```

管理者PINはサーバーにハッシュで保存します。ローカルでは、初回だけ一時的なPINを入れてログインすると
自動でハッシュに置き換わります（その後、管理画面の 設定 → 管理者PIN変更 で6桁に変更）。

```
npx wrangler d1 execute qr-attendance-db --local --command "INSERT INTO config (key,value) VALUES ('adminPin','123456')"
```

## 権限

- 管理画面は管理者PIN（6桁）でログイン。PINはサーバー側でのみ照合し、5回続けて間違えると15分ロック
- 打刻端末は最初に管理者PINで登録する。登録した端末ができるのは打刻・従業員の呼び出し・本人の勤務確認だけ
- 登録済みの端末は 設定 →「打刻端末」で確認・解除できる

## バックアップ

`backup-repo/` に毎日の自動バックアップ（暗号化）一式があります。使い方は `backup-repo/README.md`。
