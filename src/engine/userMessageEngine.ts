/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * User Message Engine & Client Translation Layer
 *
 * Central map translating internal reason codes, engine names, module IDs,
 * and hard-rule codes into plain, jargon-free English for non-admin users.
 *
 * Architectural Invariants:
 * 1. ADMIN and OWNER roles retain raw technical detail and reason codes.
 * 2. Non-admin roles (USER, SUPPORT, anonymous) receive human-readable messages.
 * 3. Fallback rule: Any unmapped code resolves to:
 *    "Something needs attention — we're on it." (never leaks raw strings).
 * 4. Step 9 respondAndLog integration: Outgoing payloads pass through this
 *    translation layer before dispatch to clients.
 */

export const DEFAULT_FALLBACK_MESSAGE = "Something needs attention — we're on it.";

/**
 * Master mapping from internal reason codes, rule names, and engine states to plain English.
 */
export const REASON_CODE_TRANSLATION_MAP: Record<string, string> = {
  // ==========================================================================
  // DATA SOURCE & SAFETY ENGINE CODES (dataSourceSafetyEngine.ts)
  // ==========================================================================
  NO_ACTIVE_DATA_SOURCE:
    "We're reconnecting to live market data. This will be back shortly.",
  FEED_DISCONNECTED:
    "We're reconnecting to live market data. This will be back shortly.",
  FEED_ERROR:
    "Market data feed encountered a temporary issue. We're reconnecting now.",
  FEED_RATE_LIMITED:
    "Market data throughput limit reached. Pausing momentarily to refresh.",
  DEGRADED_LATENCY:
    "Market connection is experiencing slight delays. Monitoring network quality.",
  CANDLE_INTEGRITY_BREACH:
    "Market data consistency check in progress. Pausing analysis until verified.",
  CROSS_TIMEFRAME_DESYNC:
    "Market timeframes are synchronizing. Stand by for real-time analysis.",
  UNEXPECTED_DATA_GAP:
    "Market data continuity check in progress. Backfilling missing bars.",
  BACKFILL_IN_PROGRESS:
    "Loading historical market data. Real-time analysis will resume momentarily.",
  UNAPPROVED_INSTRUMENT:
    "This instrument is not in the approved trading catalog.",
  STALE_DATA:
    "This market's data isn't updating right now — we've paused analysis until it's current again.",
  MARKET_CLOSED:
    "This market is currently closed.",
  SESSION_INACTIVE:
    "This market is currently closed.",
  LOW_SYNC_SCORE:
    "Market data synchronization is below the required threshold. Synchronizing now.",
  SYNTHETIC_SOURCE_REJECTED:
    "Non-institutional or synthetic data feeds are not permitted.",

  // ==========================================================================
  // CANDLE INTEGRITY ISSUES (candleIntegrityEngine.ts)
  // ==========================================================================
  DUPLICATE_TIMESTAMP:
    "Data verification in progress. Cleaning duplicate market records.",
  CROSS_TIMEFRAME_COVERAGE_DESYNC:
    "Timeframe coverage is synchronizing.",
  CROSS_TIMEFRAME_BOUNDS_MISMATCH:
    "Timeframe price bounds are synchronizing.",
  CANDLE_CONTRACT_BREACH:
    "Market bar data integrity check in progress.",
  INSUFFICIENT_HISTORY:
    "Gathering additional historical bars to complete technical analysis.",

  // ==========================================================================
  // AUTHENTICATION & ACCESS GATEWAY RESPONSES (401 / 403 / GATING)
  // ==========================================================================
  UNAUTHORIZED:
    "Please log in to continue.",
  '401_UNAUTHORIZED':
    "Please log in to continue.",
  AUTH_REQUIRED:
    "Please log in to continue.",
  TOKEN_REQUIRED:
    "Please log in to continue.",
  SESSION_EXPIRED:
    "Your session has expired. Please log in again to continue.",
  SESSION_INVALID:
    "Please log in to continue.",
  FORBIDDEN:
    "This feature is part of [Plan Name]. Upgrade to unlock it.",
  '403_FORBIDDEN':
    "This feature is part of [Plan Name]. Upgrade to unlock it.",
  ROLE_GATED:
    "This feature is part of [Plan Name]. Upgrade to unlock it.",
  PLAN_GATED:
    "This feature is part of [Plan Name]. Upgrade to unlock it.",
  ADMIN_REQUIRED:
    "This feature is part of [Plan Name]. Upgrade to unlock it.",
  SUSPENDED_ACCOUNT:
    "Your account is currently suspended. Contact support for help.",
  ACCOUNT_SUSPENDED:
    "Your account is currently suspended. Contact support for help.",
  ACCOUNT_LOCKED:
    "Too many failed login attempts. Please wait before trying again.",
  RATE_LIMIT_EXCEEDED:
    "Rate limit exceeded. Please wait a moment before trying again.",
  '2FA_REQUIRED':
    "Two-factor authentication code is required to proceed.",
  INVALID_CREDENTIALS:
    "Invalid email or password. Please verify your credentials.",
  EMAIL_NOT_VERIFIED:
    "Please verify your email address to continue.",
  PASSWORD_RESET_REQUIRED:
    "A password reset is required for this account.",

  // ==========================================================================
  // FEATURE CATALOG STATES & REGISTRY STATUSES
  // ==========================================================================
  NOT_BUILT:
    "This feature isn't available yet.",
  NOT_AVAILABLE_YET:
    "This feature isn't available yet.",
  UNVERIFIED:
    "This feature is currently undergoing verification.",
  GRADED:
    "This feature is part of [Plan Name]. Upgrade to unlock it.",
  GRADED_PAID_REQUIRED:
    "This feature is part of [Plan Name]. Upgrade to unlock it.",
  GRADED_COMING_SOON:
    "This feature is coming soon.",
  COMING_SOON:
    "This feature is coming soon.",
  ACTIVE:
    "This feature is active.",
  BUILT:
    "This feature is active and operational.",
  DEPRECATED:
    "This feature has been retired.",
  EXPERIMENTAL:
    "This feature is currently in preview.",

  // ==========================================================================
  // NO-TRADE INTELLIGENCE REJECTION REASONS
  // ==========================================================================
  NO_TRADE:
    "Market conditions do not currently meet entry criteria.",
  SPREAD_TOO_WIDE:
    "Market spread is currently wider than optimal execution parameters.",
  HIGH_IMPACT_NEWS_PROXIMITY:
    "High-impact economic news scheduled. Trading is paused to protect capital.",
  DAILY_LOSS_LIMIT_REACHED:
    "Daily risk threshold reached. Trading halted until the next session.",
  SESSION_OUTSIDE_KILLZONE:
    "Current time is outside the primary high-liquidity session window.",
  INSUFFICIENT_RISK_REWARD:
    "Setup does not offer an adequate risk-to-reward ratio.",
  CHOPPY_RANGE_BOUND:
    "Market is currently moving sideways without a clear institutional trend.",
  LIQUIDITY_ALREADY_PURGED:
    "Target liquidity pool has already been cleared.",
  COUNTER_TREND_WITHOUT_CONFIRMATION:
    "Setup opposes the higher-timeframe trend without structural confirmation.",

  // ==========================================================================
  // SIGNAL GOVERNANCE POLICY REJECTIONS
  // ==========================================================================
  MAX_DRAWDOWN_BREACH:
    "Risk governance limit reached to preserve capital.",
  OVEREXPOSURE_RISK:
    "Total open exposure limit reached for this asset class.",
  CORRELATED_PAIR_LIMIT:
    "Maximum correlated market positions reached.",
  ORDER_SIZE_EXCEEDS_CAP:
    "Order size exceeds institutional risk limits.",
  EXECUTION_POLICY_VIOLATION:
    "Execution blocked by institutional risk rules.",
  VOLATILITY_CIRCUIT_BREAKER:
    "High market volatility detected. Operations paused.",

  // ==========================================================================
  // HARD RULES (SMC KNOWLEDGE CORE & RULE ENGINES)
  // ==========================================================================
  RULE_DATA_INTEGRITY_SYNC_GATE:
    "Market data feed must be synchronized before execution.",
  RULE_1M_STRUCTURAL_QUARANTINE:
    "One-minute timeframe is quarantined from primary bias formation.",
  RULE_HTF_1H_DIRECTIONAL_BIAS:
    "Execution must align with the higher-timeframe hourly directional bias.",
  RULE_MTF_15M_LOCATION_POI:
    "Price must reach a qualified 15-minute point of interest.",
  RULE_LTF_5M_LIQUIDITY_SWEEP:
    "Confirmation requires a liquidity sweep on the execution timeframe.",
  RULE_LTF_5M_DISPLACEMENT_RATIO:
    "Confirmation requires strong institutional displacement volume.",
  RULE_LTF_5M_STRUCTURE_BREAK:
    "Confirmation requires a structural shift in market direction.",
  RULE_LTF_5M_RETRACEMENT_ENTRY:
    "Entry requires a measured retracement into the execution zone.",
  RULE_CONTRADICTION_FAIL_CLOSED_GATE:
    "Conflicting signals detected across timeframes. Safety lock active.",
  CONTRADICTION_REJECTED:
    "Conflicting signals detected across timeframes. Safety lock active.",
  DISPLACEMENT_INSUFFICIENT:
    "Institutional displacement volume is insufficient for confirmation.",
  SWEEP_UNCONFIRMED:
    "Liquidity sweep has not been confirmed.",
  POI_UNREACHED:
    "Market price has not reached the target point of interest.",
  BIAS_MISMATCH:
    "Trade direction opposes higher-timeframe institutional bias.",

  // ==========================================================================
  // SYSTEM MODULE IDENTIFIERS (systemArchitectureRegistry.ts)
  // ==========================================================================
  CANONICAL_DATA_INGESTION: "Market Data Pipeline",
  CANONICAL_CONTRACT_VALIDATOR: "Contract Validator",
  INSTRUMENT_MARKET_REGISTRY: "Market Catalog",
  DERIV_ADAPTER: "Market Feed Adapter",
  DERIV_CONNECTION_HEALTH_ENGINE: "Connection Health Guard",
  DERIV_BACKFILL_RECOVERY_ENGINE: "Backfill Recovery Engine",
  CANONICAL_MARKET_DATA_ENGINE: "Market Data Engine",
  CANONICAL_DATA_ENGINE: "Institutional Data Engine",
  MARKET_DATA_NORMALIZATION: "Market Normalization Engine",
  SYMBOL_MAPPING_ENGINE: "Symbol Mapping Engine",
  CANDLE_INTEGRITY_ENGINE: "Candle Integrity Engine",
  DATA_INTEGRITY_LINEAGE_ENGINE: "Data Lineage Guard",
  DATA_SOURCE_SAFETY_ENGINE: "Data Source Safety Guard",
  STRUCTURAL_TIMEFRAME_HIERARCHY: "Timeframe Hierarchy Engine",
  SESSION_TIMING_GOVERNOR: "Session Timing Governor",
  SWING_STRUCTURE_ENGINE: "Swing Structure Engine",
  CANONICAL_STRUCTURE_ENGINE: "Canonical Structure Engine",
  CANONICAL_PERIOD_LEVELS_ENGINE: "Key Period Levels Engine",
  MARKET_STRUCTURE_BREAK_DETECTOR: "Structure Break Detector",
  SMC_MARKET_STRUCTURE_ENGINE: "Institutional Market Structure Engine",
  SMC_STRONG_WEAK_STRUCTURE_ENGINE: "High Probability Structure Engine",
  SMC_DEALING_RANGE_ENGINE: "Dealing Range Engine",
  LIQUIDITY_ENGINE: "Liquidity Engine",
  SMC_LIQUIDITY_ENGINE: "Institutional Liquidity Engine",
  LIQUIDITY_SWEEP_ANALYZER: "Liquidity Sweep Analyzer",
  SMC_LIQUIDITY_LIFECYCLE_ENGINE: "Liquidity Lifecycle Engine",
  ORDER_BLOCK_ENGINE: "Order Block Engine",
  SMC_ORDER_BLOCK_ENGINE: "Institutional Order Block Engine",
  FAIR_VALUE_GAP_ENGINE: "Fair Value Gap Engine",
  SMC_FVG_ENGINE: "Institutional Fair Value Gap Engine",
  PREMIUM_DISCOUNT_MATRIX: "Premium Discount Matrix",
  SMC_POI_CONTEXT_ENGINE: "Point of Interest Context Engine",
  SMC_POI_INTELLIGENCE_ENGINE: "Point of Interest Intelligence Engine",
  SMC_CAUSALITY_ENGINE: "Market Causality Engine",
  SMC_1H_STRUCTURAL_ENGINE: "Hourly Structural Engine",
  CONFLUENCE_SCORE_EVALUATOR: "Confluence Score Evaluator",
  SETUP_GENERATOR: "Setup Generator",
  SMC_15M_SETUP_ENGINE: "15M Setup Engine",
  SMC_5M_EXECUTION_ENGINE: "5M Execution Engine",
  SMC_MULTI_TIMEFRAME_ENGINE: "Multi-Timeframe Engine",
  SMC_RULE_ENGINE: "Trading Rules Engine",
  RISK_GOVERNOR: "Risk Governor",
  EXECUTION_APPROVAL_ROUTER: "Execution Router",
  ORDER_LIFECYCLE_MANAGER: "Order Lifecycle Manager",
  BACKTEST_REPLAY_ENGINE: "Historical Replay Engine",
  SHADOW_EXECUTION_HARNESS: "Execution Verification Harness",
  STATE_PERSISTENCE_LEDGER: "State Ledger",
  AUDIT_TELEMETRY_WATCHDOG: "System Audit Watchdog",
  SMC_KNOWLEDGE_CORE_ENGINE: "Institutional Knowledge Core Engine",
  IDENTITY_SESSION_SERVICE: "Account & Security Service",
  BILLING_SUBSCRIPTION_SERVICE: "Subscription & Billing Service",
  ACCESS_PROFILE_ENGINE: "Access Profile Engine",
  STYLE_PROFILE_CLASSIFIER: "Trading Style Classifier",
  ACCESS_GATEWAY_AND_ENGINE_PROTECTION: "Access Gateway & Protection",
  MT5_LINK_SERVICE: "Execution Bridge",
  ADMIN_CONTROL_CONSOLE: "Administration Console",
  SUBSCRIBER_APP_SHELL: "Subscriber App Shell",
  NOTIFICATION_SERVICE: "Notification Service",
  AUDIT_SECURITY_LEDGER: "Audit Security Ledger",
  MONETIZATION_ANALYTICS: "Platform Analytics",
};

/**
 * Array of every known reason code explicitly cataloged.
 * Used by automated tests to ensure 100% coverage without relying on fallback.
 */
export const ALL_KNOWN_REASON_CODES: readonly string[] = Object.keys(
  REASON_CODE_TRANSLATION_MAP,
);

export interface TranslationContext {
  readonly userRole?: string;
  readonly planName?: string;
  readonly comingSoon?: boolean;
}

export class UserMessageEngine {
  /**
   * Translates an internal reason code into user-facing English.
   * Enforces the fallback rule: Any unmapped code returns the generic fallback message.
   * NEVER returns the raw reason code for unmapped strings.
   */
  public static translateReasonCode(
    code: string,
    context?: TranslationContext,
  ): string {
    if (!code || typeof code !== 'string') {
      return DEFAULT_FALLBACK_MESSAGE;
    }

    const cleanCode = code.trim();

    // Explicit GRADED split: locked (paid-plan-required or coming-soon), never available
    if (cleanCode === 'GRADED') {
      if (context?.comingSoon) {
        return 'This feature is coming soon.';
      }
      const plan = context?.planName || 'Institutional Trader Plan';
      return `This feature is part of ${plan}. Upgrade to unlock it.`;
    }

    const translation = REASON_CODE_TRANSLATION_MAP[cleanCode];

    if (translation) {
      if (translation.includes('[Plan Name]')) {
        const plan = context?.planName || 'Institutional Trader Plan';
        return translation.replace('[Plan Name]', plan);
      }
      return translation;
    }

    return DEFAULT_FALLBACK_MESSAGE;
  }

  /**
   * Translates error strings, phrases, or message payloads into clean user-facing English.
   */
  public static translateMessage(
    rawMessage: string,
    context?: TranslationContext,
  ): string {
    if (!rawMessage || typeof rawMessage !== 'string') {
      return DEFAULT_FALLBACK_MESSAGE;
    }

    const clean = rawMessage.trim();

    // Check direct code match first
    if (REASON_CODE_TRANSLATION_MAP[clean]) {
      return this.translateReasonCode(clean, context);
    }

    // Pattern matches on known system error strings
    if (clean.includes('Unauthorized') || clean.includes('Authentication token is required')) {
      return this.translateReasonCode('401_UNAUTHORIZED', context);
    }
    if (clean.includes('Session is invalid') || clean.includes('session has expired')) {
      return this.translateReasonCode('SESSION_EXPIRED', context);
    }
    if (clean.includes('Account is suspended') || clean.includes('account is suspended')) {
      return this.translateReasonCode('ACCOUNT_SUSPENDED', context);
    }
    if (
      clean.includes('Administrator privileges required') ||
      clean.includes('adminOnly') ||
      clean.includes('Forbidden')
    ) {
      return this.translateReasonCode('403_FORBIDDEN', context);
    }
    if (clean.includes('Too many failed login attempts')) {
      return this.translateReasonCode('ACCOUNT_LOCKED', context);
    }
    if (clean.includes('2FA_REQUIRED') || clean.includes('Two-factor authentication code')) {
      return this.translateReasonCode('2FA_REQUIRED', context);
    }
    if (clean.includes('Invalid email or password')) {
      return this.translateReasonCode('INVALID_CREDENTIALS', context);
    }
    if (clean.includes('market is currently closed') || clean.includes('Market is closed')) {
      return this.translateReasonCode('MARKET_CLOSED', context);
    }
    if (clean.includes('STALE_DATA')) {
      return this.translateReasonCode('STALE_DATA', context);
    }
    if (clean.includes('NO_ACTIVE_DATA_SOURCE')) {
      return this.translateReasonCode('NO_ACTIVE_DATA_SOURCE', context);
    }

    // Fallback: If it looks like an internal uppercase reason code (e.g. ABC_DEF)
    if (/^[A-Z0-9_]{3,60}$/.test(clean)) {
      return DEFAULT_FALLBACK_MESSAGE;
    }

    // Generic safe fallback if message leaks engine or internal syntax
    if (
      clean.includes('Engine') ||
      clean.includes('RULE_') ||
      clean.includes('M0') ||
      clean.includes('M1') ||
      clean.includes('M2') ||
      clean.includes('M3') ||
      clean.includes('M4')
    ) {
      return DEFAULT_FALLBACK_MESSAGE;
    }

    return clean;
  }

  /**
   * Sanitizes a safety block object for a non-admin user.
   */
  public static sanitizeSafetyBlock(block: any, context?: TranslationContext): any {
    if (!block || typeof block !== 'object') return block;

    const translatedCode = this.translateReasonCode(block.code, context);
    return {
      id: block.id ? 'active_safety_block' : undefined,
      symbol: block.symbol,
      timeframe: block.timeframe,
      severity: block.severity,
      code: translatedCode,
      title: block.title ? this.translateMessage(block.title, context) : translatedCode,
      explanation: translatedCode,
      resolutionAction: "System monitors market status and resumes automatically once current.",
      blockedSince: block.blockedSince,
    };
  }

  /**
   * Deeply traverses and translates an outgoing payload for non-admin callers.
   * If caller is ADMIN or OWNER, returns payload unmodified to preserve full technical details.
   */
  public static translatePayloadForUser<T>(
    payload: T,
    context?: TranslationContext,
  ): T {
    // 1. Admins and Owners see raw codes and full technical details
    if (context?.userRole === 'ADMIN' || context?.userRole === 'OWNER') {
      return payload;
    }

    if (payload === null || payload === undefined) {
      return payload;
    }

    if (typeof payload === 'string') {
      return this.translateMessage(payload, context) as unknown as T;
    }

    if (Array.isArray(payload)) {
      return payload.map((item) =>
        this.translatePayloadForUser(item, context),
      ) as unknown as T;
    }

    if (typeof payload === 'object') {
      const cloned: Record<string, any> = {};

      for (const [key, value] of Object.entries(payload)) {
        // Translate error / message strings
        if (key === 'error' || key === 'message' || key === 'errorMessage') {
          cloned[key] = typeof value === 'string'
            ? this.translateMessage(value, context)
            : this.translatePayloadForUser(value, context);
        }
        // Translate code or reason fields
        else if (key === 'code' || key === 'reason' || key === 'reasonCode' || key === 'ruleId') {
          cloned[key] = typeof value === 'string'
            ? this.translateReasonCode(value, context)
            : this.translatePayloadForUser(value, context);
        }
        // Translate engineStatus
        else if (key === 'engineStatus' || (key === 'status' && typeof value === 'string' && REASON_CODE_TRANSLATION_MAP[value])) {
          cloned[key] = typeof value === 'string'
            ? this.translateReasonCode(value, context)
            : this.translatePayloadForUser(value, context);
        }
        // Translate blocks array (e.g. from safety engine)
        else if (key === 'blocks' && Array.isArray(value)) {
          cloned[key] = value.map((b) => this.sanitizeSafetyBlock(b, context));
        }
        // Translate issues array (e.g. from integrity engine)
        else if (key === 'issues' && Array.isArray(value)) {
          cloned[key] = value.map((issue) => ({
            ...issue,
            code: typeof issue.code === 'string' ? this.translateReasonCode(issue.code, context) : issue.code,
            message: typeof issue.message === 'string' ? this.translateMessage(issue.message, context) : issue.message,
          }));
        }
        // Recurse into nested structures
        else {
          cloned[key] = this.translatePayloadForUser(value, context);
        }
      }

      return cloned as unknown as T;
    }

    return payload;
  }
}
