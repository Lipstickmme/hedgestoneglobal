'use strict';

const team = require('../data/team.json');

exports.list = (req, res) => {
  res.json({ count: team.length, team });
};
