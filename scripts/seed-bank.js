'use strict';

/**
 * Create the first administrator, a demonstration customer and six months of
 * plausible activity.
 *
 * Idempotent: it does nothing if the bank already has users, unless --force is
 * passed, which is meant for a scratch database and will happily create a
 * second set of everything on top of a real one.
 *
 *   npm run seed
 *   BANK_ADMIN_EMAIL=me@example.com BANK_ADMIN_PASSWORD='...' npm run seed
 */

const seed = require('../src/bank/seed');

(async () => {
  const force = process.argv.includes('--force');
  const result = await seed.ensureSeed({ force });

  if (!result.seeded) {
    console.log(`[rockfield] nothing to do: ${result.users} user(s) already exist. Pass --force to seed anyway.`);
    return;
  }

  console.log('');
  console.log('  Rockfield National Bank is ready.');
  console.log('');
  console.log(`  Administrator   ${result.admin.email}`);
  console.log(`                  ${result.admin.password}`);
  console.log(`  Customer        ${result.customer.email}`);
  console.log(`                  ${result.customer.password}`);
  console.log(`  Second customer ${result.secondary.email}`);
  console.log(`                  ${result.secondary.password}`);
  console.log('');
  console.log(`  Accounts        ${result.accounts.join(', ')}`);
  console.log(`  Cards ending    ${result.cards.join(', ')}`);
  console.log('');
  console.log('  Sign in at /signin, or the staff console at /console.');
  console.log('');
})().catch((err) => {
  console.error('[rockfield] seeding failed:', err);
  process.exit(1);
});
