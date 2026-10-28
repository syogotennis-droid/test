#!/usr/bin/env bash
# Restore a backup into an EMPTY D1 database.
#   bash restore.sh <backup.sql.gz.enc> <D1データベース名> <schema.sqlのパス>
# The backup is decrypted with BACKUP_PASSPHRASE (asked for when it is not in the environment).
set -euo pipefail
[ $# -eq 3 ] || { echo "使い方: bash restore.sh <バックアップ.sql.gz.enc> <D1データベース名> <schema.sqlのパス>"; exit 1; }
WRANGLER="${WRANGLER:-npx --yes wrangler}"
WHERE="${WRANGLER_WHERE:---remote}"
tmp=$(mktemp --suffix=.sql)
trap 'rm -f "$tmp"' EXIT
case "$1" in
  *.enc)
    # same settings as backup.sh
    if [ -n "${BACKUP_PASSPHRASE:-}" ]; then pass=(-pass env:BACKUP_PASSPHRASE); else pass=(); echo "バックアップのパスフレーズを入力してください"; fi
    openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 "${pass[@]}" -in "$1" | gunzip -c > "$tmp" \
      || { echo "復号できません。パスフレーズを確認してください"; exit 1; } ;;
  *) gunzip -c "$1" > "$tmp" ;;  # saved before encryption
esac
echo "データを書き込んでいます…"
$WRANGLER d1 execute "$2" $WHERE --yes --file="$tmp"
echo "不足しているテーブル(ログイン情報など)を作成しています…"
$WRANGLER d1 execute "$2" $WHERE --yes --file="$3"
echo "復元が完了しました。端末は管理者PINで登録し直してください。"
