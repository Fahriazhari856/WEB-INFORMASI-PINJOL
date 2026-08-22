'use strict';

const { createSqliteDatabase } = require('./sqlite');
const { createPostgresDatabase } = require('./postgres');

function normalizeDriver(value) {
  return String(value || '').trim().toLowerCase();
}

function hasPostgresUrl(options = {}) {
  return Boolean(
    options.connectionString
    || process.env.DATABASE_URL
    || process.env.SUPABASE_DB_URL
  );
}

function resolveProvider(options = {}) {
  const driver = normalizeDriver(options.driver || process.env.DB_DRIVER);

  if (driver && !['sqlite', 'postgres', 'postgresql'].includes(driver)) {
    throw new Error(`DB_DRIVER tidak didukung: ${driver}`);
  }

  if (driver === 'sqlite') return 'sqlite';

  if (driver === 'postgres' || driver === 'postgresql' || options.connectionString) {
    return 'postgres';
  }

  // Explicit SQLite handles supplied by tests/embedded callers take precedence
  // over environment inherited from the parent process.
  if (options.raw || options.filename) return 'sqlite';

  if (hasPostgresUrl(options)) return 'postgres';

  return 'sqlite';
}

function createStorage(options = {}) {
  const provider = resolveProvider(options);
  return provider === 'postgres'
    ? createPostgresDatabase(options)
    : createSqliteDatabase(options);
}

module.exports = {
  createStorage,
  resolveProvider
};
