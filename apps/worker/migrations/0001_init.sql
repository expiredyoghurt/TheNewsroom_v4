-- The Newsroom v4.0 schema. xp_log is the source of truth for XP; students.xp_total is a cache
-- that is always RECOMPUTED from it (never incremented). Level is not stored anywhere.

CREATE TABLE teachers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email TEXT UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'teacher' CHECK (role IN ('teacher','admin')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  teacher_id INTEGER REFERENCES teachers(id) ON DELETE SET NULL,
  rankings_enabled INTEGER NOT NULL DEFAULT 0 CHECK (rankings_enabled IN (0,1)),
  similarity_threshold REAL CHECK (similarity_threshold IS NULL OR (similarity_threshold >= 0.1 AND similarity_threshold <= 0.99)),
  practice_mode TEXT NOT NULL DEFAULT 'free' CHECK (practice_mode IN ('free','assigned_only')),
  enabled_stations TEXT NOT NULL DEFAULT '["newsstand","investigation","opinion","writing","editor"]',
  allowed_question_types TEXT NOT NULL DEFAULT '["comprehension","vocabulary","reflect","writing"]',
  parent_password_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  index_number INTEGER NOT NULL,
  class_id INTEGER NOT NULL REFERENCES classes(id),
  xp_total INTEGER NOT NULL DEFAULT 0 CHECK (xp_total >= 0),
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX ux_students_class_index ON students(class_id, index_number) WHERE archived = 0;
CREATE INDEX ix_students_class ON students(class_id) WHERE archived = 0;

CREATE TABLE articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  forked_from_id INTEGER REFERENCES articles(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  source_name TEXT NOT NULL,
  publish_date TEXT NOT NULL,
  section TEXT,
  full_text TEXT NOT NULL,
  text_chunks TEXT NOT NULL,
  learning_loop TEXT NOT NULL DEFAULT '{"read":true,"vocabulary":true,"comprehension":true,"think":true,"writing":true,"edit":true}',
  thumbnail_key TEXT,
  image_key TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','archived')),
  created_by INTEGER REFERENCES teachers(id) ON DELETE SET NULL,
  create_ref TEXT UNIQUE,            -- idempotency key so child rows can join to a just-inserted article inside ONE batch
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX ix_articles_status ON articles(status);

CREATE TABLE tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('comprehension','vocabulary','reflect')),
  payload TEXT NOT NULL,
  pass_threshold REAL NOT NULL DEFAULT 0.75 CHECK (pass_threshold > 0 AND pass_threshold <= 1),
  UNIQUE (article_id, type)
);

CREATE TABLE writing_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL UNIQUE REFERENCES articles(id) ON DELETE CASCADE,
  payload TEXT NOT NULL
);

CREATE TABLE assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  title TEXT,
  start_at TEXT,
  due_at TEXT,
  required_stations TEXT NOT NULL DEFAULT '["newsstand","investigation","opinion","writing","editor"]',
  allowed_question_types TEXT NOT NULL DEFAULT '["comprehension","vocabulary","reflect","writing"]',
  attempts_allowed INTEGER CHECK (attempts_allowed IS NULL OR attempts_allowed >= 1),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_by INTEGER REFERENCES teachers(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (class_id, article_id),
  CHECK (start_at IS NULL OR due_at IS NULL OR start_at <= due_at)
);
CREATE INDEX ix_assignments_class ON assignments(class_id);

-- Grading runs: one row per grading EXECUTION (re-grades add rows). Persisted so degraded quality is visible.
CREATE TABLE grading_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('reflect','writing')),
  attempt_id INTEGER NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('ai','fallback')),
  provider TEXT NOT NULL,
  model TEXT,
  latency_ms INTEGER,
  attempts_log TEXT NOT NULL DEFAULT '[]',
  fallback_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX ix_grading_runs_attempt ON grading_runs(kind, attempt_id);
CREATE INDEX ix_grading_runs_created ON grading_runs(created_at);

-- MCQ + reflect attempts.
CREATE TABLE attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL CHECK (attempt_number >= 1),
  answers TEXT NOT NULL,
  score REAL,
  grading_status TEXT NOT NULL DEFAULT 'not_applicable' CHECK (grading_status IN ('not_applicable','pending','ai','fallback')),
  grade_json TEXT,
  grading_run_id INTEGER REFERENCES grading_runs(id),
  similarity_score REAL,
  similarity_flag INTEGER NOT NULL DEFAULT 0 CHECK (similarity_flag IN (0,1)),
  reviewed_by INTEGER REFERENCES teachers(id) ON DELETE SET NULL,
  review_note TEXT,
  reviewed_at TEXT,
  submitted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (student_id, task_id, attempt_number)
);
CREATE INDEX ix_attempts_task ON attempts(task_id);
CREATE INDEX ix_attempts_review ON attempts(task_id, submitted_at) WHERE similarity_flag = 1 OR grading_status = 'fallback';

CREATE TABLE task_progress (
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  attempts_count INTEGER NOT NULL DEFAULT 0,
  first_attempt_score REAL,
  best_score REAL,
  passed INTEGER NOT NULL DEFAULT 0 CHECK (passed IN (0,1)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (student_id, task_id)
);

CREATE TABLE writing_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  writing_task_id INTEGER NOT NULL REFERENCES writing_tasks(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL CHECK (attempt_number >= 1),
  draft TEXT NOT NULL,
  score REAL,
  grading_status TEXT NOT NULL DEFAULT 'pending' CHECK (grading_status IN ('pending','ai','fallback')),
  grade_json TEXT,
  grading_run_id INTEGER REFERENCES grading_runs(id),
  similarity_score REAL,
  similarity_flag INTEGER NOT NULL DEFAULT 0 CHECK (similarity_flag IN (0,1)),
  reviewed_by INTEGER REFERENCES teachers(id) ON DELETE SET NULL,
  review_note TEXT,
  reviewed_at TEXT,
  submitted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (student_id, writing_task_id, attempt_number)
);
CREATE INDEX ix_writing_attempts_task ON writing_attempts(writing_task_id);

CREATE TABLE writing_progress (
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  writing_task_id INTEGER NOT NULL REFERENCES writing_tasks(id) ON DELETE CASCADE,
  attempts_count INTEGER NOT NULL DEFAULT 0,
  first_attempt_score REAL,
  best_score REAL,
  completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0,1)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (student_id, writing_task_id)
);

-- Auditable XP events. UNIQUE(student_id, source_key) makes every award idempotent.
CREATE TABLE xp_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  delta INTEGER NOT NULL CHECK (delta > 0),
  reason TEXT NOT NULL,
  source_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (student_id, source_key)
);

CREATE TABLE badges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  awarded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (student_id, article_id)
);

-- "Please put it in your own words" soft-block: warn once per (pupil, task, attempt), then allow + flag.
CREATE TABLE similarity_warnings (
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  task_id INTEGER NOT NULL,
  attempt_number INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (student_id, task_id, attempt_number)
);

-- Per-account login throttle (strongly consistent; the rate-limit binding is only a coarse per-location guard).
CREATE TABLE login_failures (
  key TEXT PRIMARY KEY,
  failures INTEGER NOT NULL,
  window_start TEXT NOT NULL
);
