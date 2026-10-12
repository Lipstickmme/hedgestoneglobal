'use strict';

/**
 * Express application factory / configuration.
 * Assembles middleware, API routes, static hosting and error handling.
 */

const path = require('path');
const express = require('express');

const rateLimiter = require('./middleware/rateLimiter');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const apiRoutes = require('./routes');

const app = express();

// Warm the settings cache at boot.
//
// The bank's telephone numbers and address live in settings, and the places
// that print them inside a template literal read a cached snapshot rather than
// awaiting. That snapshot is empty until something has read settings once, so
// without this the first alert email after a cold start could say "contact us"
// on a deployment that has a perfectly good number configured. Fire and
// forget: a failure here is the same as not having read yet.
require('./bank/settings').get().catch(() => {});

// Trust proxy so client IPs are accurate behind a reverse proxy / load balancer.
app.set('trust proxy', 1);
app.disable('x-powered-by');

// The banking application. Mounted ahead of the site body parser and the site
// rate limiter: it needs a larger upload ceiling (a photographed check) and a
// far higher request budget (a dashboard screen is a dozen calls) than a
// marketing page does.
app.use('/api/bank', require('./routes/bank'));

// Body parsing (built-in, no extra deps).
// `verify` stashes the exact bytes so webhook signatures can be checked.
app.use(express.json({ limit: '1mb', verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: false, limit: '32kb' }));

// Lightweight security headers (dependency-free).
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Simple request logging.
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    console.log(`[rockfield] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${ms}ms)`);
  });
  next();
});

// API namespace (rate limited).
// Signed provider webhooks: verified by signature, not rate limited.
app.use('/api/inbound', require('./routes/inbound'));

app.use('/api', rateLimiter, apiRoutes);

// Static frontend.
const publicDir = path.join(__dirname, '..', 'public');
app.use(
  express.static(publicDir, {
    extensions: ['html'],
    setHeaders(res, filePath) {
      // Long cache for static media (hero slides, logos); versioned per deploy.
      if (/\.(webp|png|jpg|jpeg|svg|mp4|woff2?)$/i.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
      }
    },
  })
);

// Clean-URL page routes. Each maps to a pre-built static HTML page.
const sendPage = (file) => (req, res) => res.sendFile(path.join(publicDir, file));

// The public bank site.
app.get('/', sendPage('index.html'));
// Each page is built under the name its URL uses, so a static host serves it
// without a rewrite. Vercel's cleanUrls turns a rewrite whose destination ends
// in .html into a redirect, which is what took /personal, /business and
// /support off the deployment while they worked perfectly well locally.
app.get('/personal', sendPage('personal.html'));
app.get('/business', sendPage('business.html'));
// The names these pages had before the site became a bank. Kept so existing
// links and bookmarks still land.
app.get('/services', sendPage('personal.html'));
app.get('/projects', sendPage('business.html'));
app.get('/rates', sendPage('rates.html'));
app.get('/security-center', sendPage('security-center.html'));
app.get('/open-account', sendPage('open-account.html'));
app.get('/careers', sendPage('careers.html'));
app.get('/apply', sendPage('apply.html'));
app.get('/support', sendPage('support.html'));
app.get('/contact', sendPage('support.html'));
app.get('/legal', sendPage('legal.html'));

// Sign-in and the rest of the front door.
app.get('/signin', sendPage('signin.html'));
app.get('/login', sendPage('signin.html'));
app.get('/forgot', sendPage('forgot.html'));
app.get('/change-password', sendPage('change-password.html'));

// Online banking. The pages themselves are public HTML shells: the session
// check happens on the first API call each one makes, and an unauthenticated
// visitor is sent to /signin before anything is rendered.
[
  'dashboard', 'accounts', 'transactions', 'statements', 'transfers', 'recipients',
  'bills', 'deposit', 'cards', 'alerts', 'messages', 'security', 'activity', 'profile',
].forEach((name) => app.get(`/${name}`, sendPage(`${name}.html`)));

// The banking console, and the older desk for website enquiries and chat.
// Both decide access for themselves.
app.get('/console', sendPage('console.html'));
app.get('/admin', sendPage('admin.html'));
app.get('/desk', sendPage('admin.html'));

// Unknown non-API, non-asset GET routes get the styled 404 page.
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  // Anything that looks like a file (has an extension) was not found by
  // express.static above, so let it 404 rather than returning HTML.
  if (path.extname(req.path)) return next();
  res.status(404).sendFile(path.join(publicDir, '404.html'));
});

// 404 + centralized error handling.
app.use(notFound);
app.use(errorHandler);

module.exports = app;
