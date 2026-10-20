'use strict';

// See api/inbound/resend.js for why this file exists. The bank's routes go
// five segments deep - /api/bank/admin/vault/requests/:id/confirm - so there
// is one of these per depth. test/api.test.js checks that every registered
// route still has one.

module.exports = require('../../../../../../src/api-app');
