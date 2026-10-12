'use strict';

const router = require('express').Router();
const ctrl = require('../controllers/leadershipController');

router.get('/', ctrl.list);

module.exports = router;
