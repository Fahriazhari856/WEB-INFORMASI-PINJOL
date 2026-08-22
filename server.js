'use strict';

require('dotenv').config();

const { createApp } = require('./server/app');

async function startServer() {
  const port = Number.parseInt(process.env.PORT, 10) || 3000;
  const host = process.env.HOST || '127.0.0.1';
  const app = createApp();
  const storage = app.locals.storage;

  try {
    await storage.ready();
  } catch (error) {
    await storage.close().catch(() => {});
    throw error;
  }

  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(port, host, () => {
      listener.off('error', reject);
      console.log(`CekPinjol.id berjalan di http://${host}:${port}`);
      resolve(listener);
    });
    listener.once('error', reject);
  }).catch(async (error) => {
    await storage.close().catch(() => {});
    throw error;
  });

  let shuttingDown = false;

  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Menerima ${signal}, menutup server...`);
    let exitCode = 0;
    try {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    } catch (error) {
      exitCode = 1;
      console.error(`Gagal menutup HTTP server: ${error.message}`);
    }
    try {
      await storage.close();
    } catch (error) {
      exitCode = 1;
      console.error(`Gagal menutup koneksi database: ${error.message}`);
    }
    process.exitCode = exitCode;
  }

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  return { app, server };
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error(`Server gagal dimulai: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { createApp, startServer };
