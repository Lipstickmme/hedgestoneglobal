'use strict';

/**
 * Old addresses, and where each now goes.
 *
 * The first five are the signed-in pages retired when the platform became
 * Bitcoin only (src/bank/site/pages-app.js); the rest are the public pages'
 * older names. src/app.js redirects them, and vercel.json carries the same
 * list for the deployment - test/api.test.js keeps the two in step.
 */
module.exports = {
  ...require('../bank/site/pages-app').RETIRED,
  '/personal': '/bitcoin',
  '/business': '/bitcoin',
  '/services': '/bitcoin',
  '/projects': '/bitcoin',
};
