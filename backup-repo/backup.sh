#!/usr/bin/env bash
# Export every D1 database listed in databases.txt to backups/<db>/<YYYY-MM-DD>.sql.gz
# and drop files older than KEEP_DAYS (they remain in git history).
# Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the environment.
set -euo pipefail

KEEP_DAYS="${KEEP_DAYS:-90}"
WRANGLER="${WRANGLER:-npx --yes wrangler}"
WHERE="${WRANGLER_WHERE:---remote}"
# Business data only. Login sessions are left out so a leaked backup can't be
# used to sign in; restore.sh recreates the empty tables from schema.sql.
TABLES="users logs work_reports session_work_reports config overtime_apps salaried_days work_plans transport_days weekly_copies weekly_copy_answers"
table_args=""
for t in $TABLES; do table_args="$table_args --table $t"; done

today=$(TZ=Asia/Tokyo date +%Y-%m-%d)
cutoff=$(TZ=Asia/Tokyo date -d "-${KEEP_DAYS} days" +%Y-%m-%d)
failed=0

while IFS= read -r line || [ -n "$line" ]; do
  db=$(echo "$line" | sed 's/#.*//' | xargs)
  [ -z "$db" ] && continue
  mkdir -p "backups/$db"
  out="backups/$db/$today.sql"
  echo "== $db"
  if $WRANGLER d1 export "$db" $WHERE $table_args --output "$out"; then
    gzip -f "$out"
    echo "   saved $out.gz ($(du -h "$out.gz" | cut -f1))"
  else
    echo "   FAILED: $db"
    rm -f "$out"
    failed=1
  fi
done < databases.txt

for f in backups/*/*.sql.gz; do
  [ -e "$f" ] || continue
  d=$(basename "$f" .sql.gz)
  if [[ "$d" < "$cutoff" ]]; then rm -f "$f"; echo "   removed old $f"; fi
done

exit $failed
