'use strict';

const router = require('express').Router();
const ctrl = require('../controllers/applicationsController');

router.post('/', ctrl.create);

module.exports = router;
