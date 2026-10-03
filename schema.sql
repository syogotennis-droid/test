-- D1 schema for QR Attendance System
-- Apply with: wrangler d1 execute qr-attendance-db --file=./schema.sql

-- data: all user fields except id as JSON (name, employeeType, workItems, itemRates, ...)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  pin TEXT DEFAULT '',
  data TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_users_pin ON users(pin);

CREATE TABLE IF NOT EXISTS logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  log_type TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL DEFAULT '',
  time TEXT NOT NULL DEFAULT '',
  timestamp TEXT NOT NULL DEFAULT '',
  work_type TEXT DEFAULT '',
  session_id TEXT DEFAULT '',
  synced INTEGER DEFAULT 0,
  approved_time TEXT,
  first_work TEXT,
  last_work TEXT,
  transport_count TEXT,
  work_items TEXT
);
CREATE INDEX IF NOT EXISTS idx_logs_date ON logs(date);
CREATE INDEX IF NOT EXISTS idx_logs_user_id ON logs(user_id);
CREATE INDEX IF NOT EXISTS idx_logs_user_date ON logs(user_id, date);

CREATE TABLE IF NOT EXISTS work_reports (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  items TEXT DEFAULT '{}',
  updated_at TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_wr_user_date ON work_reports(user_id, date);
CREATE INDEX IF NOT EXISTS idx_wr_date ON work_reports(date);

CREATE TABLE IF NOT EXISTS session_work_reports (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  session_id TEXT NOT NULL,
  items TEXT DEFAULT '{}',
  updated_at TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_swr_user_date ON session_work_reports(user_id, date);
CREATE INDEX IF NOT EXISTS idx_swr_date ON session_work_reports(date);

CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS overtime_apps (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  minutes INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS salaried_days (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  break_mins INTEGER DEFAULT 0,
  overtime_mins INTEGER DEFAULT 0
);

-- Login sessions. role: 'admin' (expires) or 'device' (kiosk tablet, no expiry)
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER
);

-- Admin PIN brute-force lockout, per client IP
CREATE TABLE IF NOT EXISTS login_attempts (
  ip TEXT PRIMARY KEY,
  fails INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0
);

-- No longer used (was the admin 勤務予定 screen). Kept so existing rows are not lost.
CREATE TABLE IF NOT EXISTS work_plans (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  items TEXT NOT NULL DEFAULT '{}',
  source TEXT NOT NULL DEFAULT 'manual',
  updated_at TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_wp_user_date ON work_plans(user_id, date);

-- Days excluded from transport pay ("本日の交通費: 支給なし").
-- No row means the day is eligible, which keeps all existing data unchanged.
CREATE TABLE IF NOT EXISTS transport_days (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  eligible INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_td_date ON transport_days(date);

-- 週コピー: work items copied from last week's actual reports, per day and per
-- work session (slot = 1st, 2nd, ... session of that day). Only pre-fills the
-- clock-out input; pay is still calculated from what is actually reported.
CREATE TABLE IF NOT EXISTS weekly_copies (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  slot INTEGER NOT NULL,
  items TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_wc_user_date ON weekly_copies(user_id, date);

-- The employee's answer to "先週と同じ内容を今週も使いますか？" (asked once a week)
CREATE TABLE IF NOT EXISTS weekly_copy_answers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  week_start TEXT NOT NULL,
  answer TEXT NOT NULL,
  created_at TEXT DEFAULT ''
);
