'use strict';

const router = require('express').Router();
const ctrl = require('../controllers/emailController');

router.post('/reply', ctrl.reply);

module.exports = router;
