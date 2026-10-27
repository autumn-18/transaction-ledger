/**
 * Builds the Express application (but does NOT start listening).
 *
 * WHY separate app.js from server.js? Because app.js builds the app, and server.js starts it. This lets tests use the app without starting the server
 */
const express = require('express');
const routes = require('./routes');
const db = require('./db');
const { errorHandler, notFoundHandler } = require('./middlewares/errorHandler');

const app = express();

// Parse JSON bodies. The size limit protects the server from huge payloads.
app.use(express.json({ limit: '10kb' }));

// Simple health check: is the API up and can it reach the database?
app.get('/health', async (req, res) => {
  await db.query('SELECT 1');
  res.json({ success: true, data: { status: 'ok' } });
});

app.use('/api', routes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
