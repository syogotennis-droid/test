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
