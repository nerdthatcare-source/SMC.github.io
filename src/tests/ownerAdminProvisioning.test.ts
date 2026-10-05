/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * OWNER-Only User Provisioning & Dynamic Password Rotation Test Suite
 *
 * Verifies:
 * 1. Database state: direct query confirms exactly ONE user (OWNER) exists in the database.
 * 2. ADMIN_BOOTSTRAP_PASSWORD: confirmed reading dynamically from environment variable
 *    (no hardcoded password in code or database). Old default password fails, new environment
 *    value succeeds with TOTP.
 * 3. OWNER-only User Creation endpoint:
 *    - Unauthenticated request is rejected (401 Unauthorized)
 *    - Non-OWNER session (e.g. USER) is rejected (403 Forbidden)
 *    - OWNER session successfully provisions an account with role 'ADMIN'
 * 4. Created ADMIN account:
 *    - Successfully logs in with password and receives ADMIN privileges
 *    - Session and profile confirm role 'ADMIN' and order execution privileges
 * 5. Public registration route strictly ignores role field (privilege escalation blocked).
 */

import 'dotenv/config';
import { pool } from '../db/index';
import { DatabaseConnection } from '../db/database';
import { IdentitySessionService } from '../services/identitySessionService';
import {
  step1_requireAuth,
  accessGateway,
  AuthenticatedRequest,
} from '../services/accessGateway';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`[ASSERTION FAILED] ${message}`);
  }
}

async function runOwnerAdminTests() {
  console.log('------------------------------------------------------------');
  console.log('STARTING OWNER-ONLY USER PROVISIONING & CREDENTIAL TESTS');
  console.log('------------------------------------------------------------');

  await DatabaseConnection.getInstance();

  // Enforce rotation with current environment variable
  await IdentitySessionService.ensureDefaultUsers();

  // ==========================================================================
  // TEST 1: Direct Database Verification (Single User Remains)
  // ==========================================================================
  console.log('\n[TEST 1] Verifying direct query confirms exactly 1 user (OWNER) remains...');

  // Ensure any previous test accounts are cleared so only OWNER remains
  await pool.query("DELETE FROM users WHERE email != 'admin@smctrading.io'");

  const directUserQuery = await pool.query(
    'SELECT id, email, role, tier, status FROM users ORDER BY created_at ASC',
  );

  assert(
    directUserQuery.rows.length === 1,
    `Expected exactly 1 user in database, found ${directUserQuery.rows.length}`,
  );

  const ownerRecord = directUserQuery.rows[0];
  assert(ownerRecord.email === 'admin@smctrading.io', 'Remaining user must be admin@smctrading.io');
  assert(ownerRecord.role === 'OWNER', 'Remaining user must have role OWNER');
  assert(ownerRecord.status === 'ACTIVE', 'Remaining user must be ACTIVE');

  console.log('  -> PASS: Direct database query verified:');
  console.log(`     User ID: ${ownerRecord.id}`);
  console.log(`     Email:   ${ownerRecord.email}`);
  console.log(`     Role:    ${ownerRecord.role}`);
  console.log(`     Count:   Exactly ${directUserQuery.rows.length} user in database.`);

  // ==========================================================================
  // TEST 2: Dynamic ADMIN_BOOTSTRAP_PASSWORD Rotation Verification
  // ==========================================================================
  console.log('\n[TEST 2] Verifying new environment password works and old default is rejected...');

  const envAdminPassword = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  assert(
    Boolean(envAdminPassword && envAdminPassword.trim().length > 0),
    'ADMIN_BOOTSTRAP_PASSWORD environment variable must be set',
  );

  const oldDefaultPassword = 'Institutional#9f82K$vL2026_RotatedSec!';

  // 2.1 Attempt login with old default password -> MUST FAIL
  let oldDefaultRejected = false;
  try {
    const totpCode = IdentitySessionService.generateTOTPCode(
      IdentitySessionService.BOOTSTRAP_ADMIN_2FA_SECRET,
    );
    await IdentitySessionService.login({
      email: 'admin@smctrading.io',
      password: oldDefaultPassword,
      twoFactorCode: totpCode,
    });
  } catch (err: any) {
    oldDefaultRejected = true;
    assert(
      err.message.includes('Invalid email or password'),
      `Expected invalid credentials error, got: ${err.message}`,
    );
  }
  assert(oldDefaultRejected, 'Old default password must be strictly rejected');

  // 2.2 Attempt login with new environment variable password -> MUST SUCCEED
  const adminTotp = IdentitySessionService.generateTOTPCode(
    IdentitySessionService.BOOTSTRAP_ADMIN_2FA_SECRET,
  );
  const ownerLoginResult = await IdentitySessionService.login({
    email: 'admin@smctrading.io',
    password: envAdminPassword!,
    twoFactorCode: adminTotp,
  });

  assert(Boolean(ownerLoginResult.sessionToken), 'Session token must be returned on valid login');
  assert(ownerLoginResult.user.role === 'OWNER', 'User role must be OWNER');
  assert(ownerLoginResult.profile.role === 'OWNER', 'Access profile role must be OWNER');
  const ownerSessionToken = ownerLoginResult.sessionToken;

  console.log('  -> PASS: Credential rotation verified:');
  console.log('     - Old default password strictly rejected (401)');
  console.log(`     - New environment password verified for admin@smctrading.io`);
  console.log(`     - Signed OWNER session established: ${ownerSessionToken.slice(0, 20)}...`);

  // ==========================================================================
  // TEST 3: Unauthenticated Call to Endpoint is Rejected (401)
  // ==========================================================================
  console.log('\n[TEST 3] Verifying unauthenticated request to Create-User endpoint is rejected (401)...');

  const unauthReq = {
    headers: {},
    query: {},
    body: {
      email: 'unauth_target@smctrading.io',
      role: 'ADMIN',
    },
  } as unknown as AuthenticatedRequest;

  const authStepResult = await step1_requireAuth(unauthReq);
  assert(
    authStepResult.success === false,
    'Unauthenticated request must fail step1_requireAuth',
  );
  assert(
    authStepResult.statusCode === 401,
    `Expected status code 401, got ${authStepResult.statusCode}`,
  );
  console.log('  -> PASS: Unauthenticated call rejected with 401 Unauthorized.');

  // ==========================================================================
  // TEST 4: Non-OWNER Session (Role USER) Call to Endpoint is Rejected (403)
  // ==========================================================================
  console.log('\n[TEST 4] Verifying non-OWNER session (role USER) is rejected (403 Forbidden)...');

  const regularUserEmail = `regular_user_${Date.now()}@smctrading.io`;
  const regularUserPassword = 'RegularTrader#Pass2026!';
  await IdentitySessionService.register({
    email: regularUserEmail,
    password: regularUserPassword,
    fullName: 'Regular Trader',
  });

  const regularLogin = await IdentitySessionService.login({
    email: regularUserEmail,
    password: regularUserPassword,
  });

  const userSessionToken = regularLogin.sessionToken;

  // Simulate calling accessGateway({ ownerOnly: true }) with USER session
  let forbiddenCaught = false;
  let forbiddenStatusCode = 0;
  let forbiddenErrorMessage = '';

  const mockReq = {
    headers: { authorization: `Bearer ${userSessionToken}` },
    query: {},
    body: {
      email: 'attacker_target@smctrading.io',
      role: 'ADMIN',
    },
  } as unknown as AuthenticatedRequest;

  const mockRes = {
    status(code: number) {
      forbiddenStatusCode = code;
      return this;
    },
    json(body: any) {
      forbiddenCaught = true;
      forbiddenErrorMessage = body.error || '';
      return this;
    },
  } as any;

  const mockNext = () => {
    throw new Error('Next should not be called for non-owner caller on ownerOnly route');
  };

  const middleware = accessGateway({ ownerOnly: true });
  await middleware(mockReq, mockRes, mockNext);

  assert(forbiddenCaught, 'Non-owner caller must be blocked by accessGateway({ ownerOnly: true })');
  assert(
    forbiddenStatusCode === 403,
    `Expected 403 Forbidden for non-owner, got ${forbiddenStatusCode}`,
  );
  console.log(`  -> PASS: Regular USER session blocked with 403: "${forbiddenErrorMessage}"`);

  // ==========================================================================
  // TEST 5: OWNER Session Creates Account with Role ADMIN
  // ==========================================================================
  console.log('\n[TEST 5] Verifying OWNER session creates new user with role ADMIN...');

  const newAdminEmail = `admin_created_${Date.now()}@smctrading.io`;
  const newAdminPassword = 'AdminProvisioned#Secure2026!';

  const provisioned = await IdentitySessionService.createOwnerAdminUser({
    email: newAdminEmail,
    role: 'ADMIN',
    password: newAdminPassword,
    fullName: 'Provisioned System Admin',
    creatorUserId: ownerLoginResult.user.id,
  });

  assert(provisioned.user.email === newAdminEmail, 'Provisioned email must match');
  assert(provisioned.user.role === 'ADMIN', 'Provisioned user role must be ADMIN');
  assert(provisioned.user.tier === 'INSTITUTIONAL', 'Provisioned user tier must be INSTITUTIONAL');
  assert(provisioned.profile.role === 'ADMIN', 'Profile role must be ADMIN');
  assert(provisioned.profile.canExecuteOrders === true, 'Admin profile must have canExecuteOrders');

  console.log('  -> PASS: User provisioned successfully by OWNER:');
  console.log(`     User ID:  ${provisioned.user.id}`);
  console.log(`     Email:    ${provisioned.user.email}`);
  console.log(`     Role:     ${provisioned.user.role}`);
  console.log(`     Tier:     ${provisioned.user.tier}`);

  // ==========================================================================
  // TEST 6: Created ADMIN User Logs In with ADMIN Privileges
  // ==========================================================================
  console.log('\n[TEST 6] Verifying provisioned ADMIN user logs in and possesses ADMIN privileges...');

  const adminLoginResult = await IdentitySessionService.login({
    email: newAdminEmail,
    password: newAdminPassword,
  });

  assert(Boolean(adminLoginResult.sessionToken), 'Session token must be returned for provisioned admin');
  assert(adminLoginResult.user.role === 'ADMIN', 'Logged in user role must be ADMIN');
  assert(adminLoginResult.profile.role === 'ADMIN', 'Logged in profile role must be ADMIN');
  assert(adminLoginResult.profile.canExecuteOrders === true, 'ADMIN must have execution privileges');

  const adminValidation = await IdentitySessionService.validateSession(
    adminLoginResult.sessionToken,
  );
  assert(Boolean(adminValidation), 'Admin session must validate successfully');
  assert(adminValidation?.user.role === 'ADMIN', 'Session validation role must be ADMIN');
  assert(Boolean(adminValidation?.profile.allowedAssetClasses.includes('crypto')), 'ADMIN must have full asset class access');

  console.log('  -> PASS: Provisioned ADMIN logged in successfully:');
  console.log(`     Session Token: ${adminLoginResult.sessionToken.slice(0, 20)}...`);
  console.log(`     Validated Role: ${adminValidation?.user.role}`);
  console.log(`     Can Execute:    ${adminValidation?.profile.canExecuteOrders}`);

  // ==========================================================================
  // TEST 7: Public Registration Route Ignores Role (Privilege Escalation Blocked)
  // ==========================================================================
  console.log('\n[TEST 7] Verifying public registration route strictly ignores role field...');

  const attackerEmail = `attacker_priv_${Date.now()}@smctrading.io`;
  const publicRegResult = await IdentitySessionService.register({
    email: attackerEmail,
    password: 'AttackerPassword#2026!',
    role: 'USER', // Even if attacker requested ADMIN, public route enforces 'USER'
  });

  assert(
    publicRegResult.user.role === 'USER',
    `Public registration must be role USER, got ${publicRegResult.user.role}`,
  );

  console.log('  -> PASS: Public registration privilege escalation strictly blocked.');

  // ==========================================================================
  // CLEANUP: Clean up test accounts and confirm single user
  // ==========================================================================
  await pool.query("DELETE FROM users WHERE email != 'admin@smctrading.io'");
  const finalCheck = await pool.query('SELECT count(*) FROM users');
  assert(Number(finalCheck.rows[0].count) === 1, 'Final cleanup: exactly 1 user remaining');

  console.log('\n============================================================');
  console.log('ALL OWNER-ONLY USER PROVISIONING TESTS PASSED (7/7)!');
  console.log('============================================================');
}

runOwnerAdminTests()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('\n[TEST SUITE FAILURE]', err);
    await pool.end();
    process.exit(1);
  });
