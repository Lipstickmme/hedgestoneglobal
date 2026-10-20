'use strict';

/**
 * Old addresses, and where each now goes.
 *
 * First the signed-in pages retired as the platform became a Bitcoin vault
 * (src/bank/site/pages-app.js), then the public pages' older names. src/app.js redirects them, and vercel.json carries the same
 * list for the deployment - test/api.test.js keeps the two in step.
 */
module.exports = {
  ...require('../bank/site/pages-app').RETIRED,
  '/personal': '/bitcoin',
  '/business': '/bitcoin',
  '/services': '/bitcoin',
  '/projects': '/bitcoin',
  '/digital': '/',
};
