'use strict';

const router = require('express').Router();
const ctrl = require('../controllers/careersController');

router.get('/', ctrl.list);

module.exports = router;
