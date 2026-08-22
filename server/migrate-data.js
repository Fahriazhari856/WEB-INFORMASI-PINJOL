'use strict';

require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const { createSqliteDatabase } = require('./database/sqlite');
const { createPostgresDatabase } = require('./database/postgres');
const { defaultDatabasePath } = require('./db');

const TABLES = [
  {
    name: 'users',
    columns: [
      'id', 'name', 'email', 'password_hash', 'role', 'status', 'blocked_at',
      'blocked_by', 'blocked_reason', 'force_password_change', 'last_login_at',
      'created_at', 'updated_at', 'deleted_at'
    ]
  },
  {
    name: 'companies',
    columns: [
      'id', 'name', 'status', 'image_url', 'ojk_number', 'base_likes',
      'trust_level', 'limit_text', 'tenor', 'interest', 'admin_fee', 'address',
      'description', 'source_url', 'source_checked_at', 'publication_status',
      'featured', 'version', 'created_at', 'updated_at', 'deleted_at'
    ]
  },
  {
    name: 'company_likes',
    columns: ['company_id', 'user_id', 'created_at']
  },
  {
    name: 'company_unlikes',
    columns: ['company_id', 'user_id', 'created_at']
  },
  {
    name: 'reviews',
    columns: [
      'id', 'company_id', 'user_id', 'display_name', 'rating', 'comment',
      'base_likes', 'status', 'moderation_note', 'moderated_by', 'moderated_at',
      'created_at', 'updated_at', 'deleted_at'
    ]
  },
  {
    name: 'review_likes',
    columns: ['review_id', 'user_id', 'created_at']
  },
  {
    name: 'reports',
    columns: [
      'id', 'reporter_user_id', 'reporter_name', 'reporter_email', 'company_id',
      'company_name', 'description', 'evidence_url', 'status', 'admin_note',
      'handled_by', 'handled_at', 'created_at', 'updated_at', 'deleted_at'
    ]
  },
  {
    name: 'site_settings',
    columns: ['key', 'value_json', 'is_public', 'updated_by', 'updated_at']
  },
  {
    name: 'audit_logs',
    columns: [
      'id', 'actor_user_id', 'action', 'target_type', 'target_id', 'before_json',
      'after_json', 'ip_address', 'user_agent', 'created_at'
    ]
  }
];
const TARGET_TABLE_NAMES = ['sessions', ...TABLES.map((table) => table.name)];

function placeholders(count) {
  return Array.from({ length: count }, () => '?').join(', ');
}

async function ensureEmptyTarget(postgres) {
  const counts = await Promise.all(TARGET_TABLE_NAMES.map(async (name) => {
    const row = await postgres.get(`SELECT count(*) AS total FROM public.${name}`);
    return { name, total: Number(row.total) };
  }));
  const populated = counts.filter((entry) => entry.total > 0);
  if (populated.length) {
    const summary = populated.map((entry) => `${entry.name}=${entry.total}`).join(', ');
    throw new Error(`Target PostgreSQL tidak kosong (${summary}). Transfer dibatalkan tanpa perubahan.`);
  }
}

async function insertRows(tx, table, rows, columns = table.columns) {
  if (!rows.length) return;
  const sql = `
    INSERT INTO public.${table.name} (${columns.join(', ')})
    VALUES (${placeholders(columns.length)})
  `;
  for (const row of rows) {
    await tx.run(sql, columns.map((column) => row[column]));
  }
}

async function resetIdentity(tx, table) {
  await tx.run(`
    SELECT setval(
      pg_get_serial_sequence('public.${table}', 'id'),
      COALESCE((SELECT max(id) FROM public.${table}), 1),
      EXISTS (SELECT 1 FROM public.${table})
    )
  `);
}

async function verifyTransferredCounts(tx, source) {
  for (const { name } of TABLES) {
    const target = await tx.get(`SELECT count(*) AS total FROM public.${name}`);
    const sourceTotal = source.get(name).length;
    const targetTotal = Number(target.total);
    if (targetTotal !== sourceTotal) {
      throw new Error(
        `Verifikasi transfer gagal untuk ${name}: sumber=${sourceTotal}, target=${targetTotal}.`
      );
    }
  }
}

async function migrateData(options = {}) {
  const sqlitePath = options.sqlitePath || process.env.DB_PATH || defaultDatabasePath();
  if (!options.sqlite && sqlitePath !== ':memory:' && !sqlitePath.startsWith('file:')) {
    const resolvedSource = path.resolve(sqlitePath);
    if (!fs.existsSync(resolvedSource)) {
      throw new Error(`File SQLite sumber tidak ditemukan: ${resolvedSource}`);
    }
  }
  const sqlite = options.sqlite || createSqliteDatabase({
    filename: sqlitePath,
    seed: false
  });
  const postgres = options.postgres || createPostgresDatabase({
    connectionString: options.connectionString
  });
  const ownsSqlite = !options.sqlite;
  const ownsPostgres = !options.postgres;

  try {
    await sqlite.ready();
    await postgres.ready();

    const schema = await postgres.get("SELECT to_regclass('public.users') AS users_table");
    if (!schema?.users_table) {
      throw new Error('Skema PostgreSQL belum ada. Jalankan migrasi skema terlebih dahulu.');
    }

    const source = await sqlite.transaction(async (tx) => {
      const snapshot = new Map();
      for (const table of TABLES) {
        snapshot.set(table.name, await tx.all(`SELECT ${table.columns.join(', ')} FROM ${table.name}`));
      }
      return snapshot;
    });

    const blockedBy = new Map();
    const users = source.get('users').map((user) => {
      blockedBy.set(user.id, user.blocked_by);
      return { ...user, blocked_by: null };
    });

    await postgres.transaction(async (tx) => {
      await tx.run(`
        LOCK TABLE
          public.users, public.sessions, public.companies, public.company_likes,
          public.reviews, public.review_likes, public.reports,
          public.site_settings, public.audit_logs
        IN ACCESS EXCLUSIVE MODE
      `);
      await ensureEmptyTarget(tx);

      await insertRows(tx, TABLES[0], users);
      for (const user of users) {
        const blocker = blockedBy.get(user.id);
        if (blocker) {
          await tx.run('UPDATE public.users SET blocked_by = ? WHERE id = ?', [blocker, user.id]);
        }
      }

      for (const table of TABLES.slice(1)) {
        await insertRows(tx, table, source.get(table.name));
      }

      await resetIdentity(tx, 'companies');
      await resetIdentity(tx, 'reviews');
      await resetIdentity(tx, 'audit_logs');
      await verifyTransferredCounts(tx, source);
    });

    const transferred = Object.fromEntries(TABLES.map(({ name }) => [name, source.get(name).length]));
    process.stdout.write(`${JSON.stringify({ transferred, sessions: 'not-transferred' }, null, 2)}\n`);
    return transferred;
  } finally {
    if (ownsSqlite) await sqlite.close();
    if (ownsPostgres) await postgres.close();
  }
}

if (require.main === module) {
  migrateData().catch((error) => {
    process.stderr.write(`Transfer data gagal: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  TABLES,
  TARGET_TABLE_NAMES,
  ensureEmptyTarget,
  migrateData,
  verifyTransferredCounts
};
