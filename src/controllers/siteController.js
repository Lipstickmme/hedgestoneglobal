'use strict';

const siteSettings = require('../utils/siteSettings');

/**
 * GET /api/site
 *
 * The contact details every page hydrates itself from. Public, and public by
 * design: these are the details printed on the pages anyway.
 */
exports.get = async (req, res, next) => {
  try {
    const settings = await siteSettings.read();
    // Short cache: an edit at the desk should reach the site quickly, but this
    // is on every page load.
    res.setHeader('Cache-Control', 'public, max-age=30');
    return res.json(settings);
  } catch (err) {
    return next(err);
  }
};
