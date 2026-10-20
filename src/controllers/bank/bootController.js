'use strict';

/**
 * GET /api/bank/boot?page=dashboard - everything a signed-in page needs to
 * open, in one request: who is signed in, and that page's data.
 *
 * A page used to ask who was signed in, wait, then ask for its data, and the
 * dashboard then waited again for the chart's prices: three round trips to a
 * serverless function, each with its own database lookups, before anything
 * showed. The page now starts this one request from the first lines of its
 * HTML, while its scripts are still downloading, and the scripts read their
 * data from it (public/js/bank/core.js, api.get) instead of asking again.
 *
 * A part that fails is left out, and the page asks for it on its own, which
 * shows the error where it belongs.
 */

const { asyncHandler } = require('../../bank/http');
const { sessionPayload } = require('./authController');
const { overviewData } = require('./accountsController');
const { portfolioData } = require('./investController');
const vault = require('../../bank/vault');

// Keyed by the API path each page script asks for, so api.get finds it.
const PAGES = {
  dashboard: (user) => ({ '/overview': overviewData(user), '/invest': portfolioData(user, { history: true }) }),
  vault: (user) => ({ '/invest': portfolioData(user) }),
  receive: (user) => ({ '/vault': vault.detailsFor(user) }),
  send: (user) => ({ '/vault': vault.detailsFor(user), '/invest': portfolioData(user) }),
};

const boot = asyncHandler(async (req, res) => {
  const user = req.bankUser;
  const page = PAGES[String(req.query.page || '')];
  // Customers only, and not while a new password is owed: those pages go elsewhere first.
  const loaders = user && user.role !== 'admin' && !user.must_change_password && page ? page(user) : {};
  const keys = Object.keys(loaders);
  const [session, ...parts] = await Promise.all([
    sessionPayload(req, res),
    ...keys.map((k) => loaders[k].catch((err) => {
      console.warn(`[hedgestone] boot ${k} failed: ${err.message}`);
      return undefined;
    })),
  ]);
  const data = {};
  keys.forEach((k, i) => { if (parts[i] !== undefined) data[k] = parts[i]; });
  res.set('Cache-Control', 'no-store');
  res.json({ session, data });
});

module.exports = { boot, PAGES };
