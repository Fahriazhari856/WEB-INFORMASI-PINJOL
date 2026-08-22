'use strict';

const fs = require('node:fs');
const path = require('node:path');

function loadPg() {
  try {
    return require('pg');
  } catch (error) {
    if (error?.code === 'MODULE_NOT_FOUND' && /(?:^|[\\/])pg(?:[\\/]|$)|'pg'/.test(error.message)) {
      throw new Error('Driver PostgreSQL belum terpasang. Jalankan npm install terlebih dahulu.');
    }
    throw error;
  }
}

function parsePositiveInteger(value, fallback, label) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} wajib berupa bilangan bulat positif.`);
  }
  return parsed;
}

function resolveConnectionString(options = {}) {
  const connectionString = options.connectionString
    || process.env.DATABASE_URL
    || process.env.SUPABASE_DB_URL;

  if (!connectionString) {
    throw new Error('DATABASE_URL atau SUPABASE_DB_URL wajib diisi untuk DB_DRIVER=postgres.');
  }
  return connectionString;
}

function connectionStringWithoutSslOverrides(connectionString) {
  let parsed;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error('DATABASE_URL/SUPABASE_DB_URL harus berupa URL PostgreSQL yang valid.');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('DATABASE_URL/SUPABASE_DB_URL harus memakai protokol postgres:// atau postgresql://.');
  }

  const sslKeys = new Set([
    'ssl', 'sslmode', 'sslcert', 'sslkey', 'sslrootcert',
    'sslnegotiation', 'uselibpqcompat'
  ]);
  for (const key of [...parsed.searchParams.keys()]) {
    if (sslKeys.has(key.toLowerCase())) parsed.searchParams.delete(key);
  }
  return parsed.toString();
}

function resolveSsl(options = {}) {
  if (options.ssl !== undefined) return options.ssl;

  const mode = String(process.env.PGSSL_MODE || 'verify-full').trim().toLowerCase();
  if (!['verify-full', 'require', 'disable'].includes(mode)) {
    throw new Error('PGSSL_MODE harus verify-full, require, atau disable.');
  }
  if (mode === 'disable') return false;

  const ssl = { rejectUnauthorized: mode === 'verify-full' };
  const caPath = options.caPath || process.env.SUPABASE_DB_CA_PATH;
  if (caPath) {
    const resolved = path.resolve(caPath);
    ssl.ca = fs.readFileSync(resolved, 'utf8');
    ssl.rejectUnauthorized = true;
  }
  return ssl;
}

function convertQuestionPlaceholders(sql, params = []) {
  if (typeof sql !== 'string' || !sql.trim()) throw new TypeError('SQL wajib berupa string yang tidak kosong.');
  if (!Array.isArray(params)) throw new TypeError('Parameter PostgreSQL wajib berupa array.');

  let output = '';
  let index = 0;
  let placeholders = 0;
  let existingDollarPlaceholder = false;
  let state = 'normal';
  let blockDepth = 0;
  let dollarTag = '';

  while (index < sql.length) {
    const char = sql[index];
    const next = sql[index + 1];

    if (state === 'single') {
      output += char;
      if (char === '\\' && next !== undefined) {
        output += next;
        index += 2;
        continue;
      }
      if (char === "'" && next === "'") {
        output += next;
        index += 2;
        continue;
      }
      if (char === "'") state = 'normal';
      index += 1;
      continue;
    }

    if (state === 'double') {
      output += char;
      if (char === '"' && next === '"') {
        output += next;
        index += 2;
        continue;
      }
      if (char === '"') state = 'normal';
      index += 1;
      continue;
    }

    if (state === 'line-comment') {
      output += char;
      if (char === '\n') state = 'normal';
      index += 1;
      continue;
    }

    if (state === 'block-comment') {
      output += char;
      if (char === '/' && next === '*') {
        output += next;
        blockDepth += 1;
        index += 2;
        continue;
      }
      if (char === '*' && next === '/') {
        output += next;
        blockDepth -= 1;
        index += 2;
        if (blockDepth === 0) state = 'normal';
        continue;
      }
      index += 1;
      continue;
    }

    if (state === 'dollar') {
      if (sql.startsWith(dollarTag, index)) {
        output += dollarTag;
        index += dollarTag.length;
        state = 'normal';
      } else {
        output += char;
        index += 1;
      }
      continue;
    }

    if (char === "'") {
      state = 'single';
      output += char;
      index += 1;
      continue;
    }
    if (char === '"') {
      state = 'double';
      output += char;
      index += 1;
      continue;
    }
    if (char === '-' && next === '-') {
      state = 'line-comment';
      output += '--';
      index += 2;
      continue;
    }
    if (char === '/' && next === '*') {
      state = 'block-comment';
      blockDepth = 1;
      output += '/*';
      index += 2;
      continue;
    }
    if (char === '$') {
      const tagMatch = sql.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
      if (tagMatch) {
        dollarTag = tagMatch[0];
        state = 'dollar';
        output += dollarTag;
        index += dollarTag.length;
        continue;
      }
      if (/\d/.test(next || '')) existingDollarPlaceholder = true;
    }
    if (char === '?' && next === '?') {
      output += '?';
      index += 2;
      continue;
    }
    if (char === '?' && (next === '|' || next === '&')) {
      output += char;
      index += 1;
      continue;
    }
    if (char === '?') {
      placeholders += 1;
      output += `$${placeholders}`;
      index += 1;
      continue;
    }

    output += char;
    index += 1;
  }

  if (state === 'block-comment' || state === 'dollar') {
    throw new Error('SQL tidak valid: komentar blok atau dollar-quoted string belum ditutup.');
  }
  if (placeholders > 0 && existingDollarPlaceholder) {
    throw new Error('Jangan mencampur placeholder ? dan $n dalam satu query.');
  }
  if (placeholders > 0 && placeholders !== params.length) {
    throw new Error(`Jumlah placeholder (${placeholders}) tidak sama dengan parameter (${params.length}).`);
  }
  if (placeholders === 0 && params.length > 0 && !existingDollarPlaceholder) {
    throw new Error(`Query tidak memiliki placeholder untuk ${params.length} parameter.`);
  }

  return { text: output, values: params };
}

function normalizeRows(result) {
  if (!result?.rows?.length || !result.fields?.length) return result?.rows || [];
  const int8Fields = new Set(result.fields.filter((field) => field.dataTypeID === 20).map((field) => field.name));
  if (int8Fields.size === 0) return result.rows;

  return result.rows.map((row) => {
    const normalized = { ...row };
    for (const name of int8Fields) {
      const value = normalized[name];
      if (typeof value !== 'string') continue;
      const number = Number(value);
      if (Number.isSafeInteger(number)) normalized[name] = number;
    }
    return normalized;
  });
}

function resultShape(result) {
  const rows = normalizeRows(result);
  return {
    changes: result.rowCount ?? rows.length,
    lastInsertRowid: rows[0]?.id ?? null,
    rows
  };
}

function makeQueryApi(query, provider = 'postgres') {
  return {
    provider,
    async ping() {
      await query('SELECT 1 AS ok');
      return true;
    },
    async get(sql, params = []) {
      const config = convertQuestionPlaceholders(sql, params);
      const result = await query(config.text, config.values);
      return normalizeRows(result)[0];
    },
    async all(sql, params = []) {
      const config = convertQuestionPlaceholders(sql, params);
      const result = await query(config.text, config.values);
      return normalizeRows(result);
    },
    async run(sql, params = []) {
      const config = convertQuestionPlaceholders(sql, params);
      return resultShape(await query(config.text, config.values));
    }
  };
}

function createPostgresDatabase(options = {}) {
  const connectionString = connectionStringWithoutSslOverrides(resolveConnectionString(options));
  const { Pool } = loadPg();
  const max = parsePositiveInteger(
    options.max
      ?? process.env.DB_POOL_MAX
      ?? process.env.SUPABASE_DB_POOL_MAX
      ?? process.env.PG_POOL_MAX,
    5,
    'DB_POOL_MAX'
  );
  const connectionTimeoutMillis = parsePositiveInteger(
    options.connectionTimeoutMillis ?? process.env.DB_CONNECTION_TIMEOUT_MS,
    10_000,
    'DB_CONNECTION_TIMEOUT_MS'
  );
  const pool = options.pool || new Pool({
    connectionString,
    max,
    connectionTimeoutMillis,
    idleTimeoutMillis: 30_000,
    ssl: resolveSsl(options),
    application_name: options.applicationName || 'cekpinjol-api'
  });
  if (typeof pool.on === 'function') {
    pool.on('error', (error) => {
      const message = String(error?.message || 'kesalahan koneksi tidak diketahui').slice(0, 500);
      process.stderr.write(`Koneksi idle PostgreSQL bermasalah: ${message}\n`);
    });
  }
  const poolApi = makeQueryApi((text, values) => pool.query(text, values));
  let readyPromise;
  let closed = false;

  function assertOpen() {
    if (closed) throw new Error('Pool PostgreSQL sudah ditutup.');
  }

  const storage = {
    provider: 'postgres',
    async ready() {
      assertOpen();
      if (!readyPromise) {
        readyPromise = poolApi.ping().catch((error) => {
          readyPromise = undefined;
          throw error;
        });
      }
      await readyPromise;
      return storage;
    },
    async ping() {
      assertOpen();
      return poolApi.ping();
    },
    async get(sql, params = []) {
      assertOpen();
      return poolApi.get(sql, params);
    },
    async all(sql, params = []) {
      assertOpen();
      return poolApi.all(sql, params);
    },
    async run(sql, params = []) {
      assertOpen();
      return poolApi.run(sql, params);
    },
    async transaction(callback) {
      if (typeof callback !== 'function') throw new TypeError('Callback transaction wajib berupa fungsi.');
      assertOpen();
      const client = await pool.connect();
      const txApi = makeQueryApi((text, values) => client.query(text, values));
      try {
        await client.query('BEGIN');
        const value = await callback(txApi);
        await client.query('COMMIT');
        return value;
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          error.rollbackError = rollbackError;
        }
        throw error;
      } finally {
        client.release();
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      await pool.end();
    }
  };

  return storage;
}

module.exports = {
  convertQuestionPlaceholders,
  connectionStringWithoutSslOverrides,
  createPostgresDatabase,
  resolveConnectionString,
  resolveSsl
};
