#!/usr/bin/env bash
# Restore a backup into an EMPTY D1 database.
#   bash restore.sh <backup.sql.gz> <D1データベース名> <schema.sqlのパス>
set -euo pipefail
[ $# -eq 3 ] || { echo "使い方: bash restore.sh <バックアップ.sql.gz> <D1データベース名> <schema.sqlのパス>"; exit 1; }
WRANGLER="${WRANGLER:-npx --yes wrangler}"
WHERE="${WRANGLER_WHERE:---remote}"
tmp=$(mktemp --suffix=.sql)
trap 'rm -f "$tmp"' EXIT
gunzip -c "$1" > "$tmp"
echo "データを書き込んでいます…"
$WRANGLER d1 execute "$2" $WHERE --yes --file="$tmp"
echo "不足しているテーブル(ログイン情報など)を作成しています…"
$WRANGLER d1 execute "$2" $WHERE --yes --file="$3"
echo "復元が完了しました。端末は管理者PINで登録し直してください。"
