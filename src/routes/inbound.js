'use strict';

const router = require('express').Router();
const ctrl = require('../controllers/inboundController');

router.post('/resend', ctrl.resend);

module.exports = router;
