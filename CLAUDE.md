# QR勤怠システム

## 概要
QRコード（またはPIN）で出退勤を打刻するシステム。タブレット（打刻）とPC（管理画面）でデータを共有する。

## 技術スタック
- React 18 + Vite（CSS Modules）
- Cloudflare Pages（画面の公開）+ Pages Functions（API: `functions/api/[[route]].js`）
- Cloudflare D1（SQLite のDB。テーブル定義は `schema.sql`）
- Android アプリ版は Capacitor

Firebase 版はデモ用として `firebase-demo` ブランチに残している（このブランチとは別物）。

## 案件ごとの構成
- Cloudflare アカウントは1つ。案件ごとに Pages プロジェクトと D1 データベースを分ける
- 案件ID `abc` → プロジェクト名・DB名とも `kintai-abc`、URL は `https://kintai-abc.pages.dev`
- コードは全案件共通

## セットアップ・デプロイ（Windows）
事前に `npm install --legacy-peer-deps` と `npx wrangler login` を済ませておく。
```
node setup-new-client.js                  新しい案件を作る（DB作成→管理者PIN設定→デプロイ）
node setup-new-client.js --deploy <案件ID>  1つの案件に最新のコードを反映
node setup-new-client.js --deploy-all     全案件に最新のコードを反映
```
- 同じ案件IDで新規作成しようとするとエラーになり、既存データは上書きされない
- 新規作成時に Firebase のプロジェクトIDを入れると、そのデータを引き継ぐ
- ルートの `wrangler.toml` はローカル開発専用（本番デプロイには使わない）

## ローカルで動かす
```
npx wrangler d1 execute qr-attendance-db --local --file=./schema.sql
npx wrangler d1 execute qr-attendance-db --local --command "INSERT INTO config (key,value) VALUES ('adminPin','1234')"
npm run build
npx wrangler pages dev dist
```

## 主要ファイル
- `src/lib/db.js` — APIとの通信すべて（関数名・戻り値は画面側と共通の約束）。オフライン用の送信待ち列もここ
- `functions/api/[[route]].js` — API本体。権限チェック・D1への読み書き
- `schema.sql` — D1 のテーブル定義（何度流しても安全な `IF NOT EXISTS`）
- `src/screens/AdminScreen.jsx` — 管理画面（記録一覧・出勤簿作成・ユーザー管理・QR印刷）
- `src/screens/WorkSelectScreen.jsx` — 退勤時の業務選択
- `src/screens/DeviceSetupScreen.jsx` — 打刻端末の初回登録
- `src/App.jsx` / `src/tablet/TabletApp.jsx` — 打刻アプリの流れ（ブラウザ版 / Androidアプリ版）
- `setup-new-client.js` — 案件の作成・デプロイ
- `migrate-from-firebase.js` — Firebase → D1 のデータ移行（Firebase は読むだけ）
- `backup-repo/` — 毎日の自動バックアップ一式（別の非公開リポジトリにコピーして使う）

## 権限
- 管理者PINはサーバー側でのみ照合する（端末には送らない）。5回続けて間違えると15分ロック
- 打刻端末は初回に管理者PINで登録する。登録端末ができるのは打刻・従業員の呼び出し・本人の勤務確認だけ
- 管理画面は管理者ログイン（12時間有効）が必要

## オフライン
- 打刻・業務時間は端末に保存してから送信する（`db.js` の outbox）。通信が戻ると自動で再送し、再送しても二重登録にならない
- 従業員名簿（PIN含む）を端末に保存しておき、オフラインでもQR・PINで打刻できる

## 時刻
- Cloudflare のサーバーは UTC で動くため、日付・時刻は日本時間（UTC+9）で扱う。「今日」の日付は端末から渡す

## ユーザー管理
- 管理画面「ユーザー管理」から従業員の追加・編集・削除
- ユーザーごとに業務別の時給を設定できる
- QRコードの中身はユーザーIDのみ。管理画面「QR印刷」から印刷

## 注意事項
- `migration-output/`（移行時のSQL）とバックアップには実データが入る。外部に渡さないこと
- `npm install` は既存の依存関係の競合があるため `--legacy-peer-deps` を付ける
