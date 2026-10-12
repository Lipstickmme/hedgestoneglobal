'use strict';

const router = require('express').Router();
const ctrl = require('../controllers/servicesController');

router.get('/', ctrl.list);
router.get('/:id', ctrl.getById);

module.exports = router;
