#!/usr/bin/env bash
# Export every D1 database listed in databases.txt to backups/<db>/<YYYY-MM-DD>.sql.gz,
# thin out old files, and check the capacity of all databases in one place.
# Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the environment.
#
# Kept files: every day of the last KEEP_DAYS days, and before that only the last file of each month.
# Capacity: if a database uses more than WARN_PERCENT of MAX_DB_MB, or the account has more than
# WARN_PERCENT of MAX_DATABASES databases, or either could not be checked, the backups are still
# saved but the script ends with exit code 2 so the GitHub Action fails and GitHub sends an e-mail.
set -euo pipefail

KEEP_DAYS="${KEEP_DAYS:-30}"
MAX_DB_MB="${MAX_DB_MB:-500}"          # D1 limit per database (free plan)
MAX_DATABASES="${MAX_DATABASES:-10}"   # D1 databases per account (free plan)
WARN_PERCENT="${WARN_PERCENT:-80}"
WRANGLER="${WRANGLER:-npx --yes wrangler}"
WHERE="${WRANGLER_WHERE:---remote}"
# Business data only. Login sessions are left out so a leaked backup can't be
# used to sign in; restore.sh recreates the empty tables from schema.sql.
TABLES="users logs work_reports session_work_reports config overtime_apps salaried_days work_plans transport_days transport_day_methods weekly_copies weekly_copy_answers"
table_args=""
for t in $TABLES; do table_args="$table_args --table $t"; done

today=$(TZ=Asia/Tokyo date +%Y-%m-%d)
cutoff=$(TZ=Asia/Tokyo date -d "-${KEEP_DAYS} days" +%Y-%m-%d)
failed=0
warn=0
report=""
note() { echo "$1"; report="$report$1"$'\n'; }

# size of a database in bytes: D1 reports it with every query (meta.size_after); empty if unknown
db_size() {
  local db="$1"
  $WRANGLER d1 execute "$db" $WHERE --json --command "SELECT 1" 2>/dev/null \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const r=JSON.parse(s);const m=(Array.isArray(r)?r[0]:r).meta||{};console.log(m.size_after||"")}catch{console.log("")}})' || true
}

while IFS= read -r line || [ -n "$line" ]; do
  db=$(echo "$line" | sed 's/#.*//' | xargs)
  [ -z "$db" ] && continue
  mkdir -p "backups/$db"
  out="backups/$db/$today.sql"
  echo "== $db"
  if $WRANGLER d1 export "$db" $WHERE $table_args --output "$out"; then
    gzip -f "$out"
    echo "   saved $out.gz ($(du -h "$out.gz" | cut -f1))"
    bytes=$(db_size "$db")
    if ! [[ "$bytes" =~ ^[0-9]+$ ]]; then
      # the backup is saved, but the capacity could not be checked: report it instead of passing
      note "   容量を確認できません: $db"
      warn=1
      continue
    fi
    mb=$(( bytes / 1024 / 1024 ))
    pct=$(( bytes * 100 / (MAX_DB_MB * 1024 * 1024) ))
    if [ "$pct" -ge "$WARN_PERCENT" ]; then
      note "   容量注意: $db が ${mb}MB（上限 ${MAX_DB_MB}MB の ${pct}%）"
      warn=1
    else
      echo "   size ${mb}MB (${pct}% of ${MAX_DB_MB}MB)"
    fi
  else
    note "   バックアップ失敗: $db"
    rm -f "$out"
    failed=1
  fi
done < databases.txt

# number of D1 databases in the account (all of them count toward the limit)
count=$($WRANGLER d1 list --json 2>/dev/null \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).length)}catch{console.log("")}})' || true)
if ! [[ "$count" =~ ^[0-9]+$ ]]; then
  note "   データベース数を確認できません"
  warn=1
else
  if [ $(( count * 100 / MAX_DATABASES )) -ge "$WARN_PERCENT" ]; then
    note "   データベース数注意: ${count}個（上限 ${MAX_DATABASES}個）"
    warn=1
  else
    echo "== databases in the account: $count / $MAX_DATABASES"
  fi
fi

# thin out: keep every file of the last KEEP_DAYS days; before that only the last file of each month
for dir in backups/*/; do
  [ -d "$dir" ] || continue
  last_of_month=""
  # newest first: the first file seen for a month is that month's last one
  for f in $(ls "$dir"*.sql.gz 2>/dev/null | sort -r); do
    d=$(basename "$f" .sql.gz)
    [[ "$d" < "$cutoff" ]] || continue
    m=${d:0:7}
    if [[ " $last_of_month " == *" $m "* ]]; then
      rm -f "$f"; echo "   removed $f"
    else
      last_of_month="$last_of_month $m"
    fi
  done
done

if [ -n "$report" ] && [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  { echo "### 要確認"; echo '```'; printf '%s' "$report"; echo '```'; } >> "$GITHUB_STEP_SUMMARY"
fi
if [ "$failed" -ne 0 ]; then exit 1; fi
if [ "$warn" -ne 0 ]; then exit 2; fi
exit 0
