'use strict';

/**
 * API-only Express app.
 *
 * On Vercel the static pages are served from the CDN and only /api/* reaches
 * this function, so there is no static hosting or page routing here.
 * Locally, src/app.js serves both the pages and this same API router.
 */

const express = require('express');

const rateLimiter = require('./middleware/rateLimiter');
const { errorHandler } = require('./middleware/errorHandler');
const apiRoutes = require('./routes');

const app = express();

app.set('trust proxy', 1);
app.disable('x-powered-by');

// The banking application. Mounted ahead of the site body parser and the site
// rate limiter: it needs a larger upload ceiling (a photographed check) and a
// far higher request budget (a dashboard screen is a dozen calls) than a
// marketing page does.
app.use('/api/bank', require('./routes/bank'));

// `verify` stashes the exact bytes so webhook signatures can be checked.
app.use(express.json({ limit: '1mb', verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: false, limit: '32kb' }));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Signed provider webhooks: verified by signature, not rate limited.
app.use('/api/inbound', require('./routes/inbound'));

app.use('/api', rateLimiter, apiRoutes);

app.use((req, res) => {
  res.status(404).json({ error: 'not_found', message: `No API route for ${req.method} ${req.path}` });
});

app.use(errorHandler);

module.exports = app;
