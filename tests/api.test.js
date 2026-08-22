'use strict';

process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const Database = require('better-sqlite3');
const request = require('supertest');
const { createApp } = require('../server/app');
const { createStorage, resolveProvider } = require('../server/database');
const {
  connectionStringWithoutSslOverrides,
  convertQuestionPlaceholders,
  createPostgresDatabase,
  resolveSsl
} = require('../server/database/postgres');
const {
  TABLES: TRANSFER_TABLES,
  TARGET_TABLE_NAMES,
  ensureEmptyTarget,
  verifyTransferredCounts
} = require('../server/migrate-data');
const { hashPassword } = require('../server/security');

const ADMIN_PASSWORD = 'Passphrase Admin Sangat Aman 2026!';
const USER_PASSWORD = 'Passphrase Pengguna Aman 2026!';
const execFileAsync = promisify(execFile);

async function fixture(databasePath = ':memory:') {
  const app = createApp({
    driver: 'sqlite',
    databasePath,
    production: false,
    csrfSecret: 'csrf-secret-khusus-pengujian-yang-panjang',
    apiRateLimit: 10000,
    authRateLimit: 10000,
    reportRateLimit: 10000
  });
  const passwordHash = await hashPassword(ADMIN_PASSWORD);
  const adminId = crypto.randomUUID();
  app.locals.db.prepare(`
    INSERT INTO users (
      id, name, email, password_hash, role, status, force_password_change
    ) VALUES (?, 'Admin Utama', 'admin@example.test', ?, 'admin', 'active', 0)
  `).run(adminId, passwordHash);
  return { app, db: app.locals.db, adminId };
}

async function csrf(agent) {
  const response = await agent.get('/api/auth/me').expect(200);
  assert.equal(typeof response.body.csrfToken, 'string');
  return response.body.csrfToken;
}

async function login(agent, email, password) {
  const token = await csrf(agent);
  return agent
    .post('/api/auth/login')
    .set('x-csrf-token', token)
    .send({ email, password });
}

async function register(agent, overrides = {}) {
  const token = await csrf(agent);
  return agent
    .post('/api/auth/register')
    .set('x-csrf-token', token)
    .send({
      name: 'Pengguna Uji',
      email: 'user@example.test',
      password: USER_PASSWORD,
      ...overrides
    });
}

test('API publik menyajikan enam seed lama dengan kontrak UI dan settings whitelist', async (t) => {
  const { app, db } = await fixture();
  t.after(() => db.close());

  await request(app).get('/api/health').expect(200).expect(({ body }) => {
    assert.equal(body.status, 'ok');
    assert.equal(body.database, 'sqlite');
    assert.equal(typeof body.time, 'string');
  });

  const list = await request(app).get('/api/companies').expect(200);
  assert.equal(list.body.data.length, 6);
  const company = list.body.data[0];
  for (const field of [
    'id', 'name', 'status', 'imageUrl', 'ojkNumber', 'rating', 'likes',
    'hasLiked', 'trustLevel', 'limit', 'tenor', 'interest', 'adminFee',
    'address', 'description', 'reviews', 'sourceUrl', 'sourceCheckedAt',
    'publicationStatus', 'featured'
  ]) assert.ok(Object.hasOwn(company, field), `field ${field} harus ada`);
  assert.ok(company.reviews.length > 0);
  for (const field of ['id', 'user', 'rating', 'comment', 'likes', 'hasLiked', 'status']) {
    assert.ok(Object.hasOwn(company.reviews[0], field), `field review ${field} harus ada`);
  }

  const detail = await request(app).get(`/api/companies/${company.id}`).expect(200);
  assert.equal(detail.body.data.id, company.id);
  const settings = await request(app).get('/api/public/settings').expect(200);
  assert.equal(settings.body.data.siteName, 'CekPinjol.id');
  assert.equal(typeof settings.body.data.heroSubtitle, 'string');

  const rootPage = await request(app).get('/').expect(200);
  const csp = rootPage.headers['content-security-policy'];
  assert.match(csp, /script-src-attr 'unsafe-inline'/);
  assert.doesNotMatch(csp, /script-src-attr 'none'/);

  for (const sensitivePath of [
    '/package.json', '/package-lock.json', '/server/app.js', '/tests/api.test.js',
    '/data/cekpinjol.sqlite', '/.env', '/.env.local', '/.git/config', '/admin/.git/config', '/README.md',
    '/supabase/migrations/202608220001_initial_schema.sql', '/secrets/supabase-ca.crt'
  ]) {
    await request(app).get(sensitivePath).expect(404);
  }
});

test('CSRF, registrasi, login, profil, password scrypt, dan pencabutan sesi bekerja', async (t) => {
  const { app, db } = await fixture();
  t.after(() => db.close());
  const agent = request.agent(app);

  await agent.post('/api/auth/register').send({}).expect(403).expect(({ body }) => {
    assert.equal(body.error.code, 'CSRF_INVALID');
  });

  const registered = await register(agent, { role: 'admin' });
  assert.equal(registered.status, 201);
  assert.equal(registered.body.user.email, 'user@example.test');
  assert.equal(registered.body.user.role, 'user');
  await agent.get('/api/admin/dashboard').expect(403).expect(({ body }) => {
    assert.equal(body.error.code, 'ADMIN_REQUIRED');
    assert.equal(JSON.stringify(body).includes('password_hash'), false);
  });
  const stored = db.prepare('SELECT * FROM users WHERE email = ?').get('user@example.test');
  assert.match(stored.password_hash, /^scrypt\$32768\$8\$1\$/);
  assert.equal(stored.password_hash.includes(USER_PASSWORD), false);

  const profileToken = registered.body.csrfToken;
  await agent.patch('/api/auth/profile')
    .set('x-csrf-token', profileToken)
    .send({ name: 'Nama Baru' })
    .expect(200)
    .expect(({ body }) => assert.equal(body.user.name, 'Nama Baru'));

  await agent.post('/api/auth/change-password')
    .set('x-csrf-token', profileToken)
    .send({
      currentPassword: 'Kata sandi lama yang salah',
      newPassword: 'Passphrase Baru Sangat Aman 2027!'
    })
    .expect(401)
    .expect(({ body }) => assert.equal(body.error.code, 'INVALID_CURRENT_PASSWORD'));
  await agent.get('/api/auth/me').expect(200).expect(({ body }) => {
    assert.equal(body.user.email, 'user@example.test');
  });

  await agent.post('/api/auth/change-password')
    .set('x-csrf-token', profileToken)
    .send({ currentPassword: USER_PASSWORD, newPassword: 'Passphrase Baru Sangat Aman 2027!' })
    .expect(200)
    .expect(({ body }) => assert.equal(body.reauthenticate, true));

  await agent.get('/api/auth/me').expect(200).expect(({ body }) => assert.equal(body.user, null));
  assert.equal((await login(agent, 'user@example.test', USER_PASSWORD)).status, 401);
  assert.equal((await login(agent, 'user@example.test', 'Passphrase Baru Sangat Aman 2027!')).status, 200);
});

test('like dan unlike perusahaan memakai aksi eksplisit di database', async (t) => {
  const { app, db } = await fixture();
  t.after(() => db.close());
  const agent = request.agent(app);
  const loggedIn = await login(agent, 'admin@example.test', ADMIN_PASSWORD);
  const token = loggedIn.body.csrfToken;

  await agent.post('/api/companies/1/like')
    .set('x-csrf-token', token)
    .send({ action: 'like' })
    .expect(200)
    .expect(({ body }) => assert.equal(body.hasLiked, true));
  assert.equal(db.prepare('SELECT count(*) AS total FROM company_likes WHERE company_id = 1').get().total, 1);

  await agent.post('/api/companies/1/like')
    .set('x-csrf-token', token)
    .send({ action: 'like' })
    .expect(200)
    .expect(({ body }) => assert.equal(body.hasLiked, false));
  assert.equal(db.prepare('SELECT count(*) AS total FROM company_likes WHERE company_id = 1').get().total, 0);

  await agent.post('/api/companies/1/like')
    .set('x-csrf-token', token)
    .send({ action: 'unlike' })
    .expect(200)
    .expect(({ body }) => assert.equal(body.hasUnliked, true));
  assert.equal(db.prepare('SELECT count(*) AS total FROM company_unlikes WHERE company_id = 1').get().total, 1);

  await agent.post('/api/companies/1/like')
    .set('x-csrf-token', token)
    .send({ action: 'unlike' })
    .expect(200)
    .expect(({ body }) => assert.equal(body.hasUnliked, false));
  assert.equal(db.prepare('SELECT count(*) AS total FROM company_unlikes WHERE company_id = 1').get().total, 0);

  await agent.post('/api/companies/1/like')
    .set('x-csrf-token', token)
    .send({ action: 'like' })
    .expect(200)
    .expect(({ body }) => assert.equal(body.hasLiked, true));
  assert.equal(db.prepare('SELECT count(*) AS total FROM company_likes WHERE company_id = 1').get().total, 1);
});

test('review baru pending, hanya terlihat penulis, lalu tampil publik sesudah moderasi', async (t) => {
  const { app, db } = await fixture();
  t.after(() => db.close());
  const userAgent = request.agent(app);
  const adminAgent = request.agent(app);

  const registered = await register(userAgent);
  assert.equal(registered.status, 201);
  const userCsrf = registered.body.csrfToken;
  const created = await userAgent.post('/api/reviews')
    .set('x-csrf-token', userCsrf)
    .send({ companyId: 1, rating: 3, comment: '<b>Ulasan uji tampil sebagai teks</b>' })
    .expect(201);
  assert.equal(created.body.data.status, 'pending');
  const reviewId = created.body.data.id;

  const anonymousDetail = await request(app).get('/api/companies/1').expect(200);
  assert.equal(anonymousDetail.body.data.reviews.some((review) => review.id === reviewId), false);
  const authorDetail = await userAgent.get('/api/companies/1').expect(200);
  assert.equal(authorDetail.body.data.reviews.find((review) => review.id === reviewId).status, 'pending');

  const adminLogin = await login(adminAgent, 'admin@example.test', ADMIN_PASSWORD);
  assert.equal(adminLogin.status, 200);
  await adminAgent.post(`/api/admin/reviews/${reviewId}/moderate`)
    .set('x-csrf-token', adminLogin.body.csrfToken)
    .send({ status: 'approved', moderationNote: 'Lolos pemeriksaan' })
    .expect(200);

  const publicAfter = await request(app).get('/api/companies/1').expect(200);
  assert.equal(publicAfter.body.data.reviews.find((review) => review.id === reviewId).comment, '<b>Ulasan uji tampil sebagai teks</b>');
  await userAgent.post(`/api/reviews/${reviewId}/like`)
    .set('x-csrf-token', userCsrf)
    .expect(200)
    .expect(({ body }) => assert.equal(body.hasLiked, true));
});

test('admin CRUD pinjol terhubung ke API publik dan memakai optimistic locking', async (t) => {
  const { app, db } = await fixture();
  t.after(() => db.close());
  const adminAgent = request.agent(app);
  const loggedIn = await login(adminAgent, 'admin@example.test', ADMIN_PASSWORD);
  assert.equal(loggedIn.status, 200);
  const token = loggedIn.body.csrfToken;

  const created = await adminAgent.post('/api/admin/companies')
    .set('x-csrf-token', token)
    .send({
      name: 'Pinjol Uji',
      status: 'Legal',
      ojkNumber: 'KEP-TEST/2026',
      description: 'Deskripsi cukup panjang untuk pinjol pengujian.',
      trustLevel: 80
    })
    .expect(201);
  const companyId = created.body.data.id;
  assert.equal(created.body.data.publicationStatus, 'draft');
  await request(app).get(`/api/companies/${companyId}`).expect(404);

  const published = await adminAgent.patch(`/api/admin/companies/${companyId}`)
    .set('x-csrf-token', token)
    .send({
      version: created.body.data.version,
      publicationStatus: 'published',
      sourceUrl: 'https://example.test/sumber',
      sourceCheckedAt: '2026-08-22T00:00:00.000Z',
      featured: true
    })
    .expect(200);
  await request(app).get(`/api/companies/${companyId}`).expect(200);

  await adminAgent.patch(`/api/admin/companies/${companyId}`)
    .set('x-csrf-token', token)
    .send({ version: created.body.data.version, name: 'Edit konflik' })
    .expect(409)
    .expect(({ body }) => assert.equal(body.error.code, 'VERSION_CONFLICT'));

  await adminAgent.delete(`/api/admin/companies/${companyId}`)
    .set('x-csrf-token', token)
    .expect(204);
  await request(app).get(`/api/companies/${companyId}`).expect(404);
  assert.equal(published.body.data.sourceUrl, 'https://example.test/sumber');
});

test('admin mengelola akun, memblokir sesi aktif, membuka blokir, dan self guard', async (t) => {
  const { app, db, adminId } = await fixture();
  t.after(() => db.close());
  const adminAgent = request.agent(app);
  const userAgent = request.agent(app);
  const adminLogin = await login(adminAgent, 'admin@example.test', ADMIN_PASSWORD);
  assert.equal(adminLogin.status, 200);
  const adminCsrf = adminLogin.body.csrfToken;

  const created = await adminAgent.post('/api/admin/users')
    .set('x-csrf-token', adminCsrf)
    .send({
      name: 'Akun Kelolaan',
      email: 'managed@example.test',
      password: USER_PASSWORD,
      role: 'user',
      forcePasswordChange: false
    })
    .expect(201);
  const userId = created.body.data.id;
  const userLogin = await login(userAgent, 'managed@example.test', USER_PASSWORD);
  assert.equal(userLogin.status, 200);

  await adminAgent.post(`/api/admin/users/${userId}/block`)
    .set('x-csrf-token', adminCsrf)
    .send({ reason: 'Pelanggaran aturan pengujian' })
    .expect(200)
    .expect(({ body }) => assert.equal(body.data.status, 'blocked'));

  await userAgent.post('/api/reviews')
    .set('x-csrf-token', userLogin.body.csrfToken)
    .send({ companyId: 1, rating: 5, comment: 'Tidak boleh tersimpan' })
    .expect(401);
  assert.equal((await login(request.agent(app), 'managed@example.test', USER_PASSWORD)).status, 423);

  await adminAgent.post(`/api/admin/users/${userId}/unblock`)
    .set('x-csrf-token', adminCsrf)
    .expect(200);
  assert.equal((await login(request.agent(app), 'managed@example.test', USER_PASSWORD)).status, 200);

  await adminAgent.delete(`/api/admin/users/${adminId}`)
    .set('x-csrf-token', adminCsrf)
    .expect(409)
    .expect(({ body }) => assert.equal(body.error.code, 'SELF_GUARD'));
});

test('laporan, settings whitelist, dashboard, dan audit log admin berfungsi', async (t) => {
  const { app, db } = await fixture();
  t.after(() => db.close());
  const visitor = request.agent(app);
  const reportToken = await csrf(visitor);
  const report = await visitor.post('/api/reports')
    .set('x-csrf-token', reportToken)
    .send({
      reporterName: 'Pelapor Uji',
      reporterEmail: 'pelapor@example.test',
      companyName: 'Aplikasi Mencurigakan',
      description: 'Indikasi penagihan kasar dan biaya yang tidak transparan.'
    })
    .expect(201);

  const adminAgent = request.agent(app);
  const loggedIn = await login(adminAgent, 'admin@example.test', ADMIN_PASSWORD);
  assert.equal(loggedIn.status, 200);
  const token = loggedIn.body.csrfToken;
  const reports = await adminAgent.get('/api/admin/reports').expect(200);
  assert.equal(reports.body.data.some((item) => item.id === report.body.data.id), true);
  await adminAgent.patch(`/api/admin/reports/${report.body.data.id}`)
    .set('x-csrf-token', token)
    .send({ status: 'resolved', adminNote: 'Sudah diteruskan.' })
    .expect(200);

  await adminAgent.patch('/api/admin/settings')
    .set('x-csrf-token', token)
    .send({ heroSubtitle: 'Subjudul baru dari admin' })
    .expect(200);
  await adminAgent.patch('/api/admin/settings')
    .set('x-csrf-token', token)
    .send({ databasePassword: 'tidak boleh' })
    .expect(422)
    .expect(({ body }) => assert.equal(body.error.code, 'SETTING_NOT_ALLOWED'));
  await request(app).get('/api/public/settings').expect(200)
    .expect(({ body }) => assert.equal(body.data.heroSubtitle, 'Subjudul baru dari admin'));

  const dashboard = await adminAgent.get('/api/admin/dashboard').expect(200);
  assert.equal(typeof dashboard.body.data.counts.newReports, 'number');
  const audit = await adminAgent.get('/api/admin/audit-logs').expect(200);
  assert.equal(audit.body.data.some((item) => item.action === 'admin.settings.update'), true);
  assert.equal(audit.body.data.some((item) => item.action === 'admin.report.update'), true);
});

test('data dan akun tetap tersedia setelah database ditutup dan aplikasi dibuka kembali', async (t) => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'cekpinjol-api-test-'));
  const databasePath = path.join(temporaryDirectory, 'persistence.sqlite');
  t.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));

  const first = await fixture(databasePath);
  const adminAgent = request.agent(first.app);
  const loggedIn = await login(adminAgent, 'admin@example.test', ADMIN_PASSWORD);
  assert.equal(loggedIn.status, 200);
  const created = await adminAgent.post('/api/admin/companies')
    .set('x-csrf-token', loggedIn.body.csrfToken)
    .send({
      name: 'Persisten Pinjol',
      status: 'Ilegal',
      description: 'Data ini digunakan untuk membuktikan persistensi SQLite.',
      publicationStatus: 'published',
      sourceUrl: 'https://example.test/persisten',
      sourceCheckedAt: '2026-08-22T01:00:00.000Z'
    })
    .expect(201);
  const companyId = created.body.data.id;
  first.db.close();

  const secondApp = createApp({
    databasePath,
    production: false,
    csrfSecret: 'csrf-secret-kedua-setelah-restart',
    apiRateLimit: 10000,
    authRateLimit: 10000
  });
  t.after(() => secondApp.locals.db.close());
  await request(secondApp).get(`/api/companies/${companyId}`).expect(200)
    .expect(({ body }) => assert.equal(body.data.name, 'Persisten Pinjol'));
  assert.equal(secondApp.locals.db.prepare('SELECT count(*) AS total FROM companies').get().total, 7);
  assert.equal(secondApp.locals.db.prepare('SELECT role FROM users WHERE email = ?').get('admin@example.test').role, 'admin');
});

test('script create-admin membuat admin dari input aman tanpa kredensial hard-coded', async (t) => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'cekpinjol-admin-test-'));
  const databasePath = path.join(temporaryDirectory, 'admin.sqlite');
  t.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));

  const result = await execFileAsync(process.execPath, [
    path.join(__dirname, '..', 'server', 'create-admin.js'),
    '--name', 'Admin Script',
    '--email', 'script-admin@example.test'
  ], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      DB_DRIVER: 'sqlite',
      DATABASE_URL: '',
      SUPABASE_DB_URL: '',
      DB_PATH: databasePath,
      ADMIN_PASSWORD
    }
  });
  assert.match(result.stdout, /berhasil dibuat/i);
  assert.equal(result.stdout.includes(ADMIN_PASSWORD), false);

  const database = new Database(databasePath, { readonly: true });
  try {
    const user = database.prepare('SELECT * FROM users WHERE email = ?').get('script-admin@example.test');
    assert.equal(user.role, 'admin');
    assert.equal(user.status, 'active');
    assert.match(user.password_hash, /^scrypt\$/);
    assert.equal(user.password_hash.includes(ADMIN_PASSWORD), false);
  } finally {
    database.close();
  }
});

test('payload XSS tetap berupa data JSON dan tidak disisipkan ke HTML statis', async (t) => {
  const { app, db } = await fixture();
  t.after(() => db.close());

  const payload = `<img src=x onerror="globalThis.__xss=1">&'\"`;
  const adminAgent = request.agent(app);
  const adminLogin = await login(adminAgent, 'admin@example.test', ADMIN_PASSWORD);
  assert.equal(adminLogin.status, 200);
  const adminCsrf = adminLogin.body.csrfToken;

  const companyName = `Pinjol ${payload}`;
  const companyDescription = `Deskripsi aman yang memuat payload ${payload}`;
  const createdCompany = await adminAgent.post('/api/admin/companies')
    .set('x-csrf-token', adminCsrf)
    .send({
      name: companyName,
      status: 'Ilegal',
      description: companyDescription,
      publicationStatus: 'published',
      sourceUrl: 'https://example.test/xss-source',
      sourceCheckedAt: '2026-08-22T03:00:00.000Z'
    })
    .expect('content-type', /application\/json/)
    .expect(201);
  const companyId = createdCompany.body.data.id;

  const publicCompany = await request(app)
    .get(`/api/companies/${companyId}`)
    .expect('content-type', /application\/json/)
    .expect(200);
  assert.equal(publicCompany.body.data.name, companyName);
  assert.equal(publicCompany.body.data.description, companyDescription);

  const userAgent = request.agent(app);
  const userName = `User ${payload}`;
  const registered = await register(userAgent, {
    name: userName,
    email: 'xss-user@example.test'
  });
  assert.equal(registered.status, 201);
  const reviewComment = `Ulasan tetap teks ${payload}`;
  const review = await userAgent.post('/api/reviews')
    .set('x-csrf-token', registered.body.csrfToken)
    .send({ companyId, rating: 4, comment: reviewComment })
    .expect(201);

  await adminAgent.post(`/api/admin/reviews/${review.body.data.id}/moderate`)
    .set('x-csrf-token', adminCsrf)
    .send({ status: 'approved' })
    .expect(200);
  const publicAfterModeration = await request(app).get(`/api/companies/${companyId}`).expect(200);
  const publishedReview = publicAfterModeration.body.data.reviews.find((item) => item.id === review.body.data.id);
  assert.equal(publishedReview.user, userName);
  assert.equal(publishedReview.comment, reviewComment);

  const reportDescription = `Laporan menyimpan payload sebagai teks ${payload}`;
  const report = await userAgent.post('/api/reports')
    .set('x-csrf-token', registered.body.csrfToken)
    .send({
      reporterName: userName,
      reporterEmail: 'xss-user@example.test',
      companyName,
      description: reportDescription
    })
    .expect(201);
  const adminReports = await adminAgent.get('/api/admin/reports').expect(200);
  const storedReport = adminReports.body.data.find((item) => item.id === report.body.data.id);
  assert.equal(storedReport.reporterName, userName);
  assert.equal(storedReport.companyName, companyName);
  assert.equal(storedReport.description, reportDescription);

  await adminAgent.patch('/api/admin/settings')
    .set('x-csrf-token', adminCsrf)
    .send({ heroTitle: payload })
    .expect(200);
  await request(app).get('/api/public/settings')
    .expect('content-type', /application\/json/)
    .expect(200)
    .expect(({ body }) => assert.equal(body.data.heroTitle, payload));

  for (const route of ['/', '/admin/']) {
    await request(app).get(route)
      .expect('content-type', /text\/html/)
      .expect(200)
      .expect(({ text }) => assert.equal(text.includes(payload), false));
  }

  const publicScript = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');
  const adminScript = fs.readFileSync(path.join(__dirname, '..', 'admin', 'admin.js'), 'utf8');
  assert.match(publicScript, /function escapeHtml\s*\(/);
  assert.match(publicScript, /state\.currentUser\s*=\s*result\?\.user\s*\?\?\s*null/);
  assert.match(publicScript, /async function ensureCsrfToken\s*\(/);
  assert.match(publicScript, /mode\s*===\s*'login'\s*&&\s*redirectAdminToPanel\(\)/);
  assert.match(publicScript, /window\.location\.assign\('\/admin\/'\)/);
  assert.match(publicScript, /minlength="\$\{isLogin\s*\?\s*'1'\s*:\s*'12'\}"/);
  assert.match(publicScript, /errorCode\s*===\s*'AUTH_REQUIRED'/);
  assert.match(adminScript, /node\.textContent\s*=\s*String\(props\.text\)/);
  assert.match(adminScript, /errorCode\s*===\s*"AUTH_REQUIRED"/);
});

test('pemilihan provider database eksplisit, tervalidasi, dan SQLite tetap menjadi fallback aman', async () => {
  assert.equal(resolveProvider({ driver: 'sqlite' }), 'sqlite');
  assert.equal(resolveProvider({ driver: 'sqlite', connectionString: 'postgresql://example.invalid/db' }), 'sqlite');
  assert.equal(resolveProvider({ driver: 'postgres' }), 'postgres');
  assert.equal(resolveProvider({ driver: 'postgresql' }), 'postgres');
  assert.equal(resolveProvider({ connectionString: 'postgresql://example.invalid/db' }), 'postgres');
  assert.throws(() => resolveProvider({ driver: 'mysql' }), /DB_DRIVER tidak didukung/);

  const storage = createStorage({ driver: 'sqlite', filename: ':memory:', seed: false });
  try {
    assert.equal(storage.provider, 'sqlite');
    assert.ok(storage.raw);
    assert.equal(await storage.ping(), true);
  } finally {
    await storage.close();
  }

  const previousDriver = process.env.DB_DRIVER;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  let isolatedApp;
  try {
    process.env.DB_DRIVER = 'postgres';
    process.env.DATABASE_URL = 'postgresql://jangan-disentuh:rahasia@example.invalid/live';
    isolatedApp = createApp({
      databasePath: ':memory:',
      seed: false,
      production: false,
      csrfSecret: 'csrf-secret-isolasi-provider-yang-panjang'
    });
    assert.equal(isolatedApp.locals.storage.provider, 'sqlite');
  } finally {
    if (isolatedApp) await isolatedApp.locals.storage.close();
    if (previousDriver === undefined) delete process.env.DB_DRIVER;
    else process.env.DB_DRIVER = previousDriver;
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
});

test('konversi placeholder PostgreSQL tidak menyentuh literal, identifier, komentar, operator JSON, atau dollar quote', () => {
  const converted = convertQuestionPlaceholders(`
    SELECT ? AS first_value,
      '?' AS literal_question,
      "?" AS identifier_question,
      payload ?? 'key' AS json_key,
      payload ?| array['a', 'b'] AS json_any,
      payload ?& array['a', 'b'] AS json_all,
      $$? dollar body$$ AS dollar_body,
      $tag$? tagged body$tag$ AS tagged_body
    -- komentar ? tidak boleh menjadi placeholder
    /* komentar luar ? /* komentar bersarang ? */ selesai */
    WHERE id = ?
  `, ['nilai', 27]);

  assert.match(converted.text, /SELECT \$1 AS first_value/);
  assert.match(converted.text, /WHERE id = \$2/);
  assert.match(converted.text, /'\?' AS literal_question/);
  assert.match(converted.text, /payload \? 'key' AS json_key/);
  assert.match(converted.text, /payload \?\| array/);
  assert.match(converted.text, /payload \?& array/);
  assert.match(converted.text, /\$\$\? dollar body\$\$/);
  assert.match(converted.text, /\$tag\$\? tagged body\$tag\$/);
  assert.deepEqual(converted.values, ['nilai', 27]);

  assert.throws(
    () => convertQuestionPlaceholders('SELECT ? + ?', [1]),
    /Jumlah placeholder \(2\) tidak sama/
  );
  assert.throws(
    () => convertQuestionPlaceholders('SELECT $1, ?', [1]),
    /Jangan mencampur placeholder/
  );
  assert.throws(
    () => convertQuestionPlaceholders('SELECT 1', [1]),
    /tidak memiliki placeholder/
  );
  assert.throws(
    () => convertQuestionPlaceholders('SELECT /* belum selesai ?', []),
    /belum ditutup/
  );
});

test('adapter PostgreSQL memakai pool secara async, menormalkan int8, commit, rollback, dan menutup koneksi', async () => {
  const poolCalls = [];
  const clientCalls = [];
  let releaseCount = 0;
  let endCount = 0;

  function fakeResult(text, values) {
    if (/count_value/.test(text)) {
      return {
        rows: [{ count_value: '9007199254740991' }],
        fields: [{ name: 'count_value', dataTypeID: 20 }],
        rowCount: 1
      };
    }
    if (/RETURNING id/.test(text)) {
      return { rows: [{ id: 41 }], fields: [{ name: 'id', dataTypeID: 23 }], rowCount: 1 };
    }
    if (/SELECT \$1 AS value/.test(text)) {
      return { rows: [{ value: values[0] }], fields: [{ name: 'value', dataTypeID: 23 }], rowCount: 1 };
    }
    return { rows: [{ ok: 1 }], fields: [{ name: 'ok', dataTypeID: 23 }], rowCount: 1 };
  }

  const client = {
    async query(text, values = []) {
      clientCalls.push({ text, values });
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
        return { rows: [], fields: [], rowCount: null };
      }
      return fakeResult(text, values);
    },
    release() {
      releaseCount += 1;
    }
  };
  const pool = {
    on() {},
    async query(text, values = []) {
      poolCalls.push({ text, values });
      return fakeResult(text, values);
    },
    async connect() {
      return client;
    },
    async end() {
      endCount += 1;
    }
  };

  const storage = createPostgresDatabase({
    connectionString: 'postgresql://backend:encoded%24password@example.invalid:5432/app?sslmode=require',
    pool,
    ssl: { rejectUnauthorized: true }
  });
  assert.equal(storage.provider, 'postgres');
  await storage.ready();
  await storage.ready();
  assert.equal(poolCalls.filter(({ text }) => text === 'SELECT 1 AS ok').length, 1);

  const value = await storage.get('SELECT ? AS value', [17]);
  assert.equal(value.value, 17);
  assert.deepEqual(poolCalls.at(-1), { text: 'SELECT $1 AS value', values: [17] });
  const count = await storage.get('SELECT count(*)::bigint AS count_value FROM users');
  assert.equal(count.count_value, Number.MAX_SAFE_INTEGER);

  const insertedId = await storage.transaction(async (tx) => {
    const inserted = await tx.get('INSERT INTO companies (name) VALUES (?) RETURNING id', ['Uji']);
    return inserted.id;
  });
  assert.equal(insertedId, 41);
  assert.deepEqual(clientCalls.slice(0, 3).map(({ text }) => text), [
    'BEGIN',
    'INSERT INTO companies (name) VALUES ($1) RETURNING id',
    'COMMIT'
  ]);

  await assert.rejects(
    storage.transaction(async (tx) => {
      await tx.run('UPDATE users SET status = ? WHERE id = ?', ['blocked', 'user-id']);
      throw new Error('gagal disengaja');
    }),
    /gagal disengaja/
  );
  assert.equal(clientCalls.some(({ text }) => text === 'ROLLBACK'), true);
  assert.equal(releaseCount, 2);

  await storage.close();
  await storage.close();
  assert.equal(endCount, 1);
  await assert.rejects(storage.ping(), /sudah ditutup/);
});

test('konfigurasi koneksi PostgreSQL membersihkan override SSL dan mendukung verifikasi CA', () => {
  const cleaned = new URL(connectionStringWithoutSslOverrides(
    'postgresql://backend:encoded%24password@example.invalid/app?sslmode=require&SSLROOTCERT=ca.pem&application_name=test'
  ));
  assert.equal(cleaned.searchParams.has('sslmode'), false);
  assert.equal(cleaned.searchParams.has('SSLROOTCERT'), false);
  assert.equal(cleaned.searchParams.get('application_name'), 'test');
  assert.throws(
    () => connectionStringWithoutSslOverrides('https://example.invalid/database'),
    /protokol postgres/
  );

  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'cekpinjol-ca-test-'));
  const caPath = path.join(temporaryDirectory, 'supabase-ca.crt');
  fs.writeFileSync(caPath, '-----BEGIN CERTIFICATE-----\nTEST-CA\n-----END CERTIFICATE-----\n');
  const previousMode = process.env.PGSSL_MODE;
  const previousCaPath = process.env.SUPABASE_DB_CA_PATH;
  try {
    process.env.PGSSL_MODE = 'verify-full';
    process.env.SUPABASE_DB_CA_PATH = caPath;
    const verified = resolveSsl();
    assert.equal(verified.rejectUnauthorized, true);
    assert.match(verified.ca, /TEST-CA/);

    delete process.env.SUPABASE_DB_CA_PATH;
    process.env.PGSSL_MODE = 'require';
    assert.deepEqual(resolveSsl(), { rejectUnauthorized: false });
    process.env.PGSSL_MODE = 'disable';
    assert.equal(resolveSsl(), false);
    process.env.PGSSL_MODE = 'tidak-valid';
    assert.throws(() => resolveSsl(), /PGSSL_MODE harus/);
  } finally {
    if (previousMode === undefined) delete process.env.PGSSL_MODE;
    else process.env.PGSSL_MODE = previousMode;
    if (previousCaPath === undefined) delete process.env.SUPABASE_DB_CA_PATH;
    else process.env.SUPABASE_DB_CA_PATH = previousCaPath;
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test('migration Supabase mengaktifkan RLS dan mencabut akses Data API untuk seluruh tabel aplikasi', () => {
  const migrationPath = path.join(
    __dirname,
    '..',
    'supabase',
    'migrations',
    '202608220001_initial_schema.sql'
  );
  const sql = fs.readFileSync(migrationPath, 'utf8');
  const tables = [
    'app_schema_migrations', 'users', 'sessions', 'companies', 'company_likes',
    'reviews', 'review_likes', 'reports', 'site_settings', 'audit_logs'
  ];

  for (const table of tables) {
    assert.match(
      sql,
      new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`, 'i'),
      `RLS wajib aktif pada ${table}`
    );
  }
  assert.match(sql, /rolname IN \('anon', 'authenticated'\)/i);
  assert.match(sql, /REVOKE ALL PRIVILEGES ON TABLE[\s\S]+FROM %I/i);
  assert.match(sql, /REVOKE ALL PRIVILEGES ON SEQUENCE[\s\S]+FROM %I/i);
  assert.match(sql, /users_email_nocase_uq[\s\S]+lower\(email\)/i);
  assert.match(sql, /companies_name_nocase_uq[\s\S]+lower\(name\)/i);
  assert.doesNotMatch(sql, /CREATE\s+POLICY/i);
});

test('transfer SQLite ke Supabase tidak menyalin sesi dan memverifikasi jumlah baris sebelum commit', async () => {
  const transferNames = TRANSFER_TABLES.map(({ name }) => name);
  assert.equal(transferNames.includes('sessions'), false);
  assert.equal(TARGET_TABLE_NAMES.includes('sessions'), true);

  const emptyTargetQueries = [];
  await ensureEmptyTarget({
    async get(sql) {
      emptyTargetQueries.push(sql);
      return { total: 0 };
    }
  });
  assert.equal(emptyTargetQueries.some((sql) => /public\.sessions/.test(sql)), true);

  await assert.rejects(
    ensureEmptyTarget({
      async get(sql) {
        return { total: /public\.sessions/.test(sql) ? 1 : 0 };
      }
    }),
    /sessions=1/
  );

  const source = new Map(TRANSFER_TABLES.map(({ name }, index) => [
    name,
    Array.from({ length: index % 3 }, () => ({}))
  ]));
  await verifyTransferredCounts({
    async get(sql) {
      const table = TRANSFER_TABLES.find(({ name }) => sql.includes(`public.${name}`));
      return { total: source.get(table.name).length };
    }
  }, source);

  await assert.rejects(
    verifyTransferredCounts({
      async get(sql) {
        const table = TRANSFER_TABLES.find(({ name }) => sql.includes(`public.${name}`));
        const total = source.get(table.name).length + (table.name === 'users' ? 1 : 0);
        return { total };
      }
    }, source),
    /Verifikasi transfer gagal untuk users/
  );
});

test('health menampilkan provider tanpa kredensial dan error koneksi tidak membocorkan rahasia', async () => {
  let readyCalls = 0;
  let pingCalls = 0;
  const healthyStorage = {
    provider: 'postgres',
    async ready() { readyCalls += 1; },
    async ping() { pingCalls += 1; return true; }
  };
  const healthyApp = createApp({
    storage: healthyStorage,
    production: false,
    csrfSecret: 'csrf-secret-health-test-yang-panjang',
    apiRateLimit: 10000
  });
  const healthy = await request(healthyApp).get('/api/health').expect(200);
  assert.equal(healthy.body.status, 'ok');
  assert.equal(healthy.body.database, 'postgres');
  assert.equal(typeof healthy.body.time, 'string');
  assert.equal(readyCalls, 2);
  assert.equal(pingCalls, 1);
  assert.doesNotMatch(JSON.stringify(healthy.body), /password|DATABASE_URL|SUPABASE_DB_URL/i);

  const databaseSecret = 'postgresql://backend:rahasia-database@example.invalid/app';
  const failingApp = createApp({
    storage: {
      provider: 'postgres',
      async ready() { throw new Error(`koneksi gagal ke ${databaseSecret}`); },
      async ping() { throw new Error('tidak boleh dipanggil'); }
    },
    production: false,
    csrfSecret: 'csrf-secret-health-failure-yang-panjang',
    apiRateLimit: 10000
  });
  const failure = await request(failingApp).get('/api/health').expect(500);
  assert.equal(failure.body.error.code, 'INTERNAL_ERROR');
  assert.equal(failure.body.error.message, 'Terjadi kesalahan pada server.');
  assert.equal(JSON.stringify(failure.body).includes(databaseSecret), false);

  for (const source of [
    fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8'),
    fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8'),
    fs.readFileSync(path.join(__dirname, '..', 'admin', 'index.html'), 'utf8'),
    fs.readFileSync(path.join(__dirname, '..', 'admin', 'admin.js'), 'utf8')
  ]) {
    assert.doesNotMatch(source, /DATABASE_URL|SUPABASE_DB_URL|postgres(?:ql)?:\/\//i);
  }
});
