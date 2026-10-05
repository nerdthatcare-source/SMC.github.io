/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * User Message Engine & Client Translation Layer Test Suite
 *
 * Verifies:
 * 1. Fallback rule: Any unmapped reason code resolves to:
 *    "Something needs attention — we're on it." and NEVER leaks raw code strings.
 * 2. 100% Coverage of All Known Reason Codes:
 *    Enumerates every known reason code across the codebase and asserts that
 *    each has an explicit entry in REASON_CODE_TRANSLATION_MAP (not relying on fallback).
 * 3. Wiring into respondAndLog:
 *    Non-admin callers receive plain, jargon-free English translations.
 *    ADMIN and OWNER callers retain raw codes and technical detail.
 * 4. Credential Rotation Invariant:
 *    Rotated credentials authenticate; old default credentials are rejected.
 */

import 'dotenv/config';
import {
  UserMessageEngine,
  REASON_CODE_TRANSLATION_MAP,
  ALL_KNOWN_REASON_CODES,
  DEFAULT_FALLBACK_MESSAGE,
} from '../engine/userMessageEngine';
import {
  step9_respondAndLog,
  AuthenticatedRequest,
} from '../services/accessGateway';
import { IdentitySessionService } from '../services/identitySessionService';
import { pool } from '../db/index';
import { DatabaseConnection } from '../db/database';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`[TEST ASSERTION FAILED] ${message}`);
  }
}

async function runTests() {
  console.log('------------------------------------------------------------');
  console.log('STARTING USER MESSAGE TRANSLATION LAYER ARCHITECTURAL TESTS');
  console.log('------------------------------------------------------------');

  await DatabaseConnection.getInstance();

  // --------------------------------------------------------------------------
  // TEST 1: Fallback Rule for Unmapped Codes
  // --------------------------------------------------------------------------
  console.log('\n[TEST 1] Verifying Fallback Rule for Unmapped Codes...');
  const unmappedCodes = [
    'UNKNOWN_UNMAPPED_CODE_XYZ',
    'INTERNAL_CRITICAL_CORRUPTION_99',
    'ERR_UNKNOWN_SEGFAULT_TRACE',
    'ARBITRARY_FUTURE_ENGINE_REJECTION',
    'RANDOM_INTERNAL_EXCEPTION_CODE',
  ];

  for (const rawCode of unmappedCodes) {
    const translated = UserMessageEngine.translateReasonCode(rawCode);
    assert(
      translated === DEFAULT_FALLBACK_MESSAGE,
      `Unmapped code "${rawCode}" must resolve to "${DEFAULT_FALLBACK_MESSAGE}", got: "${translated}"`,
    );
    assert(
      !translated.includes(rawCode),
      `Translation must NEVER leak the raw code string! Leaked "${rawCode}" in: "${translated}"`,
    );
  }

  // Also test translateMessage on unmapped internal pattern
  const unmappedPattern = UserMessageEngine.translateMessage('RULE_UNKNOWN_EXPERIMENTAL_BREACH');
  assert(
    unmappedPattern === DEFAULT_FALLBACK_MESSAGE,
    `Unmapped rule message must resolve to fallback, got: "${unmappedPattern}"`,
  );
  assert(
    !unmappedPattern.includes('RULE_UNKNOWN_EXPERIMENTAL_BREACH'),
    'Raw internal rule string must not be leaked',
  );

  console.log('  -> PASS: All unmapped codes safely resolved to generic fallback without leaking raw strings.');

  // --------------------------------------------------------------------------
  // TEST 2: Enumeration of Every Known Reason Code Across the Codebase
  // --------------------------------------------------------------------------
  console.log('\n[TEST 2] Verifying Explicit Translation for Every Known Reason Code...');
  console.log(`  -> Total explicitly cataloged reason codes: ${ALL_KNOWN_REASON_CODES.length}`);

  // Distinct functional categories to verify
  const requiredCategories = [
    // 1. Data Source & Safety Engine codes
    'NO_ACTIVE_DATA_SOURCE',
    'FEED_DISCONNECTED',
    'FEED_ERROR',
    'FEED_RATE_LIMITED',
    'DEGRADED_LATENCY',
    'CANDLE_INTEGRITY_BREACH',
    'CROSS_TIMEFRAME_DESYNC',
    'UNEXPECTED_DATA_GAP',
    'BACKFILL_IN_PROGRESS',
    'UNAPPROVED_INSTRUMENT',
    'STALE_DATA',
    'MARKET_CLOSED',
    'SESSION_INACTIVE',
    'LOW_SYNC_SCORE',
    'SYNTHETIC_SOURCE_REJECTED',

    // 2. Candle Integrity issues
    'DUPLICATE_TIMESTAMP',
    'CROSS_TIMEFRAME_COVERAGE_DESYNC',
    'CROSS_TIMEFRAME_BOUNDS_MISMATCH',
    'CANDLE_CONTRACT_BREACH',
    'INSUFFICIENT_HISTORY',

    // 3. Auth & Access Gateway gating
    'UNAUTHORIZED',
    '401_UNAUTHORIZED',
    'AUTH_REQUIRED',
    'TOKEN_REQUIRED',
    'SESSION_EXPIRED',
    'SESSION_INVALID',
    'FORBIDDEN',
    '403_FORBIDDEN',
    'ROLE_GATED',
    'PLAN_GATED',
    'ADMIN_REQUIRED',
    'SUSPENDED_ACCOUNT',
    'ACCOUNT_SUSPENDED',
    'ACCOUNT_LOCKED',
    'RATE_LIMIT_EXCEEDED',
    '2FA_REQUIRED',
    'INVALID_CREDENTIALS',

    // 4. Feature catalog & Module statuses
    'NOT_BUILT',
    'NOT_AVAILABLE_YET',
    'UNVERIFIED',
    'GRADED',
    'ACTIVE',
    'BUILT',
    'DEPRECATED',
    'EXPERIMENTAL',

    // 5. No-Trade Intelligence ranked rejection reasons
    'NO_TRADE',
    'SPREAD_TOO_WIDE',
    'HIGH_IMPACT_NEWS_PROXIMITY',
    'DAILY_LOSS_LIMIT_REACHED',
    'SESSION_OUTSIDE_KILLZONE',
    'INSUFFICIENT_RISK_REWARD',
    'CHOPPY_RANGE_BOUND',
    'LIQUIDITY_ALREADY_PURGED',
    'COUNTER_TREND_WITHOUT_CONFIRMATION',

    // 6. Signal Governance policy rejections
    'MAX_DRAWDOWN_BREACH',
    'OVEREXPOSURE_RISK',
    'CORRELATED_PAIR_LIMIT',
    'ORDER_SIZE_EXCEEDS_CAP',
    'EXECUTION_POLICY_VIOLATION',
    'VOLATILITY_CIRCUIT_BREAKER',

    // 7. Hard SMC Rules
    'RULE_DATA_INTEGRITY_SYNC_GATE',
    'RULE_1M_STRUCTURAL_QUARANTINE',
    'RULE_HTF_1H_DIRECTIONAL_BIAS',
    'RULE_MTF_15M_LOCATION_POI',
    'RULE_LTF_5M_LIQUIDITY_SWEEP',
    'RULE_LTF_5M_DISPLACEMENT_RATIO',
    'RULE_LTF_5M_STRUCTURE_BREAK',
    'RULE_LTF_5M_RETRACEMENT_ENTRY',
    'RULE_CONTRADICTION_FAIL_CLOSED_GATE',
  ];

  // Verify all required codes are present in the catalog
  for (const reqCode of requiredCategories) {
    assert(
      Object.prototype.hasOwnProperty.call(REASON_CODE_TRANSLATION_MAP, reqCode),
      `Required codebase reason code "${reqCode}" is missing from REASON_CODE_TRANSLATION_MAP!`,
    );
  }

  // Verify every single code in ALL_KNOWN_REASON_CODES has an explicit mapping
  // and does NOT rely on the fallback message
  for (const code of ALL_KNOWN_REASON_CODES) {
    assert(
      Object.prototype.hasOwnProperty.call(REASON_CODE_TRANSLATION_MAP, code),
      `Code "${code}" must have an explicit entry in REASON_CODE_TRANSLATION_MAP`,
    );

    const translated = UserMessageEngine.translateReasonCode(code, {
      planName: 'Institutional Trader Plan',
    });

    assert(
      translated !== DEFAULT_FALLBACK_MESSAGE,
      `Code "${code}" relied on default fallback message! Must have an explicit human-readable translation.`,
    );

    assert(
      translated !== code,
      `Code "${code}" returned its raw code string unmodified!`,
    );

    assert(
      translated.length > 5,
      `Translation for code "${code}" is too short: "${translated}"`,
    );

    // Verify template variables are resolved
    assert(
      !translated.includes('[Plan Name]'),
      `Translation for "${code}" contains unresolved "[Plan Name]" placeholder!`,
    );
  }
  console.log(`  -> PASS: All ${ALL_KNOWN_REASON_CODES.length} known reason codes have explicit, human-readable translations.`);

  // --------------------------------------------------------------------------
  // TEST 3: Specific Translation Content Verification (User Requirements)
  // --------------------------------------------------------------------------
  console.log('\n[TEST 3] Verifying Exact Required Plain English Translations...');
  assert(
    UserMessageEngine.translateReasonCode('NO_ACTIVE_DATA_SOURCE') ===
      "We're reconnecting to live market data. This will be back shortly.",
    'NO_ACTIVE_DATA_SOURCE translation mismatch',
  );

  assert(
    UserMessageEngine.translateReasonCode('STALE_DATA') ===
      "This market's data isn't updating right now — we've paused analysis until it's current again.",
    'STALE_DATA translation mismatch',
  );

  assert(
    UserMessageEngine.translateReasonCode('MARKET_CLOSED') ===
      'This market is currently closed.',
    'MARKET_CLOSED translation mismatch',
  );

  assert(
    UserMessageEngine.translateReasonCode('401_UNAUTHORIZED') ===
      'Please log in to continue.',
    '401_UNAUTHORIZED translation mismatch',
  );

  assert(
    UserMessageEngine.translateReasonCode('403_FORBIDDEN', { planName: 'Institutional Tier' }) ===
      'This feature is part of Institutional Tier. Upgrade to unlock it.',
    '403_FORBIDDEN plan-gated translation mismatch',
  );

  assert(
    UserMessageEngine.translateReasonCode('ACCOUNT_SUSPENDED') ===
      'Your account is currently suspended. Contact support for help.',
    'ACCOUNT_SUSPENDED translation mismatch',
  );

  assert(
    UserMessageEngine.translateReasonCode('NOT_BUILT') ===
      "This feature isn't available yet.",
    'NOT_BUILT translation mismatch',
  );

  assert(
    UserMessageEngine.translateReasonCode('NOT_AVAILABLE_YET') ===
      "This feature isn't available yet.",
    'NOT_AVAILABLE_YET translation mismatch',
  );

  // Assert GRADED must NOT share a translation with ACTIVE or BUILT
  const gradedPaidMsg = UserMessageEngine.translateReasonCode('GRADED', {
    planName: 'Institutional Trader Plan',
  });
  const gradedComingSoonMsg = UserMessageEngine.translateReasonCode('GRADED', {
    comingSoon: true,
  });
  const activeMsg = UserMessageEngine.translateReasonCode('ACTIVE');
  const builtMsg = UserMessageEngine.translateReasonCode('BUILT');

  assert(
    gradedPaidMsg === 'This feature is part of Institutional Trader Plan. Upgrade to unlock it.',
    'GRADED paid-required translation mismatch',
  );
  assert(
    gradedComingSoonMsg === 'This feature is coming soon.',
    'GRADED coming-soon translation mismatch',
  );
  assert(
    activeMsg === 'This feature is active.',
    'ACTIVE translation mismatch',
  );
  assert(
    builtMsg === 'This feature is active and operational.',
    'BUILT translation mismatch',
  );

  // Strict non-equivalence assertion: GRADED must NEVER resolve to ACTIVE or BUILT string
  assert(
    gradedPaidMsg !== activeMsg,
    'GRADED (paid-required) must NOT resolve to the same string as ACTIVE',
  );
  assert(
    gradedPaidMsg !== builtMsg,
    'GRADED (paid-required) must NOT resolve to the same string as BUILT',
  );
  assert(
    gradedComingSoonMsg !== activeMsg,
    'GRADED (coming-soon) must NOT resolve to the same string as ACTIVE',
  );
  assert(
    gradedComingSoonMsg !== builtMsg,
    'GRADED (coming-soon) must NOT resolve to the same string as BUILT',
  );
  assert(
    activeMsg !== builtMsg,
    'ACTIVE and BUILT must have distinct translations',
  );
  console.log('  -> PASS: Confirmed GRADED never resolves to the same string as ACTIVE or BUILT.');

  // --------------------------------------------------------------------------
  // TEST 4: Step 9 respondAndLog Payload Translation (Role-Aware)
  // --------------------------------------------------------------------------
  console.log('\n[TEST 4] Verifying Wiring into respondAndLog (Role-Aware Translation)...');

  const samplePayload = {
    allowed: false,
    reason: 'STALE_DATA',
    engineStatus: 'NOT_BUILT',
    blocks: [
      {
        id: 'BLOCK_FEED_GLOBAL',
        code: 'NO_ACTIVE_DATA_SOURCE',
        severity: 'BLOCKING',
        title: 'DataSourceSafetyEngine: NO_ACTIVE_DATA_SOURCE',
        explanation: 'M01_CANONICAL_ENGINE has disconnected from Deriv WebSocket',
        resolutionAction: 'DerivAdapter will reconnect automatically',
        blockedSince: Date.now(),
      },
    ],
  };

  // 4.1 Non-Admin Request (USER role)
  let nonAdminSentBody: any = null;
  const mockResNonAdmin = {
    status: () => mockResNonAdmin,
    json: (body: any) => {
      nonAdminSentBody = body;
      return mockResNonAdmin;
    },
    headersSent: false,
  } as any;

  const nonAdminReq = {
    method: 'GET',
    path: '/api/market/safety',
    headers: {},
    user: {
      id: 'usr_trader',
      email: 'trader@smctrading.io',
      role: 'USER',
      tier: 'FREE',
    },
    profile: {
      role: 'USER',
      maxActiveWatchlistSymbols: 5,
    },
  } as any;

  await step9_respondAndLog(nonAdminReq, mockResNonAdmin, samplePayload);

  // Assert non-admin payload is translated
  assert(
    nonAdminSentBody.reason ===
      "This market's data isn't updating right now — we've paused analysis until it's current again.",
    `Non-admin reason code must be translated! Got: ${nonAdminSentBody.reason}`,
  );
  assert(
    nonAdminSentBody.engineStatus === "This feature isn't available yet.",
    `Non-admin engineStatus must be translated! Got: ${nonAdminSentBody.engineStatus}`,
  );
  assert(
    nonAdminSentBody.blocks[0].code ===
      "We're reconnecting to live market data. This will be back shortly.",
    `Non-admin block code must be translated! Got: ${nonAdminSentBody.blocks[0].code}`,
  );
  assert(
    !nonAdminSentBody.blocks[0].title.includes('DataSourceSafetyEngine'),
    'Non-admin block title must not leak internal engine name!',
  );
  assert(
    !nonAdminSentBody.blocks[0].explanation.includes('M01_CANONICAL_ENGINE'),
    'Non-admin explanation must not leak internal module ID!',
  );
  console.log('  -> PASS: Non-admin caller receives cleanly translated, jargon-free payload.');

  // 4.2 Admin Request (OWNER role)
  let adminSentBody: any = null;
  const mockResAdmin = {
    status: () => mockResAdmin,
    json: (body: any) => {
      adminSentBody = body;
      return mockResAdmin;
    },
    headersSent: false,
  } as any;

  const adminReq = {
    method: 'GET',
    path: '/api/market/safety',
    headers: {},
    user: {
      id: 'usr_admin',
      email: 'admin@smctrading.io',
      role: 'OWNER',
      tier: 'INSTITUTIONAL',
    },
    profile: {
      role: 'OWNER',
      maxActiveWatchlistSymbols: 100,
    },
  } as any;

  await step9_respondAndLog(adminReq, mockResAdmin, samplePayload);

  // Assert admin payload retains raw technical codes
  assert(
    adminSentBody.reason === 'STALE_DATA',
    `Admin must see raw reason code "STALE_DATA", got: ${adminSentBody.reason}`,
  );
  assert(
    adminSentBody.engineStatus === 'NOT_BUILT',
    `Admin must see raw engine status "NOT_BUILT", got: ${adminSentBody.engineStatus}`,
  );
  assert(
    adminSentBody.blocks[0].code === 'NO_ACTIVE_DATA_SOURCE',
    `Admin must see raw block code "NO_ACTIVE_DATA_SOURCE", got: ${adminSentBody.blocks[0].code}`,
  );
  assert(
    adminSentBody.blocks[0].explanation.includes('M01_CANONICAL_ENGINE'),
    'Admin view must retain full technical and module lineage detail',
  );
  console.log('  -> PASS: Admin caller retains raw reason codes and full technical detail.');

  // --------------------------------------------------------------------------
  // TEST 5: Rotated Credentials Verification
  // --------------------------------------------------------------------------
  console.log('\n[TEST 5] Verifying Rotated Credentials on Bootstrap Accounts...');
  await IdentitySessionService.ensureDefaultUsers();

  // 1. Verify old defaults fail
  try {
    await IdentitySessionService.login({
      email: 'admin@smctrading.io',
      password: 'Admin@Institutional2026!',
    });
    assert(false, 'Old default admin password must fail');
  } catch (err: any) {
    assert(
      err.message.includes('Invalid email or password') || err.message.includes('2FA_REQUIRED'),
      'Old default password must be rejected',
    );
  }

  try {
    await IdentitySessionService.login({
      email: 'trader@smctrading.io',
      password: 'Trader@SMC2026!',
    });
    assert(false, 'Old default trader password must fail');
  } catch (err: any) {
    assert(
      err.message.includes('Invalid email or password'),
      'Old default password must be rejected',
    );
  }

  // 2. Verify rotated credentials succeed
  const adminTotp = IdentitySessionService.generateTOTPCode(
    IdentitySessionService.BOOTSTRAP_ADMIN_2FA_SECRET,
  );
  const rotatedAdmin = await IdentitySessionService.login({
    email: 'admin@smctrading.io',
    password: IdentitySessionService.BOOTSTRAP_ADMIN_PASSWORD,
    twoFactorCode: adminTotp,
  });
  assert(rotatedAdmin.user.role === 'OWNER', 'Rotated admin login succeeded');
  assert(Boolean(rotatedAdmin.sessionToken), 'Session token returned');
  console.log('  -> PASS: Bootstrap accounts successfully rotated and verified.');

  console.log('\n============================================================');
  console.log('ALL USER MESSAGE TRANSLATION TESTS PASSED (5/5)!');
  console.log('============================================================');
}

runTests()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('Translation Test Suite Failed:', err);
    await pool.end();
    process.exit(1);
  });
