'use strict';

const path = require('path');

/**
 * Where local development writes enquiries and chat transcripts.
 * Vercel's filesystem is read-only apart from /tmp, and nothing there survives
 * between invocations, so production must use Supabase.
 */
function dataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  if (process.env.VERCEL) return '/tmp/rockfield-data';
  return path.join(__dirname, '..', '..', 'data');
}

module.exports = { dataDir };
