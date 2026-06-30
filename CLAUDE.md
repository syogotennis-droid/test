# QR勤怠システム

## 概要
QRコードで出退勤を打刻するシステム。タブレット（打刻）とPC（管理画面）でデータを共有する。

## 技術スタック
- React 18 + Vite
- Firebase Firestore（クラウドDB）
- Firebase Hosting（公開URL）
- CSS Modules

## 案件ごとの構成
- 案件ごとに別のFirebaseプロジェクトを作って運用する
- 新規案件は `node setup-new-client.js` で自動セットアップ
- デプロイ先URL: `https://{projectId}.web.app`

## 新規案件のセットアップ手順
1. Firebase consoleで新しいプロジェクトを作成
2. Firestore Databaseを作成（Standardエディション、asia-northeast1、テストモード）
3. プロジェクト設定 → マイアプリ → firebaseConfigをコピー
4. Windowsターミナルで `node setup-new-client.js` を実行し、firebaseConfigを貼り付け
5. 自動でビルド＆デプロイされる

## 主要ファイル
- `src/lib/db.js` — Firebase Firestore との全CRUD処理
- `src/screens/AdminScreen.jsx` — 管理画面（記録一覧・出勤簿作成・ユーザー管理・QR印刷）
- `src/screens/WorkSelectScreen.jsx` — 退勤時の作業種別選択
- `src/App.jsx` — アプリ全体のフロー制御
- `setup-new-client.js` — 新規案件セットアップスクリプト
- `firebase.json` / `.firebaserc` — Firebase Hosting設定

## 作業種別
現場・清掃・事務・休憩の4種類

## ユーザー管理
- 管理画面「ユーザー管理」から従業員の追加・編集・削除
- ユーザーごとに時給（現場・清掃・事務）を設定可能
- QRコードは管理画面「QR印刷」から印刷

## Windowsでのビルド＆デプロイ
```
npm run build
firebase deploy --only hosting,firestore
```

`--only hosting,firestore` とすることで、Firestoreのセキュリティルール（`firestore.rules`）も毎回一緒にデプロイされる。
ルールはリポジトリで管理しており期限なし（`allow read, write: if true`）なので、期限切れは起きない。

## 注意事項
- `setup-new-client.js` は同じプロジェクトへの誤上書きを防止する機能あり
