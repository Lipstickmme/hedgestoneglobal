'use strict';

const services = require('../data/services.json');

exports.list = (req, res) => {
  res.json({ count: services.length, services });
};

exports.getById = (req, res, next) => {
  const svc = services.find((s) => s.id === req.params.id);
  if (!svc) {
    const err = new Error(`No service with id "${req.params.id}"`);
    err.status = 404;
    err.code = 'not_found';
    return next(err);
  }
  res.json(svc);
};
