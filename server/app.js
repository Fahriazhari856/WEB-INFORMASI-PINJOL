'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const { createStorage } = require('./database');
const {
  hashPassword,
  verifyPassword,
  normalizeEmail,
  randomToken,
  hashToken,
  signCsrfToken,
  verifyCsrfToken
} = require('./security');
const { publicSettings } = require('./seed-data');

const SESSION_COOKIE = 'pinjol_session';
const CSRF_COOKIE = 'pinjol_csrf';
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const PUBLIC_SETTING_KEYS = new Set(Object.keys(publicSettings));

class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function now() {
  return new Date().toISOString();
}

function sendError(res, status, code, message, details) {
  const error = { code, message };
  if (details !== undefined) error.details = details;
  return res.status(status).json({ error });
}

function parseCookies(header) {
  const cookies = {};
  for (const part of String(header || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    const key = part.slice(0, separator).trim();
    const rawValue = part.slice(separator + 1).trim();
    try {
      cookies[key] = decodeURIComponent(rawValue);
    } catch {
      cookies[key] = rawValue;
    }
  }
  return cookies;
}

function asString(value, field, { min = 0, max = 1000, required = false } = {}) {
  if (value === undefined || value === null) {
    if (required) throw new ApiError(422, 'VALIDATION_ERROR', `${field} wajib diisi.`, { field });
    return null;
  }
  if (typeof value !== 'string') throw new ApiError(422, 'VALIDATION_ERROR', `${field} harus berupa teks.`, { field });
  const clean = value.trim();
  if (required && !clean) throw new ApiError(422, 'VALIDATION_ERROR', `${field} wajib diisi.`, { field });
  if (clean.length < min || clean.length > max) {
    throw new ApiError(422, 'VALIDATION_ERROR', `${field} harus sepanjang ${min}-${max} karakter.`, { field });
  }
  return clean || null;
}

function asEmail(value, field = 'email') {
  const email = normalizeEmail(asString(value, field, { min: 3, max: 254, required: true }));
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Format email tidak valid.', { field });
  }
  return email;
}

function asUrl(value, field, required = false) {
  const raw = asString(value, field, { max: 2048, required });
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('scheme');
    return url.toString();
  } catch {
    throw new ApiError(422, 'VALIDATION_ERROR', `${field} harus URL http/https yang valid.`, { field });
  }
}

function asDate(value, field) {
  const raw = asString(value, field, { max: 50 });
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.valueOf())) throw new ApiError(422, 'VALIDATION_ERROR', `${field} tidak valid.`, { field });
  return parsed.toISOString();
}

function positiveInteger(value, field = 'id') {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new ApiError(400, 'INVALID_ID', `${field} tidak valid.`);
  }
  return parsed;
}

function pagination(query) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 20));
  return { page, limit, offset: (page - 1) * limit };
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    status: row.status,
    forcePasswordChange: Boolean(row.force_password_change),
    lastLoginAt: row.last_login_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    blockedAt: row.blocked_at || null,
    blockedReason: row.blocked_reason || null
  };
}

function clientMetadata(req) {
  return {
    ip: String(req.ip || req.socket?.remoteAddress || '').slice(0, 100),
    userAgent: String(req.get('user-agent') || '').slice(0, 500)
  };
}

async function audit(storage, req, action, targetType, targetId, before, after) {
  const metadata = clientMetadata(req);
  await storage.run(`
    INSERT INTO audit_logs (
      actor_user_id, action, target_type, target_id,
      before_json, after_json, ip_address, user_agent
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    req.user?.id || null,
    action,
    targetType,
    targetId === undefined || targetId === null ? null : String(targetId),
    before === undefined ? null : JSON.stringify(before),
    after === undefined ? null : JSON.stringify(after),
    metadata.ip,
    metadata.userAgent
  ]);
}

function parseJson(value) {
  try {
    return value === null || value === undefined ? null : JSON.parse(value);
  } catch {
    return null;
  }
}

function createApp(options = {}) {
  const app = express();
  const storageOptions = {
    ...options,
    raw: options.db,
    filename: options.databasePath,
    seed: options.seed !== false
  };
  // Opsi database lokal yang diberikan langsung harus tetap deterministik,
  // termasuk ketika test/CI memiliki DATABASE_URL global.
  if (!storageOptions.driver && (options.db || options.databasePath)) storageOptions.driver = 'sqlite';
  const storage = options.storage || createStorage(storageOptions);
  const production = options.production ?? process.env.NODE_ENV === 'production';
  const csrfSecret = options.csrfSecret || process.env.CSRF_SECRET || randomToken(48);
  const dummyHashPromise = hashPassword(randomToken(24));

  app.locals.storage = storage;
  app.locals.db = storage.raw || storage;
  app.disable('x-powered-by');
  if (production) app.set('trust proxy', 1);

  // Kebijakan transisi tetap kompatibel dengan Tailwind CDN, Lucide, dan inline
  // handler prototype. Setelah frontend dibundel, 'unsafe-inline' dapat dihapus.
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.tailwindcss.com', 'https://unpkg.com'],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: production ? [] : null
      }
    },
    crossOriginEmbedderPolicy: false
  }));
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: false, limit: '50kb' }));

  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: options.apiRateLimit || 500,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => sendError(res, 429, 'RATE_LIMITED', 'Terlalu banyak permintaan. Coba lagi nanti.')
  });
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: options.authRateLimit || 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    handler: (_req, res) => sendError(res, 429, 'RATE_LIMITED', 'Terlalu banyak percobaan autentikasi. Coba lagi nanti.')
  });
  const reportLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: options.reportRateLimit || 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => sendError(res, 429, 'RATE_LIMITED', 'Batas pengiriman laporan tercapai. Coba lagi nanti.')
  });

  app.use('/api', async (_req, _res, next) => {
    await storage.ready();
    next();
  });

  app.use('/api', apiLimiter, (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  function csrfCookieOptions() {
    return {
      httpOnly: false,
      secure: production,
      sameSite: 'strict',
      path: '/',
      maxAge: SESSION_DURATION_MS
    };
  }

  function sessionCookieOptions() {
    return {
      httpOnly: true,
      secure: production,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_DURATION_MS
    };
  }

  function getCsrfToken(req, res) {
    const current = parseCookies(req.headers.cookie)[CSRF_COOKIE];
    if (current && verifyCsrfToken(current, csrfSecret)) return current;
    const token = signCsrfToken(csrfSecret);
    res.cookie(CSRF_COOKIE, token, csrfCookieOptions());
    return token;
  }

  function requireCsrf(req, _res, next) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const cookieToken = parseCookies(req.headers.cookie)[CSRF_COOKIE];
    const headerToken = req.get('x-csrf-token');
    if (!cookieToken || !headerToken || cookieToken !== headerToken || !verifyCsrfToken(headerToken, csrfSecret)) {
      return next(new ApiError(403, 'CSRF_INVALID', 'Token CSRF tidak valid atau sudah kedaluwarsa.'));
    }
    return next();
  }

  function clearSessionCookie(res) {
    res.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions(), maxAge: undefined });
  }

  async function issueSession(req, res, userId) {
    const token = randomToken(32);
    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();
    const metadata = clientMetadata(req);
    await storage.run(`
      INSERT INTO sessions (id, user_id, token_hash, ip_address, user_agent, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [sessionId, userId, hashToken(token), metadata.ip, metadata.userAgent, expiresAt]);
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
    return { sessionId, expiresAt };
  }

  async function attachAuthentication(req, res, next) {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (!token) return next();
    const session = await storage.get(`
      SELECT
        u.*,
        s.id AS session_id,
        s.expires_at AS session_expires_at
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?
        AND s.revoked_at IS NULL
        AND s.expires_at > ?
      LIMIT 1
    `, [hashToken(token), now()]);
    if (!session) {
      clearSessionCookie(res);
      return next();
    }
    if (session.deleted_at) {
      await storage.run('UPDATE sessions SET revoked_at = ? WHERE id = ?', [now(), session.session_id]);
      clearSessionCookie(res);
      req.authFailure = 'ACCOUNT_DISABLED';
      return next();
    }
    if (session.status === 'blocked') {
      await storage.run('UPDATE sessions SET revoked_at = ? WHERE id = ?', [now(), session.session_id]);
      clearSessionCookie(res);
      req.authFailure = 'ACCOUNT_BLOCKED';
      return next();
    }
    req.user = session;
    req.sessionId = session.session_id;
    await storage.run('UPDATE sessions SET last_seen_at = ? WHERE id = ?', [now(), session.session_id]);
    return next();
  }

  function requireAuth(req, _res, next) {
    if (req.authFailure === 'ACCOUNT_BLOCKED') return next(new ApiError(423, 'ACCOUNT_BLOCKED', 'Akun diblokir. Hubungi administrator.'));
    if (req.authFailure === 'ACCOUNT_DISABLED') return next(new ApiError(403, 'ACCOUNT_DISABLED', 'Akun sudah dinonaktifkan.'));
    if (!req.user) return next(new ApiError(401, 'AUTH_REQUIRED', 'Silakan masuk terlebih dahulu.'));
    return next();
  }

  function requireReadyAccount(req, _res, next) {
    if (req.user?.force_password_change) {
      return next(new ApiError(403, 'PASSWORD_CHANGE_REQUIRED', 'Password harus diganti sebelum melanjutkan.'));
    }
    return next();
  }

  function requireAdmin(req, _res, next) {
    if (req.user?.role !== 'admin') return next(new ApiError(403, 'ADMIN_REQUIRED', 'Akses administrator diperlukan.'));
    return next();
  }

  app.use('/api', attachAuthentication, requireCsrf);

  function reviewResponse(row, viewerId) {
    return {
      id: row.id,
      user: row.display_name,
      rating: row.rating,
      comment: row.comment,
      likes: Number(row.base_likes) + Number(row.dynamic_likes || 0),
      hasLiked: Boolean(row.has_liked),
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      isAuthor: Boolean(viewerId && row.user_id === viewerId)
    };
  }

  async function companyResponse(row, viewerId, includeAllReviews = false) {
    const id = row.id;
    const likes = Number(row.base_likes) + Number((await storage.get('SELECT count(*) AS total FROM company_likes WHERE company_id = ?', [id])).total);
    const unlikes = Number((await storage.get('SELECT count(*) AS total FROM company_unlikes WHERE company_id = ?', [id])).total);
    const hasLiked = viewerId
      ? Boolean(await storage.get('SELECT 1 FROM company_likes WHERE company_id = ? AND user_id = ?', [id, viewerId]))
      : false;
    const hasUnliked = viewerId
      ? Boolean(await storage.get('SELECT 1 FROM company_unlikes WHERE company_id = ? AND user_id = ?', [id, viewerId]))
      : false;
    const ratingRow = await storage.get(`
      SELECT round(avg(rating), 1) AS rating
      FROM reviews
      WHERE company_id = ? AND status = 'approved' AND deleted_at IS NULL
    `, [id]);
    let reviews;
    if (includeAllReviews) {
      reviews = await storage.all(`
        SELECT r.*,
          (SELECT count(*) FROM review_likes rl WHERE rl.review_id = r.id) AS dynamic_likes,
          CASE WHEN CAST(? AS TEXT) IS NOT NULL AND EXISTS(
            SELECT 1 FROM review_likes rl2 WHERE rl2.review_id = r.id AND rl2.user_id = ?
          ) THEN 1 ELSE 0 END AS has_liked
        FROM reviews r
        WHERE r.company_id = ? AND r.deleted_at IS NULL
        ORDER BY r.created_at DESC, r.id DESC
      `, [viewerId || null, viewerId || null, id]);
    } else if (viewerId) {
      reviews = await storage.all(`
        SELECT r.*,
          (SELECT count(*) FROM review_likes rl WHERE rl.review_id = r.id) AS dynamic_likes,
          EXISTS(SELECT 1 FROM review_likes rl2 WHERE rl2.review_id = r.id AND rl2.user_id = ?) AS has_liked
        FROM reviews r
        WHERE r.company_id = ? AND r.deleted_at IS NULL
          AND (r.status = 'approved' OR r.user_id = ?)
        ORDER BY r.created_at DESC, r.id DESC
      `, [viewerId, id, viewerId]);
    } else {
      reviews = await storage.all(`
        SELECT r.*,
          (SELECT count(*) FROM review_likes rl WHERE rl.review_id = r.id) AS dynamic_likes,
          0 AS has_liked
        FROM reviews r
        WHERE r.company_id = ? AND r.status = 'approved' AND r.deleted_at IS NULL
        ORDER BY r.created_at DESC, r.id DESC
      `, [id]);
    }
    return {
      id,
      name: row.name,
      status: row.status,
      imageUrl: row.image_url || '',
      ojkNumber: row.ojk_number || null,
      rating: Number(ratingRow.rating || 0),
      likes,
      hasLiked,
      unlikes,
      hasUnliked,
      trustLevel: row.trust_level,
      limit: row.limit_text || '',
      tenor: row.tenor || '',
      interest: row.interest || '',
      adminFee: row.admin_fee || '',
      address: row.address || '',
      description: row.description,
      reviews: reviews.map((review) => reviewResponse(review, viewerId)),
      sourceUrl: row.source_url || null,
      sourceCheckedAt: row.source_checked_at || null,
      publicationStatus: row.publication_status,
      featured: Boolean(row.featured),
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  app.get('/api/health', async (_req, res) => {
    await storage.ready();
    await storage.ping();
    res.json({ status: 'ok', database: storage.provider, time: now() });
  });

  app.get('/api/csrf', (req, res) => {
    res.json({ csrfToken: getCsrfToken(req, res) });
  });

  app.get('/api/auth/me', (req, res, next) => {
    if (req.authFailure === 'ACCOUNT_BLOCKED') return next(new ApiError(423, 'ACCOUNT_BLOCKED', 'Akun diblokir. Hubungi administrator.'));
    return res.json({ user: publicUser(req.user), csrfToken: getCsrfToken(req, res) });
  });

  app.post('/api/auth/register', authLimiter, async (req, res) => {
    const name = asString(req.body.name, 'name', { min: 2, max: 100, required: true });
    const email = asEmail(req.body.email);
    const passwordHash = await hashPassword(req.body.password);
    const id = crypto.randomUUID();
    try {
      await storage.run(`
        INSERT INTO users (id, name, email, password_hash, role, status)
        VALUES (?, ?, ?, ?, 'user', 'active')
      `, [id, name, email, passwordHash]);
    } catch (error) {
      if (error.code === '23505' || String(error.code).startsWith('SQLITE_CONSTRAINT')) {
        throw new ApiError(409, 'EMAIL_EXISTS', 'Email sudah digunakan.');
      }
      throw error;
    }
    const user = await storage.get('SELECT * FROM users WHERE id = ?', [id]);
    await issueSession(req, res, id);
    req.user = user;
    await audit(storage, req, 'auth.register', 'user', id, null, publicUser(user));
    res.status(201).json({ user: publicUser(user), csrfToken: getCsrfToken(req, res) });
  });

  app.post('/api/auth/login', authLimiter, async (req, res) => {
    const email = asEmail(req.body.email);
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const user = await storage.get('SELECT * FROM users WHERE LOWER(email) = LOWER(?) AND deleted_at IS NULL', [email]);
    const passwordMatches = user
      ? await verifyPassword(password, user.password_hash)
      : await verifyPassword(password, await dummyHashPromise);
    if (!user || !passwordMatches) {
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email atau password salah.');
    }
    if (user.status === 'blocked') throw new ApiError(423, 'ACCOUNT_BLOCKED', 'Akun diblokir. Hubungi administrator.');
    const loggedInAt = now();
    await storage.run('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?', [loggedInAt, loggedInAt, user.id]);
    await issueSession(req, res, user.id);
    const freshUser = await storage.get('SELECT * FROM users WHERE id = ?', [user.id]);
    req.user = freshUser;
    await audit(storage, req, 'auth.login', 'user', user.id, undefined, { loggedInAt });
    res.json({ user: publicUser(freshUser), csrfToken: getCsrfToken(req, res) });
  });

  app.post('/api/auth/logout', async (req, res) => {
    if (req.sessionId) await storage.run('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', [now(), req.sessionId]);
    clearSessionCookie(res);
    res.status(204).end();
  });

  app.patch('/api/auth/profile', requireAuth, async (req, res) => {
    const before = publicUser(req.user);
    const name = Object.hasOwn(req.body, 'name')
      ? asString(req.body.name, 'name', { min: 2, max: 100, required: true })
      : req.user.name;
    const email = Object.hasOwn(req.body, 'email') ? asEmail(req.body.email) : req.user.email;
    try {
      await storage.run('UPDATE users SET name = ?, email = ?, updated_at = ? WHERE id = ?', [name, email, now(), req.user.id]);
    } catch (error) {
      if (error.code === '23505' || String(error.code).startsWith('SQLITE_CONSTRAINT')) throw new ApiError(409, 'EMAIL_EXISTS', 'Email sudah digunakan.');
      throw error;
    }
    const user = await storage.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    await audit(storage, req, 'user.profile.update', 'user', user.id, before, publicUser(user));
    res.json({ user: publicUser(user) });
  });

  app.post('/api/auth/change-password', requireAuth, async (req, res) => {
    const currentPassword = typeof req.body.currentPassword === 'string' ? req.body.currentPassword : '';
    if (!(await verifyPassword(currentPassword, req.user.password_hash))) {
      throw new ApiError(401, 'INVALID_CURRENT_PASSWORD', 'Password saat ini salah.');
    }
    if (currentPassword === req.body.newPassword) {
      throw new ApiError(422, 'PASSWORD_UNCHANGED', 'Password baru harus berbeda dari password saat ini.');
    }
    const passwordHash = await hashPassword(req.body.newPassword);
    const changedAt = now();
    await storage.transaction(async (tx) => {
      await tx.run(`
        UPDATE users
        SET password_hash = ?, force_password_change = 0, updated_at = ?
        WHERE id = ?
      `, [passwordHash, changedAt, req.user.id]);
      await tx.run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [changedAt, req.user.id]);
    });
    clearSessionCookie(res);
    await audit(storage, req, 'user.password.change', 'user', req.user.id, undefined, { sessionsRevoked: true });
    res.json({ message: 'Password berhasil diubah. Silakan masuk kembali.', reauthenticate: true });
  });

  app.get('/api/companies', async (req, res) => {
    const { page, limit } = pagination(req.query);
    const q = String(req.query.q || req.query.search || '').trim().toLowerCase();
    const rawStatus = String(req.query.status || '').trim().toLowerCase();
    const status = rawStatus === 'legal' ? 'Legal' : rawStatus === 'ilegal' || rawStatus === 'illegal' ? 'Ilegal' : null;
    const featured = req.query.featured === 'true' ? true : req.query.featured === 'false' ? false : null;
    let data = await storage.all(`
      SELECT * FROM companies
      WHERE publication_status = 'published' AND deleted_at IS NULL
      ORDER BY featured DESC, updated_at DESC, id DESC
    `);
    data = await Promise.all(data.map((company) => companyResponse(company, req.user?.id)));
    if (q) data = data.filter((company) => `${company.name} ${company.description}`.toLowerCase().includes(q));
    if (status) data = data.filter((company) => company.status === status);
    if (featured !== null) data = data.filter((company) => company.featured === featured);
    const sort = String(req.query.sort || req.query.sortBy || '').toLowerCase();
    if (['rating', 'rating_desc', 'rating tertinggi'].includes(sort)) data.sort((a, b) => b.rating - a.rating);
    else if (['likes', 'likes_desc', 'paling banyak disukai'].includes(sort)) data.sort((a, b) => b.likes - a.likes);
    else if (['trust', 'trust_desc', 'trustlevel'].includes(sort)) data.sort((a, b) => b.trustLevel - a.trustLevel);
    else if (sort === 'name') data.sort((a, b) => a.name.localeCompare(b.name, 'id'));
    const total = data.length;
    const slice = data.slice((page - 1) * limit, page * limit);
    res.json({ data: slice, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  });

  app.get('/api/companies/:id', async (req, res) => {
    const id = positiveInteger(req.params.id);
    const company = await storage.get(`
      SELECT * FROM companies
      WHERE id = ? AND publication_status = 'published' AND deleted_at IS NULL
    `, [id]);
    if (!company) throw new ApiError(404, 'COMPANY_NOT_FOUND', 'Data pinjol tidak ditemukan.');
    res.json({ data: await companyResponse(company, req.user?.id) });
  });

  app.get('/api/public/settings', async (_req, res) => {
    const settings = {};
    for (const row of await storage.all('SELECT key, value_json FROM site_settings WHERE is_public = 1 ORDER BY key')) {
      if (PUBLIC_SETTING_KEYS.has(row.key)) settings[row.key] = parseJson(row.value_json);
    }
    res.json({ data: settings });
  });

  app.post('/api/companies/:id/like', requireAuth, requireReadyAccount, async (req, res) => {
    const companyId = positiveInteger(req.params.id);
    const action = req.body?.action;
    if (action !== undefined && action !== 'like' && action !== 'unlike') {
      throw new ApiError(422, 'VALIDATION_ERROR', 'action harus like atau unlike.', { field: 'action' });
    }
    const company = await storage.get(`
      SELECT * FROM companies
      WHERE id = ? AND publication_status = 'published' AND deleted_at IS NULL
    `, [companyId]);
    if (!company) throw new ApiError(404, 'COMPANY_NOT_FOUND', 'Data pinjol tidak ditemukan.');
    const liked = await storage.transaction(async (tx) => {
      const existing = await tx.get('SELECT 1 FROM company_likes WHERE company_id = ? AND user_id = ?', [companyId, req.user.id]);
      const existingUnlike = await tx.get('SELECT 1 FROM company_unlikes WHERE company_id = ? AND user_id = ?', [companyId, req.user.id]);
      if (action === 'like' && existing) {
        await tx.run('DELETE FROM company_likes WHERE company_id = ? AND user_id = ?', [companyId, req.user.id]);
        return false;
      }
      if (action === 'unlike' && existingUnlike) {
        await tx.run('DELETE FROM company_unlikes WHERE company_id = ? AND user_id = ?', [companyId, req.user.id]);
        return false;
      }
      if (action === 'like' && existingUnlike) {
        await tx.run('DELETE FROM company_unlikes WHERE company_id = ? AND user_id = ?', [companyId, req.user.id]);
      }
      if (action === 'unlike' && existing) {
        await tx.run('DELETE FROM company_likes WHERE company_id = ? AND user_id = ?', [companyId, req.user.id]);
      }
      if (action === 'unlike') {
        await tx.run('INSERT INTO company_unlikes (company_id, user_id) VALUES (?, ?)', [companyId, req.user.id]);
        return false;
      }
      await tx.run('INSERT INTO company_likes (company_id, user_id) VALUES (?, ?)', [companyId, req.user.id]);
      return true;
    });
    const likes = Number(company.base_likes) + Number((await storage.get('SELECT count(*) AS total FROM company_likes WHERE company_id = ?', [companyId])).total);
    const unlikes = Number((await storage.get('SELECT count(*) AS total FROM company_unlikes WHERE company_id = ?', [companyId])).total);
    const hasUnliked = Boolean(await storage.get('SELECT 1 FROM company_unlikes WHERE company_id = ? AND user_id = ?', [companyId, req.user.id]));
    res.json({ liked, hasLiked: liked, likes, unlikes, hasUnliked });
  });

  app.post('/api/reviews', requireAuth, requireReadyAccount, async (req, res) => {
    const companyId = positiveInteger(req.body.companyId, 'companyId');
    const rating = Number(req.body.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new ApiError(422, 'VALIDATION_ERROR', 'rating harus bilangan bulat 1-5.', { field: 'rating' });
    }
    const comment = asString(req.body.comment, 'comment', { min: 3, max: 2000, required: true });
    const company = await storage.get(`
      SELECT id FROM companies
      WHERE id = ? AND publication_status = 'published' AND deleted_at IS NULL
    `, [companyId]);
    if (!company) throw new ApiError(404, 'COMPANY_NOT_FOUND', 'Data pinjol tidak ditemukan.');
    let inserted;
    try {
      inserted = await storage.get(`
        INSERT INTO reviews (company_id, user_id, display_name, rating, comment, status)
        VALUES (?, ?, ?, ?, ?, 'pending')
        RETURNING id
      `, [companyId, req.user.id, req.user.name, rating, comment]);
    } catch (error) {
      if (error.code === '23505' || String(error.code).startsWith('SQLITE_CONSTRAINT')) {
        throw new ApiError(409, 'REVIEW_EXISTS', 'Anda sudah mengirim ulasan untuk pinjol ini.');
      }
      throw error;
    }
    const review = await storage.get(`
      SELECT r.*, 0 AS dynamic_likes, 0 AS has_liked FROM reviews r WHERE id = ?
    `, [inserted.id]);
    await audit(storage, req, 'review.create', 'review', review.id, null, reviewResponse(review, req.user.id));
    res.status(201).json({ data: reviewResponse(review, req.user.id), message: 'Ulasan dikirim dan menunggu moderasi.' });
  });

  app.post('/api/reviews/:id/like', requireAuth, requireReadyAccount, async (req, res) => {
    const reviewId = positiveInteger(req.params.id);
    const review = await storage.get(`
      SELECT * FROM reviews
      WHERE id = ? AND deleted_at IS NULL AND (status = 'approved' OR user_id = ?)
    `, [reviewId, req.user.id]);
    if (!review) throw new ApiError(404, 'REVIEW_NOT_FOUND', 'Ulasan tidak ditemukan.');
    const liked = await storage.transaction(async (tx) => {
      const existing = await tx.get('SELECT 1 FROM review_likes WHERE review_id = ? AND user_id = ?', [reviewId, req.user.id]);
      if (existing) {
        await tx.run('DELETE FROM review_likes WHERE review_id = ? AND user_id = ?', [reviewId, req.user.id]);
        return false;
      }
      await tx.run('INSERT INTO review_likes (review_id, user_id) VALUES (?, ?)', [reviewId, req.user.id]);
      return true;
    });
    const likes = Number(review.base_likes) + Number((await storage.get('SELECT count(*) AS total FROM review_likes WHERE review_id = ?', [reviewId])).total);
    res.json({ liked, hasLiked: liked, likes });
  });

  app.post('/api/reports', reportLimiter, async (req, res, next) => {
    if (req.authFailure === 'ACCOUNT_BLOCKED') return next(new ApiError(423, 'ACCOUNT_BLOCKED', 'Akun diblokir. Hubungi administrator.'));
    const reporterName = asString(req.body.reporterName ?? req.body.name ?? req.user?.name, 'reporterName', { min: 2, max: 100, required: true });
    const reporterEmail = asEmail(req.body.reporterEmail ?? req.body.email ?? req.user?.email, 'reporterEmail');
    const companyId = req.body.companyId === undefined || req.body.companyId === null || req.body.companyId === ''
      ? null
      : positiveInteger(req.body.companyId, 'companyId');
    let knownCompany = null;
    if (companyId) {
      knownCompany = await storage.get('SELECT id, name FROM companies WHERE id = ? AND deleted_at IS NULL', [companyId]);
      if (!knownCompany) throw new ApiError(404, 'COMPANY_NOT_FOUND', 'Data pinjol tidak ditemukan.');
    }
    const companyName = asString(req.body.companyName ?? req.body.pinjolName ?? knownCompany?.name, 'companyName', { min: 2, max: 150, required: true });
    const description = asString(req.body.description ?? req.body.message, 'description', { min: 10, max: 5000, required: true });
    const evidenceUrl = asUrl(req.body.evidenceUrl, 'evidenceUrl');
    const id = crypto.randomUUID();
    await storage.run(`
      INSERT INTO reports (
        id, reporter_user_id, reporter_name, reporter_email,
        company_id, company_name, description, evidence_url
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [id, req.user?.id || null, reporterName, reporterEmail, companyId, companyName, description, evidenceUrl]);
    await audit(storage, req, 'report.create', 'report', id, null, { id, companyId, companyName, status: 'new' });
    res.status(201).json({ data: { id, status: 'new', createdAt: now() }, message: 'Laporan berhasil disimpan.' });
  });

  const adminOnly = [requireAuth, requireReadyAccount, requireAdmin];

  async function compactCompany(company) {
    const { reviews, ...withoutReviews } = await companyResponse(company, null, false);
    return withoutReviews;
  }

  function companyInput(body, existing = null) {
    const source = existing ? {
      name: existing.name,
      status: existing.status,
      imageUrl: existing.image_url,
      ojkNumber: existing.ojk_number,
      trustLevel: existing.trust_level,
      limit: existing.limit_text,
      tenor: existing.tenor,
      interest: existing.interest,
      adminFee: existing.admin_fee,
      address: existing.address,
      description: existing.description,
      sourceUrl: existing.source_url,
      sourceCheckedAt: existing.source_checked_at,
      publicationStatus: existing.publication_status,
      featured: Boolean(existing.featured)
    } : {
      status: 'Legal',
      trustLevel: 0,
      publicationStatus: 'draft',
      featured: false
    };
    const value = { ...source };
    const has = (key) => Object.hasOwn(body, key);

    if (has('name')) value.name = asString(body.name, 'name', { min: 2, max: 150, required: true });
    if (has('status')) {
      const raw = String(body.status || '').trim().toLowerCase();
      if (raw === 'legal') value.status = 'Legal';
      else if (raw === 'ilegal' || raw === 'illegal') value.status = 'Ilegal';
      else throw new ApiError(422, 'VALIDATION_ERROR', 'status harus Legal atau Ilegal.', { field: 'status' });
    }
    if (has('imageUrl')) value.imageUrl = asUrl(body.imageUrl, 'imageUrl');
    if (has('ojkNumber')) value.ojkNumber = asString(body.ojkNumber, 'ojkNumber', { max: 150 });
    if (has('trustLevel')) {
      const trust = Number(body.trustLevel);
      if (!Number.isInteger(trust) || trust < 0 || trust > 100) {
        throw new ApiError(422, 'VALIDATION_ERROR', 'trustLevel harus bilangan bulat 0-100.', { field: 'trustLevel' });
      }
      value.trustLevel = trust;
    }
    if (has('limit')) value.limit = asString(body.limit, 'limit', { max: 250 });
    if (has('tenor')) value.tenor = asString(body.tenor, 'tenor', { max: 250 });
    if (has('interest')) value.interest = asString(body.interest, 'interest', { max: 500 });
    if (has('adminFee')) value.adminFee = asString(body.adminFee, 'adminFee', { max: 500 });
    if (has('address')) value.address = asString(body.address, 'address', { max: 1000 });
    if (has('description')) value.description = asString(body.description, 'description', { min: 10, max: 5000, required: true });
    if (has('sourceUrl')) value.sourceUrl = asUrl(body.sourceUrl, 'sourceUrl');
    if (has('sourceCheckedAt')) value.sourceCheckedAt = asDate(body.sourceCheckedAt, 'sourceCheckedAt');
    if (has('publicationStatus')) {
      const publication = String(body.publicationStatus || '').trim().toLowerCase();
      if (!['draft', 'published', 'archived'].includes(publication)) {
        throw new ApiError(422, 'VALIDATION_ERROR', 'publicationStatus tidak valid.', { field: 'publicationStatus' });
      }
      value.publicationStatus = publication;
    }
    if (has('featured')) {
      if (typeof body.featured !== 'boolean') throw new ApiError(422, 'VALIDATION_ERROR', 'featured harus boolean.', { field: 'featured' });
      value.featured = body.featured;
    }

    value.name = asString(value.name, 'name', { min: 2, max: 150, required: true });
    value.description = asString(value.description, 'description', { min: 10, max: 5000, required: true });
    if (value.status === 'Legal' && !value.ojkNumber) {
      throw new ApiError(422, 'VALIDATION_ERROR', 'Nomor izin OJK wajib untuk status Legal.', { field: 'ojkNumber' });
    }
    const isPublishingNow = value.publicationStatus === 'published' && (!existing || existing.publication_status !== 'published');
    if (isPublishingNow && (!value.sourceUrl || !value.sourceCheckedAt)) {
      throw new ApiError(422, 'SOURCE_REQUIRED', 'Sumber dan tanggal pemeriksaan wajib sebelum dipublikasikan.', {
        fields: ['sourceUrl', 'sourceCheckedAt']
      });
    }
    return value;
  }

  app.get('/api/admin/dashboard', ...adminOnly, async (_req, res) => {
    const countRows = await Promise.all([
      storage.get('SELECT count(*) AS total FROM users WHERE deleted_at IS NULL'),
      storage.get("SELECT count(*) AS total FROM users WHERE status = 'blocked' AND deleted_at IS NULL"),
      storage.get('SELECT count(*) AS total FROM companies WHERE deleted_at IS NULL'),
      storage.get("SELECT count(*) AS total FROM companies WHERE publication_status = 'published' AND deleted_at IS NULL"),
      storage.get("SELECT count(*) AS total FROM reviews WHERE status = 'pending' AND deleted_at IS NULL"),
      storage.get("SELECT count(*) AS total FROM reports WHERE status = 'new' AND deleted_at IS NULL")
    ]);
    const counts = {
      users: Number(countRows[0].total),
      blockedUsers: Number(countRows[1].total),
      companies: Number(countRows[2].total),
      publishedCompanies: Number(countRows[3].total),
      pendingReviews: Number(countRows[4].total),
      newReports: Number(countRows[5].total)
    };
    const recentReports = await storage.all(`
      SELECT id, company_name AS companyName, status, created_at AS createdAt
      FROM reports WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 5
    `);
    const recentReviews = await storage.all(`
      SELECT r.id, r.display_name AS user, r.rating, r.status,
             r.created_at AS createdAt, c.id AS companyId, c.name AS companyName
      FROM reviews r JOIN companies c ON c.id = r.company_id
      WHERE r.deleted_at IS NULL ORDER BY r.created_at DESC LIMIT 5
    `);
    res.json({ data: { counts, recentReports, recentReviews } });
  });

  app.get('/api/admin/companies', ...adminOnly, async (req, res) => {
    const { page, limit } = pagination(req.query);
    const q = String(req.query.q || '').trim().toLowerCase();
    const status = String(req.query.status || '').trim().toLowerCase();
    const publication = String(req.query.publicationStatus || '').trim().toLowerCase();
    const includeDeleted = req.query.includeDeleted === 'true';
    let rows = await storage.all(`
      SELECT * FROM companies
      ${includeDeleted ? '' : 'WHERE deleted_at IS NULL'}
      ORDER BY updated_at DESC, id DESC
    `);
    if (q) rows = rows.filter((row) => `${row.name} ${row.description}`.toLowerCase().includes(q));
    if (status) rows = rows.filter((row) => row.status.toLowerCase() === status || (status === 'illegal' && row.status === 'Ilegal'));
    if (publication) rows = rows.filter((row) => row.publication_status === publication);
    const total = rows.length;
    const data = await Promise.all(rows.slice((page - 1) * limit, page * limit).map(async (row) => ({
      ...await companyResponse(row, req.user.id, true),
      deletedAt: row.deleted_at || null
    })));
    res.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  });

  app.post('/api/admin/companies', ...adminOnly, async (req, res) => {
    const input = companyInput(req.body);
    let inserted;
    try {
      inserted = await storage.get(`
        INSERT INTO companies (
          name, status, image_url, ojk_number, trust_level, limit_text,
          tenor, interest, admin_fee, address, description, source_url,
          source_checked_at, publication_status, featured
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING id
      `, [
        input.name, input.status, input.imageUrl, input.ojkNumber, input.trustLevel,
        input.limit, input.tenor, input.interest, input.adminFee, input.address,
        input.description, input.sourceUrl, input.sourceCheckedAt,
        input.publicationStatus, input.featured ? 1 : 0
      ]);
    } catch (error) {
      if (error.code === '23505' || String(error.code).startsWith('SQLITE_CONSTRAINT')) throw new ApiError(409, 'COMPANY_EXISTS', 'Nama pinjol sudah digunakan.');
      throw error;
    }
    const company = await storage.get('SELECT * FROM companies WHERE id = ?', [inserted.id]);
    const response = await companyResponse(company, req.user.id, true);
    await audit(storage, req, 'company.create', 'company', company.id, null, await compactCompany(company));
    res.status(201).json({ data: response });
  });

  app.get('/api/admin/companies/:id', ...adminOnly, async (req, res) => {
    const id = positiveInteger(req.params.id);
    const company = await storage.get('SELECT * FROM companies WHERE id = ?', [id]);
    if (!company) throw new ApiError(404, 'COMPANY_NOT_FOUND', 'Data pinjol tidak ditemukan.');
    res.json({ data: { ...await companyResponse(company, req.user.id, true), deletedAt: company.deleted_at || null } });
  });

  app.patch('/api/admin/companies/:id', ...adminOnly, async (req, res) => {
    const id = positiveInteger(req.params.id);
    const existing = await storage.get('SELECT * FROM companies WHERE id = ? AND deleted_at IS NULL', [id]);
    if (!existing) throw new ApiError(404, 'COMPANY_NOT_FOUND', 'Data pinjol tidak ditemukan.');
    if (Object.hasOwn(req.body, 'version') && Number(req.body.version) !== existing.version) {
      throw new ApiError(409, 'VERSION_CONFLICT', 'Data telah diubah oleh administrator lain. Muat ulang sebelum menyimpan.');
    }
    const input = companyInput(req.body, existing);
    const updatedAt = now();
    try {
      await storage.run(`
        UPDATE companies SET
          name = ?, status = ?, image_url = ?, ojk_number = ?, trust_level = ?,
          limit_text = ?, tenor = ?, interest = ?, admin_fee = ?, address = ?,
          description = ?, source_url = ?, source_checked_at = ?,
          publication_status = ?, featured = ?, version = version + 1, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL
      `, [
        input.name, input.status, input.imageUrl, input.ojkNumber, input.trustLevel,
        input.limit, input.tenor, input.interest, input.adminFee, input.address,
        input.description, input.sourceUrl, input.sourceCheckedAt,
        input.publicationStatus, input.featured ? 1 : 0, updatedAt, id
      ]);
    } catch (error) {
      if (error.code === '23505' || String(error.code).startsWith('SQLITE_CONSTRAINT')) throw new ApiError(409, 'COMPANY_EXISTS', 'Nama pinjol sudah digunakan.');
      throw error;
    }
    const company = await storage.get('SELECT * FROM companies WHERE id = ?', [id]);
    await audit(storage, req, 'company.update', 'company', id, await compactCompany(existing), await compactCompany(company));
    res.json({ data: await companyResponse(company, req.user.id, true) });
  });

  app.delete('/api/admin/companies/:id', ...adminOnly, async (req, res) => {
    const id = positiveInteger(req.params.id);
    const company = await storage.get('SELECT * FROM companies WHERE id = ? AND deleted_at IS NULL', [id]);
    if (!company) throw new ApiError(404, 'COMPANY_NOT_FOUND', 'Data pinjol tidak ditemukan.');
    const timestamp = now();
    await storage.run(`
      UPDATE companies
      SET publication_status = 'archived', deleted_at = ?, updated_at = ?, version = version + 1
      WHERE id = ?
    `, [timestamp, timestamp, id]);
    await audit(storage, req, 'company.delete', 'company', id, await compactCompany(company), { deletedAt: timestamp });
    res.status(204).end();
  });

  async function activeAdminCount() {
    return Number((await storage.get(`
      SELECT count(*) AS total FROM users
      WHERE role = 'admin' AND status = 'active' AND deleted_at IS NULL
    `)).total);
  }

  async function ensureAdminCanBeDisabled(target) {
    if (target.role === 'admin' && target.status === 'active' && await activeAdminCount() <= 1) {
      throw new ApiError(409, 'LAST_ADMIN_GUARD', 'Administrator aktif terakhir tidak dapat dinonaktifkan.');
    }
  }

  async function adminUserResponse(row) {
    const value = publicUser(row);
    value.deletedAt = row.deleted_at || null;
    value.blockedBy = row.blocked_by || null;
    value.activeSessions = Number((await storage.get(`
      SELECT count(*) AS total FROM sessions
      WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?
    `, [row.id, now()])).total);
    return value;
  }

  app.get('/api/admin/users', ...adminOnly, async (req, res) => {
    const { page, limit, offset } = pagination(req.query);
    const q = `%${String(req.query.q || '').trim()}%`;
    const role = ['user', 'admin'].includes(String(req.query.role || '').toLowerCase()) ? String(req.query.role).toLowerCase() : null;
    const status = ['active', 'blocked'].includes(String(req.query.status || '').toLowerCase()) ? String(req.query.status).toLowerCase() : null;
    const includeDeleted = req.query.includeDeleted === 'true';
    const clauses = ['(LOWER(name) LIKE LOWER(?) OR LOWER(email) LIKE LOWER(?))'];
    const values = [q, q];
    if (!includeDeleted) clauses.push('deleted_at IS NULL');
    if (role) { clauses.push('role = ?'); values.push(role); }
    if (status) { clauses.push('status = ?'); values.push(status); }
    const where = clauses.join(' AND ');
    const total = Number((await storage.get(`SELECT count(*) AS total FROM users WHERE ${where}`, values)).total);
    const rows = await storage.all(`
      SELECT * FROM users WHERE ${where}
      ORDER BY created_at DESC LIMIT ? OFFSET ?
    `, [...values, limit, offset]);
    res.json({
      data: await Promise.all(rows.map(adminUserResponse)),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) }
    });
  });

  app.post('/api/admin/users', ...adminOnly, async (req, res) => {
    const name = asString(req.body.name, 'name', { min: 2, max: 100, required: true });
    const email = asEmail(req.body.email);
    const role = String(req.body.role || 'user').toLowerCase();
    if (!['user', 'admin'].includes(role)) throw new ApiError(422, 'VALIDATION_ERROR', 'role harus user atau admin.', { field: 'role' });
    const passwordHash = await hashPassword(req.body.password);
    const forcePasswordChange = req.body.forcePasswordChange === false ? 0 : 1;
    const id = crypto.randomUUID();
    try {
      await storage.run(`
        INSERT INTO users (
          id, name, email, password_hash, role, status, force_password_change
        ) VALUES (?, ?, ?, ?, ?, 'active', ?)
      `, [id, name, email, passwordHash, role, forcePasswordChange]);
    } catch (error) {
      if (error.code === '23505' || String(error.code).startsWith('SQLITE_CONSTRAINT')) throw new ApiError(409, 'EMAIL_EXISTS', 'Email sudah digunakan.');
      throw error;
    }
    const user = await storage.get('SELECT * FROM users WHERE id = ?', [id]);
    const response = await adminUserResponse(user);
    await audit(storage, req, 'admin.user.create', 'user', id, null, response);
    res.status(201).json({ data: response });
  });

  app.get('/api/admin/users/:id', ...adminOnly, async (req, res) => {
    const user = await storage.get('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (!user) throw new ApiError(404, 'USER_NOT_FOUND', 'Akun tidak ditemukan.');
    res.json({ data: await adminUserResponse(user) });
  });

  app.patch('/api/admin/users/:id', ...adminOnly, async (req, res) => {
    const existing = await storage.get('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
    if (!existing) throw new ApiError(404, 'USER_NOT_FOUND', 'Akun tidak ditemukan.');
    const name = Object.hasOwn(req.body, 'name')
      ? asString(req.body.name, 'name', { min: 2, max: 100, required: true })
      : existing.name;
    const email = Object.hasOwn(req.body, 'email') ? asEmail(req.body.email) : existing.email;
    const role = Object.hasOwn(req.body, 'role') ? String(req.body.role).toLowerCase() : existing.role;
    if (!['user', 'admin'].includes(role)) throw new ApiError(422, 'VALIDATION_ERROR', 'role harus user atau admin.', { field: 'role' });
    if (req.params.id === req.user.id && role !== existing.role) {
      throw new ApiError(409, 'SELF_GUARD', 'Role akun sendiri tidak dapat diubah dari endpoint admin.');
    }
    if (existing.role === 'admin' && role !== 'admin') await ensureAdminCanBeDisabled(existing);
    let forcePasswordChange = existing.force_password_change;
    if (Object.hasOwn(req.body, 'forcePasswordChange')) {
      if (typeof req.body.forcePasswordChange !== 'boolean') {
        throw new ApiError(422, 'VALIDATION_ERROR', 'forcePasswordChange harus boolean.', { field: 'forcePasswordChange' });
      }
      forcePasswordChange = req.body.forcePasswordChange ? 1 : 0;
    }
    try {
      await storage.run(`
        UPDATE users SET name = ?, email = ?, role = ?, force_password_change = ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL
      `, [name, email, role, forcePasswordChange, now(), existing.id]);
    } catch (error) {
      if (error.code === '23505' || String(error.code).startsWith('SQLITE_CONSTRAINT')) throw new ApiError(409, 'EMAIL_EXISTS', 'Email sudah digunakan.');
      throw error;
    }
    if (role !== existing.role) {
      await storage.run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [now(), existing.id]);
    }
    const user = await storage.get('SELECT * FROM users WHERE id = ?', [existing.id]);
    const [beforeResponse, response] = await Promise.all([adminUserResponse(existing), adminUserResponse(user)]);
    await audit(storage, req, 'admin.user.update', 'user', user.id, beforeResponse, response);
    res.json({ data: response });
  });

  app.delete('/api/admin/users/:id', ...adminOnly, async (req, res) => {
    if (req.params.id === req.user.id) throw new ApiError(409, 'SELF_GUARD', 'Akun sendiri tidak dapat dihapus.');
    const target = await storage.get('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
    if (!target) throw new ApiError(404, 'USER_NOT_FOUND', 'Akun tidak ditemukan.');
    await ensureAdminCanBeDisabled(target);
    const timestamp = now();
    await storage.transaction(async (tx) => {
      await tx.run(`
        UPDATE users
        SET status = 'blocked', deleted_at = ?, updated_at = ?, blocked_at = ?,
            blocked_by = ?, blocked_reason = COALESCE(blocked_reason, 'Akun dinonaktifkan administrator')
        WHERE id = ?
      `, [timestamp, timestamp, timestamp, req.user.id, target.id]);
      await tx.run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [timestamp, target.id]);
    });
    await audit(storage, req, 'admin.user.delete', 'user', target.id, await adminUserResponse(target), { deletedAt: timestamp });
    res.status(204).end();
  });

  app.post('/api/admin/users/:id/block', ...adminOnly, async (req, res) => {
    if (req.params.id === req.user.id) throw new ApiError(409, 'SELF_GUARD', 'Akun sendiri tidak dapat diblokir.');
    const target = await storage.get('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
    if (!target) throw new ApiError(404, 'USER_NOT_FOUND', 'Akun tidak ditemukan.');
    if (target.status === 'blocked') throw new ApiError(409, 'ALREADY_BLOCKED', 'Akun sudah diblokir.');
    await ensureAdminCanBeDisabled(target);
    const reason = asString(req.body.reason, 'reason', { min: 3, max: 500, required: true });
    const timestamp = now();
    await storage.transaction(async (tx) => {
      await tx.run(`
        UPDATE users SET status = 'blocked', blocked_at = ?, blocked_by = ?,
          blocked_reason = ?, updated_at = ? WHERE id = ?
      `, [timestamp, req.user.id, reason, timestamp, target.id]);
      await tx.run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [timestamp, target.id]);
    });
    const user = await storage.get('SELECT * FROM users WHERE id = ?', [target.id]);
    const [beforeResponse, response] = await Promise.all([adminUserResponse(target), adminUserResponse(user)]);
    await audit(storage, req, 'admin.user.block', 'user', user.id, beforeResponse, response);
    res.json({ data: response });
  });

  app.post('/api/admin/users/:id/unblock', ...adminOnly, async (req, res) => {
    const target = await storage.get('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
    if (!target) throw new ApiError(404, 'USER_NOT_FOUND', 'Akun tidak ditemukan.');
    if (target.status !== 'blocked') throw new ApiError(409, 'NOT_BLOCKED', 'Akun tidak sedang diblokir.');
    await storage.run(`
      UPDATE users SET status = 'active', blocked_at = NULL, blocked_by = NULL,
        blocked_reason = NULL, updated_at = ? WHERE id = ?
    `, [now(), target.id]);
    const user = await storage.get('SELECT * FROM users WHERE id = ?', [target.id]);
    const [beforeResponse, response] = await Promise.all([adminUserResponse(target), adminUserResponse(user)]);
    await audit(storage, req, 'admin.user.unblock', 'user', user.id, beforeResponse, response);
    res.json({ data: response });
  });

  app.get('/api/admin/users/:id/sessions', ...adminOnly, async (req, res) => {
    const target = await storage.get('SELECT id FROM users WHERE id = ?', [req.params.id]);
    if (!target) throw new ApiError(404, 'USER_NOT_FOUND', 'Akun tidak ditemukan.');
    const data = await storage.all(`
      SELECT id, ip_address AS ipAddress, user_agent AS userAgent,
        created_at AS createdAt, last_seen_at AS lastSeenAt,
        expires_at AS expiresAt, revoked_at AS revokedAt
      FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 100
    `, [target.id]);
    res.json({ data });
  });

  app.post('/api/admin/users/:id/revoke-sessions', ...adminOnly, async (req, res) => {
    if (req.params.id === req.user.id) {
      throw new ApiError(409, 'SELF_GUARD', 'Gunakan logout untuk mencabut sesi akun sendiri.');
    }
    const target = await storage.get('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
    if (!target) throw new ApiError(404, 'USER_NOT_FOUND', 'Akun tidak ditemukan.');
    const result = await storage.run(`
      UPDATE sessions SET revoked_at = ?
      WHERE user_id = ? AND revoked_at IS NULL
    `, [now(), target.id]);
    await audit(storage, req, 'admin.user.sessions.revoke', 'user', target.id, undefined, { revokedSessions: result.changes });
    res.json({ revokedSessions: result.changes });
  });

  app.post('/api/admin/users/:id/reset-password', ...adminOnly, async (req, res) => {
    if (req.params.id === req.user.id) {
      throw new ApiError(409, 'SELF_GUARD', 'Gunakan fitur ganti password untuk akun sendiri.');
    }
    const target = await storage.get('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
    if (!target) throw new ApiError(404, 'USER_NOT_FOUND', 'Akun tidak ditemukan.');
    const passwordHash = await hashPassword(req.body.password);
    const timestamp = now();
    await storage.transaction(async (tx) => {
      await tx.run(`
        UPDATE users SET password_hash = ?, force_password_change = 1, updated_at = ?
        WHERE id = ?
      `, [passwordHash, timestamp, target.id]);
      await tx.run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [timestamp, target.id]);
    });
    await audit(storage, req, 'admin.user.password.reset', 'user', target.id, undefined, { forcePasswordChange: true, sessionsRevoked: true });
    res.json({ message: 'Password sementara disimpan. Pengguna wajib menggantinya saat login.' });
  });

  async function adminReviewRow(id) {
    return storage.get(`
      SELECT r.*,
        c.name AS company_name,
        (SELECT count(*) FROM review_likes rl WHERE rl.review_id = r.id) AS dynamic_likes,
        0 AS has_liked
      FROM reviews r JOIN companies c ON c.id = r.company_id
      WHERE r.id = ?
    `, [id]);
  }

  function adminReviewResponse(row) {
    return {
      ...reviewResponse(row, null),
      companyId: row.company_id,
      companyName: row.company_name,
      userId: row.user_id || null,
      moderationNote: row.moderation_note || null,
      moderatedBy: row.moderated_by || null,
      moderatedAt: row.moderated_at || null,
      deletedAt: row.deleted_at || null
    };
  }

  app.get('/api/admin/reviews', ...adminOnly, async (req, res) => {
    const { page, limit } = pagination(req.query);
    const q = String(req.query.q || '').trim().toLowerCase();
    const status = ['pending', 'approved', 'rejected', 'hidden'].includes(String(req.query.status || '').toLowerCase())
      ? String(req.query.status).toLowerCase()
      : null;
    const companyId = req.query.companyId ? positiveInteger(req.query.companyId, 'companyId') : null;
    const includeDeleted = req.query.includeDeleted === 'true';
    let rows = await storage.all(`
      SELECT r.*,
        c.name AS company_name,
        (SELECT count(*) FROM review_likes rl WHERE rl.review_id = r.id) AS dynamic_likes,
        0 AS has_liked
      FROM reviews r JOIN companies c ON c.id = r.company_id
      ${includeDeleted ? '' : 'WHERE r.deleted_at IS NULL'}
      ORDER BY r.created_at DESC, r.id DESC
    `);
    if (q) rows = rows.filter((row) => `${row.display_name} ${row.comment} ${row.company_name}`.toLowerCase().includes(q));
    if (status) rows = rows.filter((row) => row.status === status);
    if (companyId) rows = rows.filter((row) => row.company_id === companyId);
    const total = rows.length;
    const data = rows.slice((page - 1) * limit, page * limit).map(adminReviewResponse);
    res.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  });

  app.get('/api/admin/reviews/:id', ...adminOnly, async (req, res) => {
    const row = await adminReviewRow(positiveInteger(req.params.id));
    if (!row) throw new ApiError(404, 'REVIEW_NOT_FOUND', 'Ulasan tidak ditemukan.');
    res.json({ data: adminReviewResponse(row) });
  });

  async function moderateReview(req, res) {
    const id = positiveInteger(req.params.id);
    const existing = await adminReviewRow(id);
    if (!existing || existing.deleted_at) throw new ApiError(404, 'REVIEW_NOT_FOUND', 'Ulasan tidak ditemukan.');
    const status = String(req.body.status || '').trim().toLowerCase();
    if (!['pending', 'approved', 'rejected', 'hidden'].includes(status)) {
      throw new ApiError(422, 'VALIDATION_ERROR', 'status ulasan tidak valid.', { field: 'status' });
    }
    const note = Object.hasOwn(req.body, 'moderationNote')
      ? asString(req.body.moderationNote, 'moderationNote', { max: 1000 })
      : existing.moderation_note;
    const timestamp = now();
    const moderatedAt = status === 'pending' ? null : timestamp;
    const moderatedBy = status === 'pending' ? null : req.user.id;
    await storage.run(`
      UPDATE reviews SET status = ?, moderation_note = ?, moderated_by = ?,
        moderated_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL
    `, [status, note, moderatedBy, moderatedAt, timestamp, id]);
    const review = await adminReviewRow(id);
    await audit(storage, req, 'admin.review.moderate', 'review', id, adminReviewResponse(existing), adminReviewResponse(review));
    res.json({ data: adminReviewResponse(review) });
  }

  app.patch('/api/admin/reviews/:id', ...adminOnly, moderateReview);
  app.post('/api/admin/reviews/:id/moderate', ...adminOnly, moderateReview);

  app.delete('/api/admin/reviews/:id', ...adminOnly, async (req, res) => {
    const id = positiveInteger(req.params.id);
    const existing = await adminReviewRow(id);
    if (!existing || existing.deleted_at) throw new ApiError(404, 'REVIEW_NOT_FOUND', 'Ulasan tidak ditemukan.');
    const timestamp = now();
    await storage.run('UPDATE reviews SET deleted_at = ?, updated_at = ? WHERE id = ?', [timestamp, timestamp, id]);
    await audit(storage, req, 'admin.review.delete', 'review', id, adminReviewResponse(existing), { deletedAt: timestamp });
    res.status(204).end();
  });

  function reportResponse(row) {
    return {
      id: row.id,
      reporterUserId: row.reporter_user_id || null,
      reporterName: row.reporter_name,
      reporterEmail: row.reporter_email,
      companyId: row.company_id || null,
      companyName: row.company_name,
      description: row.description,
      evidenceUrl: row.evidence_url || null,
      status: row.status,
      adminNote: row.admin_note || null,
      handledBy: row.handled_by || null,
      handledAt: row.handled_at || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at || null
    };
  }

  app.get('/api/admin/reports', ...adminOnly, async (req, res) => {
    const { page, limit } = pagination(req.query);
    const q = String(req.query.q || '').trim().toLowerCase();
    const allowedStatuses = ['new', 'in_review', 'resolved', 'rejected', 'archived'];
    const status = allowedStatuses.includes(String(req.query.status || '').toLowerCase())
      ? String(req.query.status).toLowerCase()
      : null;
    const includeDeleted = req.query.includeDeleted === 'true';
    let rows = await storage.all(`
      SELECT * FROM reports ${includeDeleted ? '' : 'WHERE deleted_at IS NULL'}
      ORDER BY created_at DESC
    `);
    if (q) rows = rows.filter((row) => `${row.reporter_name} ${row.reporter_email} ${row.company_name} ${row.description}`.toLowerCase().includes(q));
    if (status) rows = rows.filter((row) => row.status === status);
    const total = rows.length;
    const data = rows.slice((page - 1) * limit, page * limit).map(reportResponse);
    res.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  });

  app.get('/api/admin/reports/:id', ...adminOnly, async (req, res) => {
    const report = await storage.get('SELECT * FROM reports WHERE id = ?', [req.params.id]);
    if (!report) throw new ApiError(404, 'REPORT_NOT_FOUND', 'Laporan tidak ditemukan.');
    res.json({ data: reportResponse(report) });
  });

  app.patch('/api/admin/reports/:id', ...adminOnly, async (req, res) => {
    const existing = await storage.get('SELECT * FROM reports WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
    if (!existing) throw new ApiError(404, 'REPORT_NOT_FOUND', 'Laporan tidak ditemukan.');
    const allowedStatuses = ['new', 'in_review', 'resolved', 'rejected', 'archived'];
    const status = Object.hasOwn(req.body, 'status') ? String(req.body.status).toLowerCase() : existing.status;
    if (!allowedStatuses.includes(status)) throw new ApiError(422, 'VALIDATION_ERROR', 'status laporan tidak valid.', { field: 'status' });
    const adminNote = Object.hasOwn(req.body, 'adminNote')
      ? asString(req.body.adminNote, 'adminNote', { max: 5000 })
      : existing.admin_note;
    const handled = ['resolved', 'rejected', 'archived'].includes(status);
    const timestamp = now();
    await storage.run(`
      UPDATE reports SET status = ?, admin_note = ?, handled_by = ?,
        handled_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL
    `, [status, adminNote, handled ? req.user.id : null, handled ? timestamp : null, timestamp, existing.id]);
    const report = await storage.get('SELECT * FROM reports WHERE id = ?', [existing.id]);
    await audit(storage, req, 'admin.report.update', 'report', report.id, reportResponse(existing), reportResponse(report));
    res.json({ data: reportResponse(report) });
  });

  app.delete('/api/admin/reports/:id', ...adminOnly, async (req, res) => {
    const existing = await storage.get('SELECT * FROM reports WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
    if (!existing) throw new ApiError(404, 'REPORT_NOT_FOUND', 'Laporan tidak ditemukan.');
    const timestamp = now();
    await storage.run(`
      UPDATE reports SET status = 'archived', deleted_at = ?, handled_by = ?,
        handled_at = ?, updated_at = ? WHERE id = ?
    `, [timestamp, req.user.id, timestamp, timestamp, existing.id]);
    await audit(storage, req, 'admin.report.delete', 'report', existing.id, reportResponse(existing), { deletedAt: timestamp });
    res.status(204).end();
  });

  app.get('/api/admin/settings', ...adminOnly, async (_req, res) => {
    const data = {};
    const metadata = {};
    for (const row of await storage.all('SELECT * FROM site_settings ORDER BY key')) {
      if (!PUBLIC_SETTING_KEYS.has(row.key)) continue;
      data[row.key] = parseJson(row.value_json);
      metadata[row.key] = { updatedAt: row.updated_at, updatedBy: row.updated_by || null };
    }
    res.json({ data, metadata, allowedKeys: [...PUBLIC_SETTING_KEYS] });
  });

  app.patch('/api/admin/settings', ...adminOnly, async (req, res) => {
    const updates = req.body.settings && typeof req.body.settings === 'object' && !Array.isArray(req.body.settings)
      ? req.body.settings
      : req.body;
    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
      throw new ApiError(422, 'VALIDATION_ERROR', 'settings harus berupa object.');
    }
    const entries = Object.entries(updates);
    if (entries.length === 0) throw new ApiError(422, 'VALIDATION_ERROR', 'Tidak ada pengaturan untuk disimpan.');
    const unknown = entries.map(([key]) => key).filter((key) => !PUBLIC_SETTING_KEYS.has(key));
    if (unknown.length) throw new ApiError(422, 'SETTING_NOT_ALLOWED', 'Ada key pengaturan yang tidak diizinkan.', { keys: unknown });
    const before = {};
    for (const [key] of entries) {
      const row = await storage.get('SELECT value_json FROM site_settings WHERE key = ?', [key]);
      before[key] = parseJson(row?.value_json);
    }
    const timestamp = now();
    await storage.transaction(async (tx) => {
      for (const [key, rawValue] of entries) {
        if (typeof rawValue !== 'string' || rawValue.length > 5000) {
          throw new ApiError(422, 'VALIDATION_ERROR', `${key} harus berupa teks maksimal 5000 karakter.`, { field: key });
        }
        await tx.run(`
          INSERT INTO site_settings (key, value_json, is_public, updated_by, updated_at)
          VALUES (?, ?, 1, ?, ?)
          ON CONFLICT(key) DO UPDATE SET
            value_json = excluded.value_json,
            is_public = 1,
            updated_by = excluded.updated_by,
            updated_at = excluded.updated_at
        `, [key, JSON.stringify(rawValue), req.user.id, timestamp]);
      }
    });
    const after = {};
    for (const [key] of entries) after[key] = parseJson((await storage.get('SELECT value_json FROM site_settings WHERE key = ?', [key])).value_json);
    await audit(storage, req, 'admin.settings.update', 'site_settings', null, before, after);
    res.json({ data: after });
  });

  app.get('/api/admin/audit-logs', ...adminOnly, async (req, res) => {
    const { page, limit, offset } = pagination(req.query);
    const clauses = ['1 = 1'];
    const values = [];
    if (req.query.actorUserId) { clauses.push('a.actor_user_id = ?'); values.push(String(req.query.actorUserId)); }
    if (req.query.action) { clauses.push('a.action = ?'); values.push(String(req.query.action)); }
    if (req.query.targetType) { clauses.push('a.target_type = ?'); values.push(String(req.query.targetType)); }
    const where = clauses.join(' AND ');
    const total = Number((await storage.get(`SELECT count(*) AS total FROM audit_logs a WHERE ${where}`, values)).total);
    const rows = await storage.all(`
      SELECT a.*, u.name AS actor_name, u.email AS actor_email
      FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id
      WHERE ${where} ORDER BY a.created_at DESC, a.id DESC LIMIT ? OFFSET ?
    `, [...values, limit, offset]);
    const data = rows.map((row) => ({
      id: row.id,
      actorUserId: row.actor_user_id || null,
      actorName: row.actor_name || null,
      actorEmail: row.actor_email || null,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id || null,
      before: parseJson(row.before_json),
      after: parseJson(row.after_json),
      ipAddress: row.ip_address || null,
      userAgent: row.user_agent || null,
      createdAt: row.created_at
    }));
    res.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  });

  app.use('/api', (req, _res, next) => {
    next(new ApiError(404, 'API_NOT_FOUND', `Endpoint ${req.method} ${req.originalUrl} tidak ditemukan.`));
  });

  const publicDirectory = path.join(__dirname, '..');
  app.use((req, res, next) => {
    const pathSegments = req.path.split('/').filter(Boolean);
    const firstSegment = pathSegments[0] || '';
    const exactSensitiveFile = /^(?:package(?:-lock)?\.json|\.env(?:\..*)?)$/.test(firstSegment);
    const containsHiddenSegment = pathSegments.some((segment) => segment.startsWith('.'));
    if (
      containsHiddenSegment
      || ['server', 'data', 'tests', 'node_modules', 'supabase', 'secrets'].includes(firstSegment)
      || exactSensitiveFile
    ) {
      return res.status(404).type('text/plain').send('Not found');
    }
    return next();
  });
  const staticOptions = {
    etag: true,
    maxAge: production ? '1h' : 0,
    dotfiles: 'deny'
  };

  // Jangan pernah mount root repository sebagai direktori statis: database,
  // source backend, tests, package metadata, dan .env tidak boleh dapat diunduh.
  for (const filename of ['index.html', 'style.css', 'script.js', 'sw.js']) {
    app.get(`/${filename}`, (_req, res) => res.sendFile(path.join(publicDirectory, filename)));
  }
  app.get('/', (_req, res) => res.sendFile(path.join(publicDirectory, 'index.html')));
  app.use('/admin', express.static(path.join(publicDirectory, 'admin'), {
    ...staticOptions,
    index: ['index.html']
  }));

  app.get(/^\/admin(?:\/.*)?$/, (req, res, next) => {
    if (path.extname(req.path)) return res.status(404).type('text/plain').send('Not found');
    const adminIndex = path.join(publicDirectory, 'admin', 'index.html');
    res.sendFile(adminIndex, (error) => {
      if (error) next(error);
    });
  });

  app.get(/^(?!\/api(?:\/|$)).*/, (req, res) => {
    if (path.extname(req.path)) return res.status(404).type('text/plain').send('Not found');
    res.sendFile(path.join(publicDirectory, 'index.html'));
  });

  app.use((error, _req, res, _next) => {
    if (res.headersSent) return;
    const status = Number(error.status) || 500;
    const code = error.code || (status === 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR');
    const message = status === 500 ? 'Terjadi kesalahan pada server.' : error.message;
    if (process.env.NODE_ENV !== 'test' && status >= 500) console.error(error);
    sendError(res, status, code, message, error.details);
  });

  return app;
}

module.exports = { createApp, ApiError, PUBLIC_SETTING_KEYS };
