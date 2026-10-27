/**
 * Entry point: starts the HTTP server.  Run with:  npm start  (or npm run dev)
 */
const app = require('./app');
const config = require('./config');
const db = require('./db');

const server = app.listen(config.port, () => {
  console.log(`Ledger API running on http://localhost:${config.port}`);
});

/**
 * Graceful shutdown (Ctrl+C or a container stop):
 * stop accepting new requests, let running ones finish, then close the DB pool.
 * WHY: killing the process mid-request could leave clients without an answer.
 * (The data itself is safe either way: unfinished DB transactions roll back.)
 */
function shutdown(signal) {
  console.log(`${signal} received, shutting down...`);
  server.close(async () => {
    await db.pool.end();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
