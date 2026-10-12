'use strict';

/**
 * Centralized error handling: a 404 producer and a final error handler
 * that returns JSON for API routes and stays quiet about internals.
 */

function notFound(req, res, next) {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'not_found', message: `No API route for ${req.method} ${req.path}` });
  }
  return next();
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;
  // `expose` marks a 5xx whose message was written for the customer - "no live
  // price right now" - rather than a crash whose message must stay private.
  if (status >= 500 && !err.expose) {
    console.error('[hedgestone] error:', err);
  }
  const payload = {
    error: err.code || (status >= 500 ? 'internal_error' : 'request_error'),
    message: status >= 500 && !err.expose ? 'Something went wrong on our end.' : err.message,
  };
  if (err.details) payload.details = err.details;
  res.status(status).json(payload);
}

module.exports = { notFound, errorHandler };
