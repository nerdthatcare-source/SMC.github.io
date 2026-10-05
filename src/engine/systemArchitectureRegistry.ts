/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * System Architecture Registry
 *
 * Single source of truth naming every engine module in this SMC trading OS.
 * Every current and future phase registers here to prevent capability duplication
 * and ensure structural boundary enforcement.
 *
 * HARD INVARIANTS ENFORCED BY THIS REGISTRY:
 * 1. DERIV is the SOLE authorized canonical market-data source and execution broker.
 *    DELIBERATE HARD-RULE DECISION: OANDA_V20 is completely retired (not kept as an inactive option),
 *    specifically to eliminate any risk of cross-source data mismatch or miscalculation.
 *    BrokerId = 'DERIV' is a single literal type, making it impossible for any other source
 *    to be selected by design, not just by default.
 * 2. Absolute ban on random or synthetic pricing data in production code paths.
 * 3. Fixed structural hierarchy: 1H (HTF) -> 15M (MTF) -> 5M (LTF).
 * 4. 1M timeframe is strictly isolated from structural calculations (Swings, BOS, OB, FVG).
 */

// ============================================================================
// 1. ARCHITECTURAL LAYERS & MODULE ENUMS
// ============================================================================

export type SystemArchitecturalLayer =
  | 'DATA_INGESTION_AND_CONTRACTS'
  | 'TIMEFRAME_AND_SESSION_COORDINATION'
  | 'SMC_STRUCTURAL_CORE'
  | 'SETUP_CONFLUENCE_SYNTHESIS'
  | 'RISK_AND_EXECUTION_GOVERNANCE'
  | 'SIMULATION_PERSISTENCE_AUDIT'
  | 'PRODUCT_ACCESS_AND_MONETIZATION';

export type EngineStatus = 'BUILT' | 'NOT_BUILT';

export type EngineModuleId =
  // Layer 1: Data Ingestion & Contracts
  | 'CANONICAL_DATA_INGESTION'
  | 'CANONICAL_CONTRACT_VALIDATOR'
  | 'INSTRUMENT_MARKET_REGISTRY'
  | 'DERIV_ADAPTER'
  | 'DERIV_CONNECTION_HEALTH_ENGINE'
  | 'DERIV_BACKFILL_RECOVERY_ENGINE'
  | 'CANONICAL_MARKET_DATA_ENGINE'
  | 'CANONICAL_DATA_ENGINE'
  | 'MARKET_DATA_NORMALIZATION'
  | 'SYMBOL_MAPPING_ENGINE'
  | 'CANDLE_INTEGRITY_ENGINE'
  | 'DATA_INTEGRITY_LINEAGE_ENGINE'
  | 'DATA_SOURCE_SAFETY_ENGINE'
  // Layer 2: Timeframe & Session Coordination
  | 'STRUCTURAL_TIMEFRAME_HIERARCHY'
  | 'SESSION_TIMING_GOVERNOR'
  // Layer 3: SMC Structural Core
  | 'SWING_STRUCTURE_ENGINE'
  | 'CANONICAL_STRUCTURE_ENGINE'
  | 'CANONICAL_PERIOD_LEVELS_ENGINE'
  | 'MARKET_STRUCTURE_BREAK_DETECTOR'
  | 'SMC_MARKET_STRUCTURE_ENGINE'
  | 'SMC_STRONG_WEAK_STRUCTURE_ENGINE'
  | 'SMC_DEALING_RANGE_ENGINE'
  | 'LIQUIDITY_ENGINE'
  | 'SMC_LIQUIDITY_ENGINE'
  | 'LIQUIDITY_SWEEP_ANALYZER'
  | 'SMC_LIQUIDITY_LIFECYCLE_ENGINE'
  | 'ORDER_BLOCK_ENGINE'
  | 'SMC_ORDER_BLOCK_ENGINE'
  | 'FAIR_VALUE_GAP_ENGINE'
  | 'SMC_FVG_ENGINE'
  | 'PREMIUM_DISCOUNT_MATRIX'
  | 'SMC_POI_CONTEXT_ENGINE'
  | 'SMC_POI_INTELLIGENCE_ENGINE'
  | 'SMC_CAUSALITY_ENGINE'
  | 'SMC_1H_STRUCTURAL_ENGINE'
  // Layer 4: Setup Confluence Synthesis
  | 'CONFLUENCE_SCORE_EVALUATOR'
  | 'CONFLUENCE_ENGINE'
  | 'SETUP_GENERATOR'
  | 'ENTRY_ENGINE'
  | 'SMC_15M_SETUP_ENGINE'
  | 'SMC_5M_EXECUTION_ENGINE'
  | 'SMC_MULTI_TIMEFRAME_ENGINE'
  | 'SMC_RULE_ENGINE'
  // Layer 5: Risk & Execution Governance
  | 'RISK_GOVERNOR'
  | 'STRUCTURAL_STOP_LOSS_ENGINE'
  | 'STRUCTURAL_TAKE_PROFIT_ENGINE'
  | 'RISK_REWARD_TRADE_QUALITY_ENGINE'
  | 'EXECUTION_APPROVAL_ROUTER'
  | 'ORDER_LIFECYCLE_MANAGER'
  // Layer 6: Simulation, Persistence & Audit
  | 'BACKTEST_REPLAY_ENGINE'
  | 'SHADOW_EXECUTION_HARNESS'
  | 'STATE_PERSISTENCE_LEDGER'
  | 'AUDIT_TELEMETRY_WATCHDOG'
  | 'SMC_KNOWLEDGE_CORE_ENGINE'
  // Layer 7: Product Access & Monetization (Modules 34-44)
  | 'IDENTITY_SESSION_SERVICE'
  | 'BILLING_SUBSCRIPTION_SERVICE'
  | 'ACCESS_PROFILE_ENGINE'
  | 'STYLE_PROFILE_CLASSIFIER'
  | 'ACCESS_GATEWAY_AND_ENGINE_PROTECTION'
  | 'MT5_LINK_SERVICE'
  | 'ADMIN_CONTROL_CONSOLE'
  | 'SUBSCRIBER_APP_SHELL'
  | 'NOTIFICATION_SERVICE'
  | 'AUDIT_SECURITY_LEDGER'
  | 'MONETIZATION_ANALYTICS';

export interface EngineModuleDescriptor {
  readonly id: EngineModuleId;
  readonly moduleIdNumber?: number;
  readonly name: string;
  readonly layer: SystemArchitecturalLayer;
  readonly description: string; // Mandatory one-line canonical description
  readonly dependencies: readonly EngineModuleId[];
  readonly enforcesHardRules: readonly string[];
  readonly engineStatus?: EngineStatus;
}

// ============================================================================
// 2. HARD SYSTEM INVARIANTS MASTER LIST
// ============================================================================

export interface SystemHardRule {
  readonly id: string;
  readonly title: string;
  readonly statement: string;
  readonly technicalEnforcement: string;
}

export const SYSTEM_HARD_RULES: readonly SystemHardRule[] = [
  {
    id: 'HARD_RULE_1_CANONICAL_DATA_SOURCE',
    title: 'DERIV Canonical Provenance Exclusivity (OANDA v20 Retired)',
    statement:
      'DELIBERATE HARD-RULE DECISION: DERIV is the sole authorized canonical market-data source for this system, specifically to eliminate any risk of cross-source data mismatch or miscalculation. OANDA_V20 is retired, not kept as an inactive option.',
    technicalEnforcement:
      'Runtime validator rejects any tick or candle where source !== "DERIV". BrokerId is a single literal type: BrokerId = "DERIV", making it structurally impossible for any other source to be selected by design.',
  },
  {
    id: 'HARD_RULE_2_NO_SYNTHETIC_DATA',
    title: 'Zero Synthetic / Random Data Tolerance',
    statement:
      'No random, simulated, or synthetic market data is permitted in production code paths.',
    technicalEnforcement:
      'Canonical validator actively scans for synthetic flags (isSynthetic, mock, simulated) and aborts on detection.',
  },
  {
    id: 'HARD_RULE_3_FIXED_TIMEFRAME_HIERARCHY',
    title: 'Strict 1H -> 15M -> 5M Structural Cascade',
    statement:
      'The multi-timeframe analytical hierarchy is fixed: 1H (HTF) establishes bias, 15M (MTF) provides internal structure, and 5M (LTF) identifies micro-confirmations.',
    technicalEnforcement:
      'TIMEFRAME_HIERARCHY_LEVEL numeric precedence matrix dictates downstream evaluation order.',
  },
  {
    id: 'HARD_RULE_4_EXECUTION_TIMEFRAME_ISOLATION',
    title: '1M Structural Calculation Quarantine',
    statement:
      '1M execution data must NEVER be merged into higher-timeframe structural calculations (Swings, BOS, OB, FVG, Dealing Ranges).',
    technicalEnforcement:
      'StructuralTimeframe type strictly excludes "1M" (Exclude<Timeframe, "1M">), and assertStructuralTimeframe() throws at runtime.',
  },
];

// ============================================================================
// 3. MASTER ARCHITECTURE REGISTRY (ONE-LINE DESCRIPTIONS)
// ============================================================================

export const SYSTEM_ARCHITECTURE_REGISTRY: Readonly<
  Record<EngineModuleId, EngineModuleDescriptor>
> = {
  // --------------------------------------------------------------------------
  // LAYER 1: DATA INGESTION & CONTRACTS
  // --------------------------------------------------------------------------
  CANONICAL_DATA_INGESTION: {
    id: 'CANONICAL_DATA_INGESTION',
    name: 'Canonical Data Ingestion',
    layer: 'DATA_INGESTION_AND_CONTRACTS',
    description:
      'Ingests raw streaming ticks and historical candles strictly from DERIV endpoints (OANDA v20 retired).',
    dependencies: [],
    enforcesHardRules: [
      'HARD_RULE_1_CANONICAL_DATA_SOURCE',
      'HARD_RULE_2_NO_SYNTHETIC_DATA',
    ],
  },

  CANONICAL_CONTRACT_VALIDATOR: {
    id: 'CANONICAL_CONTRACT_VALIDATOR',
    name: 'Canonical Contract Validator',
    layer: 'DATA_INGESTION_AND_CONTRACTS',
    description:
      'Validates candle and tick integrity, enforcing mathematical OHLC monotonicity, timestamp sanity, and zero synthetic tolerance.',
    dependencies: ['CANONICAL_DATA_INGESTION'],
    enforcesHardRules: [
      'HARD_RULE_1_CANONICAL_DATA_SOURCE',
      'HARD_RULE_2_NO_SYNTHETIC_DATA',
    ],
  },

  INSTRUMENT_MARKET_REGISTRY: {
    id: 'INSTRUMENT_MARKET_REGISTRY',
    name: 'Instrument Market Registry',
    layer: 'DATA_INGESTION_AND_CONTRACTS',
    description:
      'Maintains authoritative pip sizes, session killzones, lot multipliers, and ATR volatility profiles for all approved instruments in the Deriv catalog (25 forex, 4 metals, 12 indices, 2 crypto).',
    dependencies: [],
    enforcesHardRules: ['HARD_RULE_1_CANONICAL_DATA_SOURCE'],
  },

  DERIV_ADAPTER: {
    id: 'DERIV_ADAPTER',
    name: 'Deriv WebSocket API Adapter',
    layer: 'DATA_INGESTION_AND_CONTRACTS',
    description:
      'Direct WebSocket client for Deriv v3 API: auth, ticks_history, active_symbols, ping/pong, and forget lifecycle.',
    dependencies: [],
    enforcesHardRules: [
      'HARD_RULE_1_CANONICAL_DATA_SOURCE',
      'HARD_RULE_2_NO_SYNTHETIC_DATA',
    ],
  },

  DERIV_CONNECTION_HEALTH_ENGINE: {
    id: 'DERIV_CONNECTION_HEALTH_ENGINE',
    name: 'Deriv Connection Health Engine',
    layer: 'DATA_INGESTION_AND_CONTRACTS',
    description:
      'Monitors Deriv WebSocket uptime, ping/pong latency, reconnect cycles, and emits canonical FeedStatus.',
    dependencies: ['DERIV_ADAPTER'],
    enforcesHardRules: ['HARD_RULE_1_CANONICAL_DATA_SOURCE'],
  },

  DERIV_BACKFILL_RECOVERY_ENGINE: {
    id: 'DERIV_BACKFILL_RECOVERY_ENGINE',
    name: 'Deriv Backfill Recovery Engine',
    layer: 'DATA_INGESTION_AND_CONTRACTS',
    description:
      'Detects gaps on startup and reconnect, querying Deriv ticks_history across all 4 timeframes without duplicate seam candles.',
    dependencies: ['DERIV_ADAPTER', 'CANONICAL_MARKET_DATA_ENGINE'],
    enforcesHardRules: [
      'HARD_RULE_1_CANONICAL_DATA_SOURCE',
      'HARD_RULE_2_NO_SYNTHETIC_DATA',
    ],
  },

  CANONICAL_MARKET_DATA_ENGINE: {
    id: 'CANONICAL_MARKET_DATA_ENGINE',
    name: 'Canonical Market Data Engine',
    layer: 'DATA_INGESTION_AND_CONTRACTS',
    description:
      'Normalizes raw Deriv responses into canonical Candles, deduplicates by timestamp, and provides the authoritative single-point read API.',
    dependencies: ['DERIV_ADAPTER', 'CANONICAL_CONTRACT_VALIDATOR'],
    enforcesHardRules: [
      'HARD_RULE_1_CANONICAL_DATA_SOURCE',
      'HARD_RULE_2_NO_SYNTHETIC_DATA',
    ],
  },

  CANONICAL_DATA_ENGINE: {
    id: 'CANONICAL_DATA_ENGINE',
    name: 'Canonical Data Engine Facade',
    layer: 'DATA_INGESTION_AND_CONTRACTS',
    description:
      'Unified high-level facade coordinating historical candle queries, streaming cache, backfill triggers, and integrity status.',
    dependencies: [
      'CANONICAL_MARKET_DATA_ENGINE',
      'DERIV_BACKFILL_RECOVERY_ENGINE',
      'CANDLE_INTEGRITY_ENGINE',
    ],
    enforcesHardRules: ['HARD_RULE_1_CANONICAL_DATA_SOURCE'],
  },

  MARKET_DATA_NORMALIZATION: {
    id: 'MARKET_DATA_NORMALIZATION',
    name: 'Market Data Normalization Engine',
    layer: 'DATA_INGESTION_AND_CONTRACTS',
    description:
      'Normalizes price precision, pip distances, and timestamp representations into standard canonical formats across brokers.',
    dependencies: ['INSTRUMENT_MARKET_REGISTRY'],
    enforcesHardRules: [],
  },

  SYMBOL_MAPPING_ENGINE: {
    id: 'SYMBOL_MAPPING_ENGINE',
    name: 'Symbol Mapping Engine',
    layer: 'DATA_INGESTION_AND_CONTRACTS',
    description:
      'Bidirectionally translates instrument identifiers across Deriv (frx-prefixed), display format, clean ticker, and TradingView conventions.',
    dependencies: ['INSTRUMENT_MARKET_REGISTRY'],
    enforcesHardRules: ['HARD_RULE_1_CANONICAL_DATA_SOURCE'],
  },

  CANDLE_INTEGRITY_ENGINE: {
    id: 'CANDLE_INTEGRITY_ENGINE',
    name: 'Candle Integrity & Desync Engine',
    layer: 'DATA_INGESTION_AND_CONTRACTS',
    description:
      'Audits candle batches for gaps, duplicate timestamps, and cross-timeframe desync (e.g. 15M candles not covered by 5M children).',
    dependencies: [
      'CANONICAL_CONTRACT_VALIDATOR',
      'CANONICAL_MARKET_DATA_ENGINE',
    ],
    enforcesHardRules: [
      'HARD_RULE_3_FIXED_TIMEFRAME_HIERARCHY',
      'HARD_RULE_4_EXECUTION_TIMEFRAME_ISOLATION',
    ],
  },

  DATA_INTEGRITY_LINEAGE_ENGINE: {
    id: 'DATA_INTEGRITY_LINEAGE_ENGINE',
    name: 'Data Integrity Lineage Engine',
    layer: 'DATA_INGESTION_AND_CONTRACTS',
    description:
      'Maintains an immutable audit ledger recording every candle provenance (source, fetch epoch, backfilled vs streamed, payload checksum).',
    dependencies: ['CANONICAL_MARKET_DATA_ENGINE'],
    enforcesHardRules: [
      'HARD_RULE_1_CANONICAL_DATA_SOURCE',
      'HARD_RULE_2_NO_SYNTHETIC_DATA',
    ],
  },

  DATA_SOURCE_SAFETY_ENGINE: {
    id: 'DATA_SOURCE_SAFETY_ENGINE',
    name: 'Data Source Safety Gatekeeper',
    layer: 'DATA_INGESTION_AND_CONTRACTS',
    description:
      'Fail-closed gatekeeper that halts downstream analysis for corrupted symbols/timeframes and explains why not to trade.',
    dependencies: [
      'CANDLE_INTEGRITY_ENGINE',
      'DERIV_CONNECTION_HEALTH_ENGINE',
    ],
    enforcesHardRules: [
      'HARD_RULE_1_CANONICAL_DATA_SOURCE',
      'HARD_RULE_2_NO_SYNTHETIC_DATA',
    ],
  },

  // --------------------------------------------------------------------------
  // LAYER 2: TIMEFRAME & SESSION COORDINATION
  // --------------------------------------------------------------------------
  STRUCTURAL_TIMEFRAME_HIERARCHY: {
    id: 'STRUCTURAL_TIMEFRAME_HIERARCHY',
    name: 'Structural Timeframe Hierarchy Engine',
    layer: 'TIMEFRAME_AND_SESSION_COORDINATION',
    description:
      'Orchestrates the fixed 1H -> 15M -> 5M analytical pipeline while strictly isolating 1M candles from structural algorithms.',
    dependencies: [
      'CANONICAL_CONTRACT_VALIDATOR',
      'INSTRUMENT_MARKET_REGISTRY',
    ],
    enforcesHardRules: [
      'HARD_RULE_3_FIXED_TIMEFRAME_HIERARCHY',
      'HARD_RULE_4_EXECUTION_TIMEFRAME_ISOLATION',
    ],
  },

  SESSION_TIMING_GOVERNOR: {
    id: 'SESSION_TIMING_GOVERNOR',
    name: 'Session Timing Governor',
    layer: 'TIMEFRAME_AND_SESSION_COORDINATION',
    description:
      'Enforces Asian, London, and New York Killzone operating hours and locks execution during weekend and daily rollover maintenance.',
    dependencies: ['INSTRUMENT_MARKET_REGISTRY'],
    enforcesHardRules: [],
  },

  // --------------------------------------------------------------------------
  // LAYER 3: SMC STRUCTURAL CORE
  // --------------------------------------------------------------------------
  SWING_STRUCTURE_ENGINE: {
    id: 'SWING_STRUCTURE_ENGINE',
    name: 'Swing Structure Engine',
    layer: 'SMC_STRUCTURAL_CORE',
    description:
      'Detects fractal swing highs and lows, categorizing strong, weak, and intermediate pivot points across 1H, 15M, and 5M frames.',
    dependencies: ['STRUCTURAL_TIMEFRAME_HIERARCHY'],
    enforcesHardRules: ['HARD_RULE_4_EXECUTION_TIMEFRAME_ISOLATION'],
  },

  CANONICAL_STRUCTURE_ENGINE: {
    id: 'CANONICAL_STRUCTURE_ENGINE',
    name: 'Canonical Structure Engine',
    layer: 'SMC_STRUCTURAL_CORE',
    description:
      'Deterministic swing point detection with timeframe-specific lookback (3/3 for 1H/15M, 2/2 for 5M), HH/HL/LH/LL labeling, and vulnerability tracking.',
    dependencies: ['STRUCTURAL_TIMEFRAME_HIERARCHY'],
    enforcesHardRules: ['HARD_RULE_4_EXECUTION_TIMEFRAME_ISOLATION'],
  },

  CANONICAL_PERIOD_LEVELS_ENGINE: {
    id: 'CANONICAL_PERIOD_LEVELS_ENGINE',
    name: 'Canonical Period Levels Engine',
    layer: 'SMC_STRUCTURAL_CORE',
    description:
      'Computes prior-day (PDH/PDL), prior-week (PWH/PWL), and session-based reference levels as key external liquidity pools.',
    dependencies: ['STRUCTURAL_TIMEFRAME_HIERARCHY'],
    enforcesHardRules: ['HARD_RULE_4_EXECUTION_TIMEFRAME_ISOLATION'],
  },

  MARKET_STRUCTURE_BREAK_DETECTOR: {
    id: 'MARKET_STRUCTURE_BREAK_DETECTOR',
    name: 'Market Structure Break Detector',
    layer: 'SMC_STRUCTURAL_CORE',
    description:
      'Identifies candle-close confirmed Break of Structure (BOS) and Change of Character (CHoCH) events across validated swings.',
    dependencies: ['SWING_STRUCTURE_ENGINE'],
    enforcesHardRules: ['HARD_RULE_4_EXECUTION_TIMEFRAME_ISOLATION'],
  },

  SMC_MARKET_STRUCTURE_ENGINE: {
    id: 'SMC_MARKET_STRUCTURE_ENGINE',
    name: 'SMC Market Structure Engine',
    layer: 'SMC_STRUCTURAL_CORE',
    description:
      'Detects BOS and CHoCH structural shifts with SWING vs INTERNAL tagging, producing comprehensive TimeframeStructureAnalysis reports.',
    dependencies: ['CANONICAL_STRUCTURE_ENGINE'],
    enforcesHardRules: ['HARD_RULE_4_EXECUTION_TIMEFRAME_ISOLATION'],
  },

  SMC_STRONG_WEAK_STRUCTURE_ENGINE: {
    id: 'SMC_STRONG_WEAK_STRUCTURE_ENGINE',
    name: 'SMC Strong / Weak Structure Engine',
    layer: 'SMC_STRUCTURAL_CORE',
    description:
      'Classifies strong structural pivots (institutional anchors protecting trend) versus weak untested targets (liquidity attractors).',
    dependencies: ['SMC_MARKET_STRUCTURE_ENGINE'],
    enforcesHardRules: ['HARD_RULE_4_EXECUTION_TIMEFRAME_ISOLATION'],
  },

  SMC_DEALING_RANGE_ENGINE: {
    id: 'SMC_DEALING_RANGE_ENGINE',
    name: 'SMC Dealing Range & Premium/Discount Engine',
    layer: 'SMC_STRUCTURAL_CORE',
    description:
      'Determines defining range high/low, computes exact 50% equilibrium, and categorizes price into Premium, Discount, OTE, and Extreme sub-zones.',
    dependencies: ['SMC_MARKET_STRUCTURE_ENGINE'],
    enforcesHardRules: ['HARD_RULE_4_EXECUTION_TIMEFRAME_ISOLATION'],
  },

  LIQUIDITY_ENGINE: {
    id: 'LIQUIDITY_ENGINE',
    name: 'Liquidity Pool Engine',
    layer: 'SMC_STRUCTURAL_CORE',
    description:
      'Maps buy-side (BSL), sell-side (SSL), equal highs/lows (EQH/EQL), and session extremes to locate resting stop clusters.',
    dependencies: ['SWING_STRUCTURE_ENGINE', 'SESSION_TIMING_GOVERNOR'],
    enforcesHardRules: ['HARD_RULE_4_EXECUTION_TIMEFRAME_ISOLATION'],
  },

  SMC_LIQUIDITY_ENGINE: {
    id: 'SMC_LIQUIDITY_ENGINE',
    name: 'SMC External & Internal Liquidity Engine',
    layer: 'SMC_STRUCTURAL_CORE',
    description:
      'Detects External Range Liquidity (PDH/PDL/PWH/PWL, major swings) and Internal Range Liquidity (EQH/EQL within 0.15*ATR, minor swings).',
    dependencies: ['CANONICAL_PERIOD_LEVELS_ENGINE', 'CANONICAL_STRUCTURE_ENGINE'],
    enforcesHardRules: ['HARD_RULE_4_EXECUTION_TIMEFRAME_ISOLATION'],
  },

  LIQUIDITY_SWEEP_ANALYZER: {
    id: 'LIQUIDITY_SWEEP_ANALYZER',
    name: 'Liquidity Sweep Analyzer',
    layer: 'SMC_STRUCTURAL_CORE',
    description:
      'Detects turtle soups, wick rejections, and fake breakouts that pierce liquidity pools and immediately reverse.',
    dependencies: ['LIQUIDITY_ENGINE'],
    enforcesHardRules: [],
  },

  SMC_LIQUIDITY_LIFECYCLE_ENGINE: {
    id: 'SMC_LIQUIDITY_LIFECYCLE_ENGINE',
    name: 'SMC Liquidity Lifecycle & Sweep Store',
    layer: 'SMC_STRUCTURAL_CORE',
    description:
      'Tracks pool states (UNTOUCHED -> APPROACHING -> SWEPT -> REVERSED) and maintains a persistent liquidity sweep event store.',
    dependencies: ['SMC_LIQUIDITY_ENGINE'],
    enforcesHardRules: ['HARD_RULE_4_EXECUTION_TIMEFRAME_ISOLATION'],
  },

  ORDER_BLOCK_ENGINE: {
    id: 'ORDER_BLOCK_ENGINE',
    name: 'Order Block Engine',
    layer: 'SMC_STRUCTURAL_CORE',
    description:
      'Identifies, grades, and tracks mitigation thresholds of institutional order blocks causing directional market displacement.',
    dependencies: ['MARKET_STRUCTURE_BREAK_DETECTOR'],
    enforcesHardRules: ['HARD_RULE_4_EXECUTION_TIMEFRAME_ISOLATION'],
  },

  SMC_ORDER_BLOCK_ENGINE: {
    id: 'SMC_ORDER_BLOCK_ENGINE',
    name: 'SMC Displacement Order Block Engine',
    layer: 'SMC_STRUCTURAL_CORE',
    description:
      'Detects order blocks originating from displacement candles, tagging SWING vs INTERNAL scope and tracking 50% Mean Threshold mitigations.',
    dependencies: ['SMC_MARKET_STRUCTURE_ENGINE'],
    enforcesHardRules: ['HARD_RULE_4_EXECUTION_TIMEFRAME_ISOLATION'],
  },

  FAIR_VALUE_GAP_ENGINE: {
    id: 'FAIR_VALUE_GAP_ENGINE',
    name: 'Fair Value Gap (FVG) Engine',
    layer: 'SMC_STRUCTURAL_CORE',
    description:
      'Detects three-candle imbalances (BISI/SIBI), tracking 50% consequent encroachment (CE) mitigations and inversion gap flips.',
    dependencies: ['STRUCTURAL_TIMEFRAME_HIERARCHY'],
    enforcesHardRules: ['HARD_RULE_4_EXECUTION_TIMEFRAME_ISOLATION'],
  },

  SMC_FVG_ENGINE: {
    id: 'SMC_FVG_ENGINE',
    name: 'SMC Fair Value Gap Imbalance Engine',
    layer: 'SMC_STRUCTURAL_CORE',
    description:
      'Validates 3-candle BISI/SIBI gaps, computes 50% Consequent Encroachment (CE), and manages UNMITIGATED to FULLY_MITIGATED lifecycles.',
    dependencies: ['STRUCTURAL_TIMEFRAME_HIERARCHY'],
    enforcesHardRules: ['HARD_RULE_4_EXECUTION_TIMEFRAME_ISOLATION'],
  },

  PREMIUM_DISCOUNT_MATRIX: {
    id: 'PREMIUM_DISCOUNT_MATRIX',
    name: 'Premium / Discount Matrix Engine',
    layer: 'SMC_STRUCTURAL_CORE',
    description:
      'Calculates 50% equilibrium and Fibonacci optimal trade entry (OTE) zones across active higher-timeframe dealing ranges.',
    dependencies: ['SWING_STRUCTURE_ENGINE'],
    enforcesHardRules: ['HARD_RULE_4_EXECUTION_TIMEFRAME_ISOLATION'],
  },

  SMC_POI_CONTEXT_ENGINE: {
    id: 'SMC_POI_CONTEXT_ENGINE',
    name: 'SMC Point of Interest Context Engine',
    layer: 'SMC_STRUCTURAL_CORE',
    description:
      'Evaluates HTF bias alignment, Premium/Discount dealing range location, and killzone context for Order Blocks and FVGs.',
    dependencies: ['SMC_ORDER_BLOCK_ENGINE', 'SMC_FVG_ENGINE', 'SMC_DEALING_RANGE_ENGINE'],
    enforcesHardRules: ['HARD_RULE_3_FIXED_TIMEFRAME_HIERARCHY'],
  },

  SMC_POI_INTELLIGENCE_ENGINE: {
    id: 'SMC_POI_INTELLIGENCE_ENGINE',
    name: 'SMC Point of Interest Intelligence & Ranking Engine',
    layer: 'SMC_STRUCTURAL_CORE',
    description:
      'Combines and ranks all active Order Blocks, FVGs, and Liquidity Pools into an actionable prioritized hierarchy with conviction grades.',
    dependencies: ['SMC_POI_CONTEXT_ENGINE', 'SMC_LIQUIDITY_LIFECYCLE_ENGINE'],
    enforcesHardRules: ['HARD_RULE_3_FIXED_TIMEFRAME_HIERARCHY'],
  },

  SMC_CAUSALITY_ENGINE: {
    id: 'SMC_CAUSALITY_ENGINE',
    name: 'SMC Causal Attribution & Setup Lineage Engine',
    layer: 'SMC_STRUCTURAL_CORE',
    description:
      'Reconstructs the full causal chain linking liquidity sweep triggers to market displacement, structure breaks, and POI creation.',
    dependencies: [
      'SMC_LIQUIDITY_LIFECYCLE_ENGINE',
      'SMC_MARKET_STRUCTURE_ENGINE',
      'SMC_ORDER_BLOCK_ENGINE',
      'SMC_FVG_ENGINE',
    ],
    enforcesHardRules: [
      'HARD_RULE_3_FIXED_TIMEFRAME_HIERARCHY',
      'HARD_RULE_4_EXECUTION_TIMEFRAME_ISOLATION',
    ],
  },

  SMC_1H_STRUCTURAL_ENGINE: {
    id: 'SMC_1H_STRUCTURAL_ENGINE',
    name: 'SMC 1H Structural Engine',
    layer: 'SMC_STRUCTURAL_CORE',
    description:
      'High-timeframe structural foundation consuming Phase 1 getCandles(), Phase 2 structure to establish DirectionalBias, and surfacing Phase 3 active 1H POIs.',
    dependencies: [
      'CANONICAL_MARKET_DATA_ENGINE',
      'SMC_MARKET_STRUCTURE_ENGINE',
      'SMC_DEALING_RANGE_ENGINE',
      'SMC_ORDER_BLOCK_ENGINE',
      'SMC_FVG_ENGINE',
      'SMC_LIQUIDITY_ENGINE',
    ],
    enforcesHardRules: [
      'HARD_RULE_3_FIXED_TIMEFRAME_HIERARCHY',
      'HARD_RULE_4_EXECUTION_TIMEFRAME_ISOLATION',
    ],
  },

  // --------------------------------------------------------------------------
  // LAYER 4: SETUP CONFLUENCE SYNTHESIS
  // --------------------------------------------------------------------------
  CONFLUENCE_SCORE_EVALUATOR: {
    id: 'CONFLUENCE_SCORE_EVALUATOR',
    name: 'Confluence Score Evaluator',
    layer: 'SETUP_CONFLUENCE_SYNTHESIS',
    description:
      'Aggregates HTF directional alignment, liquidity sweep confirmation, OB/FVG taps, and killzone timing into a composite conviction score (0-100).',
    dependencies: [
      'MARKET_STRUCTURE_BREAK_DETECTOR',
      'LIQUIDITY_SWEEP_ANALYZER',
      'ORDER_BLOCK_ENGINE',
      'FAIR_VALUE_GAP_ENGINE',
      'PREMIUM_DISCOUNT_MATRIX',
      'SESSION_TIMING_GOVERNOR',
    ],
    enforcesHardRules: ['HARD_RULE_3_FIXED_TIMEFRAME_HIERARCHY'],
  },

  CONFLUENCE_ENGINE: {
    id: 'CONFLUENCE_ENGINE',
    name: 'Confluence Engine',
    layer: 'SETUP_CONFLUENCE_SYNTHESIS',
    engineStatus: 'BUILT',
    description:
      'Evaluates multi-factor confluence matrix across 1H bias, 15M POI conviction grades, 5M triggers, liquidity sweeps, and candlestick/displacement patterns, firing setups above MIN_CONFLUENCE_SCORE (75).',
    dependencies: [
      'SMC_1H_STRUCTURAL_ENGINE',
      'SMC_15M_SETUP_ENGINE',
      'SMC_5M_EXECUTION_ENGINE',
      'SMC_POI_INTELLIGENCE_ENGINE',
    ],
    enforcesHardRules: [
      'HARD_RULE_1_CANONICAL_DATA_SOURCE',
      'HARD_RULE_2_NO_SYNTHETIC_DATA',
      'HARD_RULE_3_FIXED_TIMEFRAME_HIERARCHY',
      'HARD_RULE_4_EXECUTION_TIMEFRAME_ISOLATION',
    ],
  },

  SETUP_GENERATOR: {
    id: 'SETUP_GENERATOR',
    name: 'SMC Setup Generator',
    layer: 'SETUP_CONFLUENCE_SYNTHESIS',
    description:
      'Constructs actionable SMCTradeSetup candidates with strict entry, invalidation stop-loss, and multi-tier take-profit targets.',
    dependencies: ['CONFLUENCE_SCORE_EVALUATOR'],
    enforcesHardRules: [],
  },

  ENTRY_ENGINE: {
    id: 'ENTRY_ENGINE',
    name: 'Structural Entry Engine',
    layer: 'SETUP_CONFLUENCE_SYNTHESIS',
    engineStatus: 'BUILT',
    description:
      'Generates precise entry prices anchored to 50% CE of FVGs, proximal edges of Order Blocks, or liquidity sweep retest levels with typed justifying POI contracts.',
    dependencies: ['CONFLUENCE_ENGINE', 'ORDER_BLOCK_ENGINE', 'FAIR_VALUE_GAP_ENGINE'],
    enforcesHardRules: ['HARD_RULE_3_FIXED_TIMEFRAME_HIERARCHY'],
  },

  SMC_15M_SETUP_ENGINE: {
    id: 'SMC_15M_SETUP_ENGINE',
    name: 'SMC 15M Setup Engine',
    layer: 'SETUP_CONFLUENCE_SYNTHESIS',
    description:
      'Evaluates whether price is at an unmitigated key POI with existing conviction grade from Phase 3, classified via Phase 2 premium/discount dealing ranges.',
    dependencies: [
      'SMC_1H_STRUCTURAL_ENGINE',
      'SMC_POI_INTELLIGENCE_ENGINE',
      'SMC_DEALING_RANGE_ENGINE',
      'SMC_MARKET_STRUCTURE_ENGINE',
    ],
    enforcesHardRules: [
      'HARD_RULE_3_FIXED_TIMEFRAME_HIERARCHY',
      'HARD_RULE_4_EXECUTION_TIMEFRAME_ISOLATION',
    ],
  },

  SMC_5M_EXECUTION_ENGINE: {
    id: 'SMC_5M_EXECUTION_ENGINE',
    name: 'SMC 5M Execution Engine',
    layer: 'SETUP_CONFLUENCE_SYNTHESIS',
    description:
      'Validates the 4-stage confirmation sequence: liquidity sweep (Phase 3 SWEPT state) -> displacement (body/range > 0.65) -> BOS/CHoCH -> retracement into 15M POI.',
    dependencies: [
      'SMC_1H_STRUCTURAL_ENGINE',
      'SMC_15M_SETUP_ENGINE',
      'SMC_LIQUIDITY_LIFECYCLE_ENGINE',
      'SMC_MARKET_STRUCTURE_ENGINE',
    ],
    enforcesHardRules: [
      'HARD_RULE_3_FIXED_TIMEFRAME_HIERARCHY',
      'HARD_RULE_4_EXECUTION_TIMEFRAME_ISOLATION',
    ],
  },

  SMC_MULTI_TIMEFRAME_ENGINE: {
    id: 'SMC_MULTI_TIMEFRAME_ENGINE',
    name: 'SMC Multi-Timeframe Orchestration Engine',
    layer: 'SETUP_CONFLUENCE_SYNTHESIS',
    description:
      'Orchestrates 1H, 15M, and 5M engines, verifies move alignment, detects counter-trend contradictions, and cross-checks Phase 1 sync scores to fail closed.',
    dependencies: [
      'SMC_1H_STRUCTURAL_ENGINE',
      'SMC_15M_SETUP_ENGINE',
      'SMC_5M_EXECUTION_ENGINE',
      'CANDLE_INTEGRITY_ENGINE',
    ],
    enforcesHardRules: [
      'HARD_RULE_3_FIXED_TIMEFRAME_HIERARCHY',
      'HARD_RULE_4_EXECUTION_TIMEFRAME_ISOLATION',
    ],
  },

  SMC_RULE_ENGINE: {
    id: 'SMC_RULE_ENGINE',
    name: 'SMC Master Rule Engine',
    layer: 'SETUP_CONFLUENCE_SYNTHESIS',
    description:
      'Top-level master performSMCAnalysis entry point composing 1H, 15M, 5M, and isolated 1M execution micro annotations into SMCAnalysisResult.',
    dependencies: [
      'SMC_MULTI_TIMEFRAME_ENGINE',
      'SMC_KNOWLEDGE_CORE_ENGINE',
    ],
    enforcesHardRules: [
      'HARD_RULE_1_CANONICAL_DATA_SOURCE',
      'HARD_RULE_2_NO_SYNTHETIC_DATA',
      'HARD_RULE_3_FIXED_TIMEFRAME_HIERARCHY',
      'HARD_RULE_4_EXECUTION_TIMEFRAME_ISOLATION',
    ],
  },

  // --------------------------------------------------------------------------
  // LAYER 5: RISK & EXECUTION GOVERNANCE
  // --------------------------------------------------------------------------
  RISK_GOVERNOR: {
    id: 'RISK_GOVERNOR',
    name: 'Institutional Risk Governor',
    layer: 'RISK_AND_EXECUTION_GOVERNANCE',
    description:
      'Enforces strict 1% risk per trade, 3% daily loss circuit breakers, max concurrent exposures, and minimum 2.5R reward ratio.',
    dependencies: ['SETUP_GENERATOR', 'INSTRUMENT_MARKET_REGISTRY'],
    enforcesHardRules: [],
  },

  STRUCTURAL_STOP_LOSS_ENGINE: {
    id: 'STRUCTURAL_STOP_LOSS_ENGINE',
    name: 'Structural Stop Loss Engine',
    layer: 'RISK_AND_EXECUTION_GOVERNANCE',
    engineStatus: 'BUILT',
    description:
      'Calculates protective structural stop-loss prices beyond invalidating swing points or order block distal edges plus calibrated buffers for all 43 catalog symbols.',
    dependencies: ['ENTRY_ENGINE', 'INSTRUMENT_MARKET_REGISTRY', 'SWING_STRUCTURE_ENGINE'],
    enforcesHardRules: ['HARD_RULE_3_FIXED_TIMEFRAME_HIERARCHY'],
  },

  STRUCTURAL_TAKE_PROFIT_ENGINE: {
    id: 'STRUCTURAL_TAKE_PROFIT_ENGINE',
    name: 'Structural Take Profit Engine',
    layer: 'RISK_AND_EXECUTION_GOVERNANCE',
    engineStatus: 'BUILT',
    description:
      'Computes multi-tier take-profit levels (TP1, TP2, TP3) anchored to opposing internal and external liquidity pools and swing points in the trade direction.',
    dependencies: ['ENTRY_ENGINE', 'LIQUIDITY_ENGINE', 'SMC_DEALING_RANGE_ENGINE'],
    enforcesHardRules: ['HARD_RULE_3_FIXED_TIMEFRAME_HIERARCHY'],
  },

  RISK_REWARD_TRADE_QUALITY_ENGINE: {
    id: 'RISK_REWARD_TRADE_QUALITY_ENGINE',
    name: 'Risk-to-Reward Trade Quality Engine',
    layer: 'RISK_AND_EXECUTION_GOVERNANCE',
    engineStatus: 'BUILT',
    description:
      'Computes actual R:R from entry/SL/TP, grades trade execution quality (A+, A, B, C), and enforces strict fail-closed rejection for setups below minRiskRewardRatio.',
    dependencies: [
      'ENTRY_ENGINE',
      'STRUCTURAL_STOP_LOSS_ENGINE',
      'STRUCTURAL_TAKE_PROFIT_ENGINE',
    ],
    enforcesHardRules: [],
  },

  EXECUTION_APPROVAL_ROUTER: {
    id: 'EXECUTION_APPROVAL_ROUTER',
    name: 'Execution Approval Router',
    layer: 'RISK_AND_EXECUTION_GOVERNANCE',
    description:
      'Routes trade setups through autonomous, semi-autonomous 1-click confirmation, or manual approval gates before broker transmission.',
    dependencies: ['RISK_GOVERNOR'],
    enforcesHardRules: [],
  },

  ORDER_LIFECYCLE_MANAGER: {
    id: 'ORDER_LIFECYCLE_MANAGER',
    name: 'Order Lifecycle Manager',
    layer: 'RISK_AND_EXECUTION_GOVERNANCE',
    description:
      'Manages Deriv bracket orders, break-even trailing triggers, partial TP scaling, and real-time execution slippage monitoring.',
    dependencies: ['EXECUTION_APPROVAL_ROUTER'],
    enforcesHardRules: ['HARD_RULE_1_CANONICAL_DATA_SOURCE'],
  },

  // --------------------------------------------------------------------------
  // LAYER 6: SIMULATION, PERSISTENCE & AUDIT
  // --------------------------------------------------------------------------
  BACKTEST_REPLAY_ENGINE: {
    id: 'BACKTEST_REPLAY_ENGINE',
    name: 'Deterministic Backtest Replay Engine',
    layer: 'SIMULATION_PERSISTENCE_AUDIT',
    description:
      'Replays historical Deriv candle sequences bar-by-bar across the 1H/15M/5M hierarchy with absolute zero lookahead bias.',
    dependencies: [
      'STRUCTURAL_TIMEFRAME_HIERARCHY',
      'CANONICAL_CONTRACT_VALIDATOR',
    ],
    enforcesHardRules: [
      'HARD_RULE_1_CANONICAL_DATA_SOURCE',
      'HARD_RULE_2_NO_SYNTHETIC_DATA',
      'HARD_RULE_3_FIXED_TIMEFRAME_HIERARCHY',
    ],
  },

  SHADOW_EXECUTION_HARNESS: {
    id: 'SHADOW_EXECUTION_HARNESS',
    name: 'Shadow Execution Harness',
    layer: 'SIMULATION_PERSISTENCE_AUDIT',
    description:
      'Simulates live execution against real-time Deriv tick bid/ask spreads without risking capital, verifying execution realism.',
    dependencies: [
      'CANONICAL_CONTRACT_VALIDATOR',
      'ORDER_LIFECYCLE_MANAGER',
    ],
    enforcesHardRules: [
      'HARD_RULE_1_CANONICAL_DATA_SOURCE',
      'HARD_RULE_2_NO_SYNTHETIC_DATA',
    ],
  },

  STATE_PERSISTENCE_LEDGER: {
    id: 'STATE_PERSISTENCE_LEDGER',
    name: 'State Persistence Ledger',
    layer: 'SIMULATION_PERSISTENCE_AUDIT',
    description:
      'Maintains an append-only immutable journal recording every state transition, analysis result, and trade lifecycle event.',
    dependencies: [],
    enforcesHardRules: [],
  },

  AUDIT_TELEMETRY_WATCHDOG: {
    id: 'AUDIT_TELEMETRY_WATCHDOG',
    name: 'Audit & Telemetry Watchdog',
    layer: 'SIMULATION_PERSISTENCE_AUDIT',
    description:
      'Continuously audits feed latency, clock drift, Deriv rate limits, and triggers immediate alarms on contract invariant breaches.',
    dependencies: [
      'CANONICAL_CONTRACT_VALIDATOR',
      'STATE_PERSISTENCE_LEDGER',
    ],
    enforcesHardRules: [
      'HARD_RULE_1_CANONICAL_DATA_SOURCE',
      'HARD_RULE_2_NO_SYNTHETIC_DATA',
      'HARD_RULE_3_FIXED_TIMEFRAME_HIERARCHY',
      'HARD_RULE_4_EXECUTION_TIMEFRAME_ISOLATION',
    ],
  },

  SMC_KNOWLEDGE_CORE_ENGINE: {
    id: 'SMC_KNOWLEDGE_CORE_ENGINE',
    name: 'SMC Knowledge Core & Rule Firing Registry',
    layer: 'SIMULATION_PERSISTENCE_AUDIT',
    description:
      'Structured, machine-readable rule audit trail recording exact mathematical triggers, evidence, and non-contradiction proofs for institutional AI auditing.',
    dependencies: [
      'SMC_MULTI_TIMEFRAME_ENGINE',
    ],
    enforcesHardRules: [
      'HARD_RULE_1_CANONICAL_DATA_SOURCE',
      'HARD_RULE_2_NO_SYNTHETIC_DATA',
      'HARD_RULE_3_FIXED_TIMEFRAME_HIERARCHY',
      'HARD_RULE_4_EXECUTION_TIMEFRAME_ISOLATION',
    ],
  },

  // --------------------------------------------------------------------------
  // LAYER 7: PRODUCT ACCESS AND MONETIZATION (MODULES 34-44)
  // --------------------------------------------------------------------------
  IDENTITY_SESSION_SERVICE: {
    id: 'IDENTITY_SESSION_SERVICE',
    moduleIdNumber: 34,
    name: 'Identity & Session Service',
    layer: 'PRODUCT_ACCESS_AND_MONETIZATION',
    engineStatus: 'BUILT',
    description:
      'Manages user authentication, credentials, session tokens, device fingerprinting, and security lifecycle.',
    dependencies: [],
    enforcesHardRules: [],
  },

  BILLING_SUBSCRIPTION_SERVICE: {
    id: 'BILLING_SUBSCRIPTION_SERVICE',
    moduleIdNumber: 35,
    name: 'Billing & Subscription Service',
    layer: 'PRODUCT_ACCESS_AND_MONETIZATION',
    engineStatus: 'NOT_BUILT',
    description:
      'Governs subscription tiers (Free, Trader, Institutional), recurring billing, payment gateway sync, and plan lifecycles.',
    dependencies: ['IDENTITY_SESSION_SERVICE'],
    enforcesHardRules: [],
  },

  ACCESS_PROFILE_ENGINE: {
    id: 'ACCESS_PROFILE_ENGINE',
    moduleIdNumber: 36,
    name: 'Access Profile Engine',
    layer: 'PRODUCT_ACCESS_AND_MONETIZATION',
    engineStatus: 'NOT_BUILT',
    description:
      'Evaluates user entitlements, instrument access quotas, asset class limits, and feature authorizations.',
    dependencies: ['IDENTITY_SESSION_SERVICE', 'BILLING_SUBSCRIPTION_SERVICE'],
    enforcesHardRules: [],
  },

  STYLE_PROFILE_CLASSIFIER: {
    id: 'STYLE_PROFILE_CLASSIFIER',
    moduleIdNumber: 37,
    name: 'Style Profile Classifier',
    layer: 'PRODUCT_ACCESS_AND_MONETIZATION',
    engineStatus: 'NOT_BUILT',
    description:
      'Classifies trader profiles and execution styles to tailor analytical outputs and risk parameters.',
    dependencies: ['IDENTITY_SESSION_SERVICE'],
    enforcesHardRules: [],
  },

  ACCESS_GATEWAY_AND_ENGINE_PROTECTION: {
    id: 'ACCESS_GATEWAY_AND_ENGINE_PROTECTION',
    moduleIdNumber: 38,
    name: 'Access Gateway & Engine Protection',
    layer: 'PRODUCT_ACCESS_AND_MONETIZATION',
    engineStatus: 'BUILT',
    description:
      'Enforces reverse-proxy rate limiting, token verification, and fail-closed security shielding for core SMC calculation engines.',
    dependencies: ['ACCESS_PROFILE_ENGINE'],
    enforcesHardRules: ['HARD_RULE_1_CANONICAL_DATA_SOURCE'],
  },

  MT5_LINK_SERVICE: {
    id: 'MT5_LINK_SERVICE',
    moduleIdNumber: 39,
    name: 'MT5 Link Service',
    layer: 'PRODUCT_ACCESS_AND_MONETIZATION',
    engineStatus: 'NOT_BUILT',
    description:
      'Bridges trading accounts, credentials, and signal routing to MetaTrader 5 execution terminals and brokers.',
    dependencies: ['IDENTITY_SESSION_SERVICE', 'ACCESS_PROFILE_ENGINE'],
    enforcesHardRules: [],
  },

  ADMIN_CONTROL_CONSOLE: {
    id: 'ADMIN_CONTROL_CONSOLE',
    moduleIdNumber: 40,
    name: 'Admin Control Console',
    layer: 'PRODUCT_ACCESS_AND_MONETIZATION',
    engineStatus: 'NOT_BUILT',
    description:
      'Administrative operations portal for tenant management, subscriber overrides, system health monitoring, and tier provisioning.',
    dependencies: ['IDENTITY_SESSION_SERVICE', 'ACCESS_PROFILE_ENGINE'],
    enforcesHardRules: [],
  },

  SUBSCRIBER_APP_SHELL: {
    id: 'SUBSCRIBER_APP_SHELL',
    moduleIdNumber: 41,
    name: 'Subscriber App Shell',
    layer: 'PRODUCT_ACCESS_AND_MONETIZATION',
    engineStatus: 'NOT_BUILT',
    description:
      'Subscriber-facing web application container, personalized workspace state, and responsive layout coordination.',
    dependencies: ['IDENTITY_SESSION_SERVICE', 'ACCESS_PROFILE_ENGINE'],
    enforcesHardRules: [],
  },

  NOTIFICATION_SERVICE: {
    id: 'NOTIFICATION_SERVICE',
    moduleIdNumber: 42,
    name: 'Notification Service',
    layer: 'PRODUCT_ACCESS_AND_MONETIZATION',
    engineStatus: 'NOT_BUILT',
    description:
      'Delivers multi-channel alerts (SSE, webhook, push, email) for institutional liquidity sweeps, POI triggers, and subscription notices.',
    dependencies: ['IDENTITY_SESSION_SERVICE'],
    enforcesHardRules: [],
  },

  AUDIT_SECURITY_LEDGER: {
    id: 'AUDIT_SECURITY_LEDGER',
    moduleIdNumber: 43,
    name: 'Audit & Security Ledger',
    layer: 'PRODUCT_ACCESS_AND_MONETIZATION',
    engineStatus: 'NOT_BUILT',
    description:
      'Immutable append-only audit trail logging security events, access grants, billing transitions, and administrative actions.',
    dependencies: ['IDENTITY_SESSION_SERVICE', 'ACCESS_PROFILE_ENGINE'],
    enforcesHardRules: [],
  },

  MONETIZATION_ANALYTICS: {
    id: 'MONETIZATION_ANALYTICS',
    moduleIdNumber: 44,
    name: 'Monetization Analytics',
    layer: 'PRODUCT_ACCESS_AND_MONETIZATION',
    engineStatus: 'NOT_BUILT',
    description:
      'Tracks conversion funnels, subscription retention, churn metrics, and revenue analytics for platform operations.',
    dependencies: ['BILLING_SUBSCRIPTION_SERVICE', 'AUDIT_SECURITY_LEDGER'],
    enforcesHardRules: [],
  },
};

/**
 * Array of all module descriptors for iteration and registry display.
 */
export const SYSTEM_MODULES_LIST: readonly EngineModuleDescriptor[] =
  Object.values(SYSTEM_ARCHITECTURE_REGISTRY);

/**
 * Helper to fetch a module descriptor by ID.
 */
export function getEngineModuleDescriptor(
  id: EngineModuleId,
): EngineModuleDescriptor {
  const descriptor = SYSTEM_ARCHITECTURE_REGISTRY[id];
  if (!descriptor) {
    throw new Error(
      `UNREGISTERED MODULE: "${id}" is not in the System Architecture Registry.`,
    );
  }
  return descriptor;
}
