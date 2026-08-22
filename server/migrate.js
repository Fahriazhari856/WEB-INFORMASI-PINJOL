'use strict';

require('dotenv').config();

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createStorage } = require('./database');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'supabase', 'migrations');

function migrationFiles() {
  return fs.readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort();
}

function checksum(contents) {
  return crypto.createHash('sha256').update(contents).digest('hex');
}

async function migrate(options = {}) {
  const storage = options.storage || createStorage({
    driver: 'postgres',
    connectionString: options.connectionString
  });
  const ownsStorage = !options.storage;

  if (storage.provider !== 'postgres') {
    throw new Error('Migrasi Supabase hanya dapat dijalankan dengan provider PostgreSQL.');
  }

  try {
    await storage.ready();
    await storage.run(`
      CREATE TABLE IF NOT EXISTS public.app_schema_migrations (
        filename TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (
          to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        )
      )
    `);

    const applied = await storage.all(
      'SELECT filename, checksum FROM public.app_schema_migrations ORDER BY filename'
    );
    const appliedByName = new Map(applied.map((row) => [row.filename, row.checksum]));
    let appliedCount = 0;

    for (const filename of migrationFiles()) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf8');
      const digest = checksum(sql);
      const previousChecksum = appliedByName.get(filename);

      if (previousChecksum) {
        if (previousChecksum !== digest) {
          throw new Error(`Migrasi ${filename} sudah diterapkan tetapi checksum berubah.`);
        }
        continue;
      }

      await storage.transaction(async (tx) => {
        await tx.run(sql);
        await tx.run(
          'INSERT INTO public.app_schema_migrations (filename, checksum) VALUES (?, ?)',
          [filename, digest]
        );
      });
      appliedCount += 1;
      process.stdout.write(`Migrasi diterapkan: ${filename}\n`);
    }

    if (appliedCount === 0) process.stdout.write('Skema database sudah terbaru.\n');
    return { applied: appliedCount };
  } finally {
    if (ownsStorage) await storage.close();
  }
}

if (require.main === module) {
  migrate().catch((error) => {
    process.stderr.write(`Migrasi gagal: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { migrate, migrationFiles, checksum };
