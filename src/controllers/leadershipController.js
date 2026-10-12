'use strict';

const leadership = require('../data/leadership.json');

exports.list = (req, res) => {
  res.json({ count: leadership.length, leadership });
};
