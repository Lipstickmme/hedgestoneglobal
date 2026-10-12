'use strict';

/**
 * Vercel resolves `api/[...path].js` for a single segment under /api, but not
 * for deeper paths, which reach the edge router and 404 before Express sees
 * them. Each nested entry point below re-exports the same app so the routes
 * that live two segments deep are addressable. The app routes on the original
 * URL, so which file answers makes no difference once it is running.
 */

module.exports = require('../../src/api-app');
