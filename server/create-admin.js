'use strict';

require('dotenv').config();

const crypto = require('node:crypto');
const readline = require('node:readline/promises');
const { createStorage } = require('./database');
const { hashPassword, normalizeEmail } = require('./security');

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function promptHidden(label) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return Promise.reject(new Error('ADMIN_PASSWORD wajib diisi pada lingkungan non-interaktif.'));
  }
  return new Promise((resolve, reject) => {
    let value = '';
    const wasRaw = Boolean(process.stdin.isRaw);
    const cleanup = () => {
      process.stdin.off('data', onData);
      if (process.stdin.setRawMode) process.stdin.setRawMode(wasRaw);
      process.stdin.pause();
    };
    const onData = (chunk) => {
      for (const character of chunk.toString('utf8')) {
        if (character === '\u0003') {
          cleanup();
          process.stdout.write('\n');
          reject(new Error('Pembuatan administrator dibatalkan.'));
          return;
        }
        if (character === '\r' || character === '\n') {
          cleanup();
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (character === '\u007f' || character === '\b') value = value.slice(0, -1);
        else if (character >= ' ') value += character;
      }
    };
    process.stdout.write(label);
    process.stdin.resume();
    if (process.stdin.setRawMode) process.stdin.setRawMode(true);
    process.stdin.on('data', onData);
  });
}

async function main() {
  let name = String(argument('name') || process.env.ADMIN_NAME || '').trim();
  let email = normalizeEmail(argument('email') || process.env.ADMIN_EMAIL);
  if ((!name || !email) && process.stdin.isTTY && process.stdout.isTTY) {
    const input = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      if (!name) name = String(await input.question('Nama administrator: ')).trim();
      if (!email) email = normalizeEmail(await input.question('Email administrator: '));
    } finally {
      input.close();
    }
  }
  // Environment tetap didukung untuk CI; terminal interaktif memakai input tersembunyi.
  let password = process.env.ADMIN_PASSWORD;
  if (!password) {
    password = await promptHidden('Password administrator (tidak ditampilkan): ');
    const confirmation = await promptHidden('Ulangi password administrator: ');
    if (password !== confirmation) throw new Error('Konfirmasi password tidak sama.');
  }

  if (!name || !email || !password) {
    throw new Error(
      'Nama, email, dan password administrator wajib diisi. Gunakan prompt interaktif atau environment pada CI.'
    );
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Format ADMIN_EMAIL tidak valid.');

  const storage = createStorage();
  try {
    await storage.ready();
    const existing = await storage.get(
      'SELECT id, role FROM users WHERE LOWER(email) = LOWER(?)',
      [email]
    );
    if (existing) {
      throw new Error('Email tersebut sudah terdaftar. Script tidak akan mengubah role akun yang ada.');
    }
    const passwordHash = await hashPassword(password);
    const id = crypto.randomUUID();
    await storage.run(`
      INSERT INTO users (
        id, name, email, password_hash, role, status, force_password_change
      ) VALUES (?, ?, ?, ?, 'admin', 'active', 0)
    `, [id, name, email, passwordHash]);
    console.log(`Administrator ${email} berhasil dibuat.`);
  } finally {
    await storage.close();
  }
}

main().catch((error) => {
  console.error(`Gagal membuat administrator: ${error.message}`);
  process.exitCode = 1;
});
