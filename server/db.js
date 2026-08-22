'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { companies, publicSettings } = require('./seed-data');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 2 AND 100),
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user', 'admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'blocked')),
  blocked_at TEXT,
  blocked_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  blocked_reason TEXT,
  force_password_change INTEGER NOT NULL DEFAULT 0 CHECK(force_password_change IN (0, 1)),
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('Legal', 'Ilegal')),
  image_url TEXT,
  ojk_number TEXT,
  base_likes INTEGER NOT NULL DEFAULT 0 CHECK(base_likes >= 0),
  trust_level INTEGER NOT NULL DEFAULT 0 CHECK(trust_level BETWEEN 0 AND 100),
  limit_text TEXT,
  tenor TEXT,
  interest TEXT,
  admin_fee TEXT,
  address TEXT,
  description TEXT NOT NULL,
  source_url TEXT,
  source_checked_at TEXT,
  publication_status TEXT NOT NULL DEFAULT 'draft' CHECK(publication_status IN ('draft', 'published', 'archived')),
  featured INTEGER NOT NULL DEFAULT 0 CHECK(featured IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS company_likes (
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (company_id, user_id)
);
CREATE TABLE IF NOT EXISTS company_unlikes (
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (company_id, user_id)
);

CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  display_name TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  comment TEXT NOT NULL CHECK(length(comment) BETWEEN 3 AND 2000),
  base_likes INTEGER NOT NULL DEFAULT 0 CHECK(base_likes >= 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'hidden')),
  moderation_note TEXT,
  moderated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  moderated_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS reviews_one_per_user_company
ON reviews(company_id, user_id) WHERE user_id IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS review_likes (
  review_id INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (review_id, user_id)
);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  reporter_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  reporter_name TEXT NOT NULL,
  reporter_email TEXT NOT NULL,
  company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  company_name TEXT NOT NULL,
  description TEXT NOT NULL CHECK(length(description) BETWEEN 10 AND 5000),
  evidence_url TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new', 'in_review', 'resolved', 'rejected', 'archived')),
  admin_note TEXT,
  handled_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  handled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  is_public INTEGER NOT NULL DEFAULT 1 CHECK(is_public IN (0, 1)),
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  before_json TEXT,
  after_json TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id, revoked_at, expires_at);
CREATE INDEX IF NOT EXISTS companies_public_idx ON companies(publication_status, deleted_at, featured);
CREATE INDEX IF NOT EXISTS reviews_company_idx ON reviews(company_id, status, deleted_at);
CREATE INDEX IF NOT EXISTS reports_status_idx ON reports(status, deleted_at, created_at);
CREATE INDEX IF NOT EXISTS audit_created_idx ON audit_logs(created_at DESC);
`;

function defaultDatabasePath() {
  return process.env.DB_PATH || path.join(__dirname, '..', 'data', 'cekpinjol.sqlite');
}

function ensureParentDirectory(filename) {
  if (filename === ':memory:' || filename.startsWith('file:')) return;
  fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
}

function initializeSchema(db) {
  db.exec(SCHEMA);
}

function seedDatabase(db) {
  const seed = db.transaction(() => {
    const companyCount = db.prepare('SELECT count(*) AS total FROM companies').get().total;
    if (companyCount === 0) {
      const insertCompany = db.prepare(`
        INSERT INTO companies (
          name, status, image_url, ojk_number, base_likes, trust_level,
          limit_text, tenor, interest, admin_fee, address, description,
          publication_status, featured
        ) VALUES (
          @name, @status, @imageUrl, @ojkNumber, @likes, @trustLevel,
          @limit, @tenor, @interest, @adminFee, @address, @description,
          'published', @featured
        )
      `);
      const insertReview = db.prepare(`
        INSERT INTO reviews (
          company_id, user_id, display_name, rating, comment, base_likes, status
        ) VALUES (?, NULL, ?, ?, ?, ?, 'approved')
      `);

      for (const company of companies) {
        const result = insertCompany.run({ ...company, featured: company.featured ? 1 : 0 });
        for (const review of company.reviews) {
          insertReview.run(result.lastInsertRowid, review.user, review.rating, review.comment, review.likes);
        }
      }
    }

    const insertSetting = db.prepare(`
      INSERT OR IGNORE INTO site_settings (key, value_json, is_public)
      VALUES (?, ?, 1)
    `);
    for (const [key, value] of Object.entries(publicSettings)) {
      insertSetting.run(key, JSON.stringify(value));
    }
  });
  seed();
}

function createDatabase(options = {}) {
  const filename = options.filename || defaultDatabasePath();
  ensureParentDirectory(filename);
  const db = new Database(filename);
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  if (filename !== ':memory:') db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  initializeSchema(db);
  if (options.seed !== false) seedDatabase(db);
  return db;
}

module.exports = {
  SCHEMA,
  createDatabase,
  initializeSchema,
  seedDatabase,
  defaultDatabasePath
};
