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
- `src/screens/WorkPlanTab.jsx` — 管理画面の勤務予定（週コピー）
- `src/lib/punchFlow.js` — 打刻の流れ（出勤・休憩・退勤の判定）。ブラウザ版とアプリ版で共用
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

## 休憩（中抜け）
- 打刻画面の「休憩・戻り」で記録。勤務回（session_id）はそのまま、ログ種別 `休憩開始` / `休憩終了` を同じ session_id で追加する
- 回を分けないので準備時間（1回10分）は増えず、退勤時の業務入力も1回だけ
- 休憩中に「出勤」を押すと戻りとして記録、「退勤」を押すと休憩を閉じてから退勤
- 打刻時刻の修正は管理者のみ（記録一覧の「勤務記録の編集」で休憩も編集できる）

## 勤務予定（週コピー）
- 管理画面「勤務予定」で日ごとの業務・時間を登録（テーブル `work_plans`）
- 退勤時の業務入力に、その日の予定（同じ日の前の回で入力済みの分を除く）が自動で入る。給与は実際に入力された時間だけで計算する
- 週コピーは確認画面を出してから実行。過去の日付、個別に入力・修正・削除した日（source = 'manual'）は上書きしない

## 交通費・出勤日数
- 通勤方法 `commuteMethod`: car / bus / train / walk / none。未設定（以前のデータ）は従来どおり日額 `itemRates['交通費'].amount` × 日数
- 車: `commuteDistanceKm` × 単価。単価は設定の `config.carRates`（適用開始日つき）。単価を変えても開始日より前は変わらない
- 本日の交通費（支給対象／支給なし）は退勤時に入力。テーブル `transport_days` に「支給なし」の日だけ保存（行がなければ支給対象）
- 出勤日数 = 出勤・退勤の両方がある日。交通費対象日数 = 業務入力があり打刻が完了した日のうち「支給なし」でない日。計算は `src/lib/db.js` の `computeTransport` / `attendanceDates` を画面とExcelで共用

## 時刻
- Cloudflare のサーバーは UTC で動くため、日付・時刻は日本時間（UTC+9）で扱う。「今日」の日付は端末から渡す

## ユーザー管理
- 管理画面「ユーザー管理」から従業員の追加・編集・削除
- ユーザーごとに業務別の時給を設定できる
- QRコードの中身はユーザーIDのみ。管理画面「QR印刷」から印刷

## 注意事項
- `migration-output/`（移行時のSQL）とバックアップには実データが入る。外部に渡さないこと
- `npm install` は既存の依存関係の競合があるため `--legacy-peer-deps` を付ける
