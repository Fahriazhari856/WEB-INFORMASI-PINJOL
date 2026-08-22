'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const publishDirectory = path.join(root, 'netlify-public');
const backendUrl = String(process.env.BACKEND_URL || '').trim().replace(/\/$/, '');

if (!/^https:\/\//i.test(backendUrl)) {
  throw new Error('BACKEND_URL wajib diisi dengan URL HTTPS backend Express, contoh: https://api.example.com');
}

fs.rmSync(publishDirectory, { recursive: true, force: true });
fs.mkdirSync(path.join(publishDirectory, 'admin'), { recursive: true });

for (const filename of ['index.html', 'script.js', 'style.css', 'sw.js']) {
  fs.copyFileSync(path.join(root, filename), path.join(publishDirectory, filename));
}
fs.cpSync(path.join(root, 'admin'), path.join(publishDirectory, 'admin'), { recursive: true });

fs.writeFileSync(
  path.join(publishDirectory, '_redirects'),
  `/api/* ${backendUrl}/api/:splat 200\n`,
  'utf8'
);

console.log(`Netlify publish directory prepared: ${publishDirectory}`);
