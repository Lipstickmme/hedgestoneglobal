'use strict';

const router = require('express').Router();
const ctrl = require('../controllers/chatController');

router.post('/message', ctrl.postMessage);
router.post('/notify', ctrl.notifyMessage);
router.get('/:sessionId', ctrl.getHistory);

module.exports = router;
