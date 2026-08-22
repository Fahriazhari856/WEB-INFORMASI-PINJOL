'use strict';

const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scryptAsync = promisify(crypto.scrypt);
const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024;

const COMMON_PASSWORDS = new Set([
  '123456789012', 'password1234', 'password123', 'qwerty123456',
  'admin123456', 'administrator', 'letmein123456', 'indonesia123',
  'sayang123456', 'bismillah123', 'rahasia12345'
]);

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function validatePassword(password) {
  const value = typeof password === 'string' ? password : '';
  const length = Array.from(value).length;
  const errors = [];
  if (length < 12) errors.push('Password minimal 12 karakter.');
  if (length > 128) errors.push('Password maksimal 128 karakter.');
  if (COMMON_PASSWORDS.has(value.toLowerCase())) errors.push('Password terlalu umum.');
  if (/^\s+$/.test(value)) errors.push('Password tidak boleh hanya berisi spasi.');
  return { valid: errors.length === 0, errors };
}

async function hashPassword(password) {
  const result = validatePassword(password);
  if (!result.valid) {
    const error = new Error(result.errors.join(' '));
    error.code = 'WEAK_PASSWORD';
    error.status = 422;
    error.details = result.errors;
    throw error;
  }
  const salt = crypto.randomBytes(16);
  const derived = await scryptAsync(password, salt, SCRYPT_KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAX_MEMORY
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

async function verifyPassword(password, encodedHash) {
  try {
    const [algorithm, nRaw, rRaw, pRaw, saltRaw, hashRaw] = String(encodedHash || '').split('$');
    if (algorithm !== 'scrypt' || !nRaw || !rRaw || !pRaw || !saltRaw || !hashRaw) return false;
    const N = Number(nRaw);
    const r = Number(rRaw);
    const p = Number(pRaw);
    if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p) || N < 16384 || r < 1 || p < 1) return false;
    const salt = Buffer.from(saltRaw, 'base64');
    const expected = Buffer.from(hashRaw, 'base64');
    if (salt.length < 16 || expected.length < 32) return false;
    const actual = await scryptAsync(String(password || ''), salt, expected.length, {
      N,
      r,
      p,
      maxmem: Math.max(SCRYPT_MAX_MEMORY, 128 * N * r + 1024 * 1024)
    });
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function signCsrfToken(secret) {
  const nonce = randomToken(24);
  const signature = crypto.createHmac('sha256', secret).update(nonce).digest('base64url');
  return `${nonce}.${signature}`;
}

function verifyCsrfToken(token, secret) {
  if (typeof token !== 'string') return false;
  const separator = token.lastIndexOf('.');
  if (separator < 1) return false;
  const nonce = token.slice(0, separator);
  const supplied = Buffer.from(token.slice(separator + 1));
  const expected = Buffer.from(crypto.createHmac('sha256', secret).update(nonce).digest('base64url'));
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

module.exports = {
  hashPassword,
  verifyPassword,
  validatePassword,
  normalizeEmail,
  randomToken,
  hashToken,
  signCsrfToken,
  verifyCsrfToken
};
