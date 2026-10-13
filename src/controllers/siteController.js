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
    // Asked again on every page, so a change at the desk (a new telephone
    // number, the bank's name) shows on the next page anyone opens. The ETag
    // keeps that cheap: an unchanged answer comes back as an empty 304.
    res.setHeader('Cache-Control', 'no-cache');
    return res.json(settings);
  } catch (err) {
    return next(err);
  }
};
