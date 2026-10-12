'use strict';

// See api/inbound/resend.js for why this file exists. The bank's routes go
// four segments deep - /api/bank/accounts/:id/statements/:period, and
// /api/bank/admin/transfers/:id/approve - so there is one of these per depth.
// test/api.test.js checks that every registered route still has one.

module.exports = require('../../../src/api-app');
