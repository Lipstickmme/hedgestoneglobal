'use strict';

const router = require('express').Router();
const ctrl = require('../controllers/projectsController');

router.get('/', ctrl.list);
router.get('/:id', ctrl.getById);

module.exports = router;
