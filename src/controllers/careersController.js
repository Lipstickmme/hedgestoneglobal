'use strict';

const careers = require('../data/careers.json');

exports.list = (req, res) => {
  const { team } = req.query;
  let roles = careers;
  if (team) roles = careers.filter((r) => r.team.toLowerCase() === String(team).toLowerCase());
  res.json({ count: roles.length, roles });
};
