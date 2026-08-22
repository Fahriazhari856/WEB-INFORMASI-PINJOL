# CekPinjol.id

Aplikasi ini memiliki server Express, halaman pengguna, dan panel `/admin/` yang memakai satu penyimpanan bersama. Penyimpanan dapat menggunakan SQLite untuk pengembangan lokal atau Supabase Postgres untuk deployment. Enam data pinjol awal masih merupakan **data contoh**, bukan data legalitas resmi.

## Menjalankan lokal dengan SQLite

Persyaratan: Node.js 18 atau lebih baru.

```bash
npm install
cp .env.example .env
npm run create-admin
npm start
```

Nilai bawaan `DB_DRIVER=sqlite` memakai file `data/cekpinjol.sqlite`. Buka `http://127.0.0.1:3000/` untuk halaman pengguna atau `http://127.0.0.1:3000/admin/` untuk panel admin.

`create-admin` meminta nama, email, dan password melalui terminal. Input password disembunyikan dan tidak disimpan di source code. Akun dengan role `admin` yang masuk melalui form halaman pengguna langsung diarahkan ke `/admin/`. Setiap akun dari pendaftaran publik selalu memperoleh role `user`; role dari input browser tidak pernah dipercaya oleh server.

Pada CI/non-interaktif, berikan `ADMIN_NAME`, `ADMIN_EMAIL`, dan `ADMIN_PASSWORD` melalui secret manager runner. Jangan menulis password langsung pada perintah yang akan tersimpan di shell history. Script menolak email yang sudah terdaftar dan tidak akan diam-diam menaikkan role akun lama.

## Menghubungkan Supabase

Integrasi ini memakai koneksi Postgres dari backend Express, bukan `supabase-js` di browser. Autentikasi aplikasi tetap memakai tabel `users` dan `sessions`, sehingga tidak memerlukan `SUPABASE_ANON_KEY` maupun `service_role` key.

1. Buat project di Supabase dan tunggu database aktif.
2. Di dashboard project, klik **Connect** lalu salin connection string Postgres. Untuk server yang berjalan terus-menerus, gunakan direct connection jika host mendukung IPv6. Gunakan Supavisor **session mode** pada port `5432` jika host hanya mendukung IPv4. Direct connection paling sesuai untuk migrasi. Lihat [panduan koneksi resmi Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres).
3. Di **Database Settings > SSL Configuration**, aktifkan SSL enforcement dan unduh CA certificate. Simpan certificate di luar repository atau, untuk lokal, di folder `secrets/` yang sudah diabaikan Git. Mode `verify-full` memverifikasi certificate sekaligus hostname dan merupakan pilihan yang disarankan Supabase.
4. Salin `.env.example` menjadi `.env`, kemudian isi konfigurasi berikut tanpa meng-commit secret:

```dotenv
DB_DRIVER=postgres
DATABASE_URL=postgresql://postgres.PROJECT_REF:PASSWORD@HOST:5432/postgres
DB_POOL_MAX=5
DB_CONNECTION_TIMEOUT_MS=10000
PGSSL_MODE=verify-full
SUPABASE_DB_CA_PATH=./secrets/supabase-ca.crt
CSRF_SECRET=ganti-dengan-secret-acak-panjang
```

`SUPABASE_DB_URL` dapat dipakai sebagai fallback bila platform deployment sudah menyediakan nama tersebut dan `DATABASE_URL` tidak diisi. Sebaiknya salin URL dari dashboard agar karakter khusus pada password sudah ter-encode dengan benar.

5. Untuk project baru tanpa data SQLite yang perlu dipindahkan, pasang schema, buat administrator, lalu jalankan server:

```bash
npm install
npm run db:migrate
npm run create-admin
npm start
```

Server menunggu koneksi dan pemeriksaan database berhasil sebelum membuka port HTTP. Saat proses dihentikan, HTTP server dan pool Postgres ditutup secara teratur.

Jika akan memindahkan database SQLite yang sudah berisi akun/admin, jangan membuat admin atau menjalankan aplikasi pada Supabase terlebih dahulu. Ikuti urutan pada bagian migrasi agar tabel tujuan tetap kosong.

### Mode koneksi dan SSL

- `PGSSL_MODE=verify-full` mengenkripsi koneksi dan memverifikasi server. Isi `SUPABASE_DB_CA_PATH` dengan CA resmi Supabase; bila tidak diisi, driver memakai CA tepercaya milik sistem. Ini pilihan production yang direkomendasikan.
- `PGSSL_MODE=require` mengenkripsi lalu lintas tetapi tidak memverifikasi identitas server secara penuh. Gunakan hanya sebagai kompromi sementara ketika CA belum tersedia.
- `PGSSL_MODE=disable` hanya layak untuk Postgres lokal yang tepercaya, bukan Supabase atau production.
- Supavisor transaction mode pada port `6543` ditujukan untuk serverless/edge dan tidak mendukung prepared statements. Aplikasi Express yang persisten ini sebaiknya memakai direct connection atau session mode.

Jangan meletakkan `DATABASE_URL`, password database, file `.env`, atau kredensial admin di JavaScript frontend, commit Git, screenshot, maupun tiket publik. Putar ulang password database dari dashboard jika pernah terekspos.

## Memindahkan data SQLite ke Supabase

Lakukan backup dan hentikan sementara penulisan ke aplikasi SQLite agar data tidak berubah selama pemindahan. Gunakan project Supabase tujuan yang tabel aplikasinya masih kosong. Pastikan `DB_PATH` menunjuk file sumber dan `DATABASE_URL` menunjuk project Supabase tujuan.

```bash
npm run db:migrate
npm run db:migrate:data
```

Perintah pertama memasang schema Postgres. Perintah kedua menyalin data aplikasi dari SQLite ke Supabase. Demi mencegah data tertimpa atau terduplikasi, CLI membatalkan proses sebelum menulis jika salah satu tabel tujuan sudah berisi data; perintah ini bukan upsert dan tidak boleh dijalankan ulang terhadap target hasil migrasi. Sesi login sengaja tidak dipindahkan, sehingga semua pengguna harus login kembali setelah cutover.

Setelah selesai, verifikasi jumlah akun, perusahaan, ulasan, laporan, pengaturan, dan audit log melalui panel admin sebelum mengubah production ke `DB_DRIVER=postgres`. Simpan backup SQLite sampai hasil verifikasi diterima.

Jangan menjalankan aplikasi SQLite dan Supabase sebagai dua sumber data aktif setelah cutover. Jika migrasi gagal, jangan hapus sumber SQLite; perbaiki koneksi/schema lalu ulangi sesuai pesan aman dari CLI.

## Konfigurasi

Lihat `.env.example` untuk seluruh environment yang didukung. File `.env` otomatis dimuat saat server dan CLI dijalankan, tetapi environment dari process manager atau platform deployment tetap dapat digunakan.

- `DB_DRIVER` menerima `sqlite` atau `postgres` dan pilihan eksplisit selalu digunakan. Jika `DB_DRIVER` kosong/tidak diatur, adanya `DATABASE_URL` atau `SUPABASE_DB_URL` otomatis memilih Postgres; tanpa URL, aplikasi memakai SQLite.
- `DB_PATH` menentukan lokasi SQLite; default `data/cekpinjol.sqlite`.
- `DATABASE_URL` menentukan koneksi Postgres; `SUPABASE_DB_URL` menjadi fallback.
- `DB_POOL_MAX` membatasi jumlah koneksi Postgres per instance aplikasi.
- `DB_CONNECTION_TIMEOUT_MS` membatasi waktu menunggu koneksi awal.
- `PGSSL_MODE` dan `SUPABASE_DB_CA_PATH` mengatur verifikasi TLS.
- `PORT` dan `HOST` masing-masing default ke `3000` dan `127.0.0.1`.
- `NODE_ENV=production` mengaktifkan cookie `Secure` dan cache aset statis.
- `CSRF_SECRET` wajib berupa secret acak yang panjang dan stabil pada production agar token CSRF tetap valid setelah restart.

Production harus berada di belakang HTTPS/reverse proxy tepercaya. Atur `DB_POOL_MAX` dengan mempertimbangkan jumlah instance aplikasi dan batas koneksi project Supabase. Backup Supabase sesuai kebutuhan retensi; untuk fallback SQLite, backup file database beserta WAL secara konsisten. Database, `.env`, certificate lokal, source server, tests, `node_modules`, dan metadata package tidak disajikan sebagai aset publik.

## Kontrak API utama

Semua response error konsisten dalam bentuk:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Pesan aman untuk pengguna"
  }
}
```

Ambil token dengan `GET /api/auth/me` atau `GET /api/csrf`, lalu kirim nilainya melalui header `x-csrf-token` pada request `POST`, `PATCH`, dan `DELETE`. Sesi autentikasi memakai cookie opaque `HttpOnly`; token mentah tidak disimpan di database.

Endpoint pengguna:

- `GET /api/companies` dan `GET /api/companies/:id`
- `GET /api/public/settings`
- `POST /api/auth/register`, `/login`, `/logout`
- `PATCH /api/auth/profile` dan `POST /api/auth/change-password`
- `POST /api/companies/:id/like`
- `POST /api/reviews` dan `POST /api/reviews/:id/like`
- `POST /api/reports`

Endpoint di bawah `/api/admin` memerlukan role admin dan mencakup dashboard, CRUD perusahaan/pinjol, CRUD akun, blokir/unblock/reset password/revoke sessions, moderasi ulasan, penanganan laporan, settings whitelist, dan audit log.

Pinjol baru dibuat sebagai `draft`. Perubahan menjadi `published` mewajibkan `sourceUrl` serta `sourceCheckedAt`; entitas berstatus `Legal` juga mewajibkan `ojkNumber`. Ulasan pengguna baru berstatus `pending` dan tidak tampil kepada publik sebelum disetujui admin (penulis tetap dapat melihat ulasannya sendiri).

## Keamanan yang diterapkan

- Password di-hash dengan `crypto.scrypt`, salt acak per password, dan parameter `N=32768`, `r=8`, `p=1`.
- Sesi opaque disimpan sebagai SHA-256 hash dan dapat dicabut langsung.
- Cookie sesi `HttpOnly`, `SameSite=Lax`, dan `Secure` pada production.
- Signed double-submit CSRF untuk seluruh request mutasi.
- Helmet/CSP transisi, request size limit, rate limit API/login/laporan, validasi server, parameterized SQL, RBAC server-side, serta guard akun sendiri/admin aktif terakhir.
- Soft delete untuk akun, pinjol, ulasan, dan laporan; perubahan administratif dicatat di audit log.
- Kredensial Postgres hanya dibaca oleh backend. Browser tetap mengakses API aplikasi, bukan database secara langsung.
- Migration Supabase mengaktifkan RLS pada seluruh tabel aplikasi serta mencabut hak tabel/sekuens dari role `anon` dan `authenticated`. Tidak ada policy Data API karena seluruh akses wajib melalui backend Express; jangan membuka grant/policy tanpa meninjau [panduan keamanan Data API Supabase](https://supabase.com/docs/guides/api/securing-your-api).

## Pengujian

```bash
npm test
```

Suite default memakai SQLite terisolasi agar dapat berjalan tanpa kredensial Supabase. Selain test otomatis, jalankan migrasi terhadap project staging dan periksa endpoint health sebelum cutover production.
