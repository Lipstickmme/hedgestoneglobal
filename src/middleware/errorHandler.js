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
  if (status >= 500) {
    console.error('[rockfield] error:', err);
  }
  const payload = {
    error: err.code || (status >= 500 ? 'internal_error' : 'request_error'),
    message: status >= 500 ? 'Something went wrong on our end.' : err.message,
  };
  res.status(status).json(payload);
}

module.exports = { notFound, errorHandler };
