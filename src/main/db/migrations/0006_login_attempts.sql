CREATE TABLE login_attempts (
  id           INTEGER PRIMARY KEY,
  login        TEXT    NOT NULL,
  attempted_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX ix_login_attempts_login_time ON login_attempts(login, attempted_at);
