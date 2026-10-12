'use strict';

const router = require('express').Router();
const ctrl = require('../controllers/teamController');

router.get('/', ctrl.list);

module.exports = router;
