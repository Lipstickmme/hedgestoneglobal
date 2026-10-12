'use strict';

/**
 * Vercel serverless entry point.
 * The catch-all filename routes every /api/* request here with the original
 * path intact, which the Express app below mounts under /api.
 */

module.exports = require('../src/api-app');
