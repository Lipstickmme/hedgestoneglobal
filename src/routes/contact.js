'use strict';

const router = require('express').Router();
const ctrl = require('../controllers/contactController');

router.post('/', ctrl.create);

module.exports = router;
