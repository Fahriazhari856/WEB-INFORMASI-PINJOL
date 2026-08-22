'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');
const { createDatabase: createLegacyDatabase } = require('../db');

class AsyncLock {
  constructor() {
    this.tail = Promise.resolve();
  }

  async run(task) {
    let release;
    const previous = this.tail;
    this.tail = new Promise((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      return await task();
    } finally {
      release();
    }
  }
}

function callStatement(statement, method, params) {
  if (params === undefined || params === null) return statement[method]();
  if (Array.isArray(params)) return statement[method](...params);
  return statement[method](params);
}

function inferSqliteRunResult(raw, statement, params) {
  if (!statement.reader) {
    const result = callStatement(statement, 'run', params);
    return {
      changes: result.changes,
      lastInsertRowid: result.lastInsertRowid ?? null,
      rows: []
    };
  }

  const rows = callStatement(statement, 'all', params);
  const metadata = raw.prepare(`
    SELECT changes() AS changes, last_insert_rowid() AS lastInsertRowid
  `).get();

  return {
    changes: metadata.changes,
    lastInsertRowid: rows[0]?.id ?? metadata.lastInsertRowid ?? null,
    rows
  };
}

function createSqliteDatabase(options = {}) {
  const raw = options.raw || createLegacyDatabase({
    filename: options.filename,
    seed: options.seed
  });
  const lock = new AsyncLock();
  const transactionContext = new AsyncLocalStorage();
  let closed = false;
  let savepointId = 0;

  function assertOpen() {
    if (closed || !raw.open) throw new Error('Koneksi SQLite sudah ditutup.');
  }

  function execute(task) {
    assertOpen();
    if (transactionContext.getStore() === raw) {
      return Promise.resolve().then(task);
    }
    return lock.run(task);
  }

  const direct = {
    provider: 'sqlite',
    async ready() {
      assertOpen();
      return direct;
    },
    async ping() {
      assertOpen();
      raw.prepare('SELECT 1 AS ok').get();
      return true;
    },
    async get(sql, params = []) {
      assertOpen();
      return callStatement(raw.prepare(sql), 'get', params);
    },
    async all(sql, params = []) {
      assertOpen();
      return callStatement(raw.prepare(sql), 'all', params);
    },
    async run(sql, params = []) {
      assertOpen();
      return inferSqliteRunResult(raw, raw.prepare(sql), params);
    },
    async transaction(callback) {
      if (typeof callback !== 'function') throw new TypeError('Callback transaction wajib berupa fungsi.');
      assertOpen();

      const nested = raw.inTransaction;
      const savepoint = `app_storage_${++savepointId}`;
      raw.exec(nested ? `SAVEPOINT ${savepoint}` : 'BEGIN IMMEDIATE');

      try {
        const value = await transactionContext.run(raw, () => callback(direct));
        raw.exec(nested ? `RELEASE SAVEPOINT ${savepoint}` : 'COMMIT');
        return value;
      } catch (error) {
        if (nested) {
          raw.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
          raw.exec(`RELEASE SAVEPOINT ${savepoint}`);
        } else if (raw.inTransaction) {
          raw.exec('ROLLBACK');
        }
        throw error;
      }
    }
  };

  const storage = {
    provider: 'sqlite',
    raw,
    async ready() {
      await storage.ping();
      return storage;
    },
    ping() {
      return execute(() => direct.ping());
    },
    get(sql, params = []) {
      return execute(() => direct.get(sql, params));
    },
    all(sql, params = []) {
      return execute(() => direct.all(sql, params));
    },
    run(sql, params = []) {
      return execute(() => direct.run(sql, params));
    },
    transaction(callback) {
      return execute(() => direct.transaction(callback));
    },
    async close() {
      if (closed) return;
      await lock.run(async () => {
        if (closed) return;
        if (raw.inTransaction) raw.exec('ROLLBACK');
        raw.close();
        closed = true;
      });
    }
  };

  return storage;
}

module.exports = {
  createSqliteDatabase
};
