/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SMC (Smart Money Concepts) Foundational Type System & Invariants
 *
 * SYSTEM INVARIANTS & HARD ARCHITECTURAL RULES:
 * 1. DERIV is the SOLE authorized canonical broker and data source permitted in this OS.
 *    DELIBERATE HARD-RULE DECISION: OANDA v20 is completely retired (not kept as an inactive option).
 *    Any foreign, mock, or synthetic broker identifier is invalid and structurally prohibited.
 * 2. No random or synthetic data is ever permitted in production code paths.
 *    All candles, ticks, and liquidity sweeps must be verifiable against DERIV pricing.
 * 3. The structural timeframe hierarchy is strictly fixed: 1H (HTF) -> 15M (MTF) -> 5M (LTF).
 * 4. 1M (Execution Timeframe) data must NEVER be merged into higher-timeframe structural
 *    calculations (Swings, BOS/CHoCH, Liquidity Levels, Order Blocks, FVGs, Dealing Ranges).
 *    1M is strictly reserved for sub-minute execution timing, slippage inspection, and tick mitigation.
 */

// ============================================================================
// 1. DATA SOURCE & BROKER CONTRACTS
// ============================================================================

/**
 * Strict singleton canonical broker ID.
 *
 * DELIBERATE HARD-RULE DECISION:
 * DERIV is the sole authorized canonical market-data source for this system,
 * specifically to eliminate any risk of cross-source data mismatch or miscalculation.
 * OANDA_V20 has been completely retired (not kept as an inactive option).
 *
 * BrokerId is a single literal type ('DERIV'), making it structurally impossible
 * for any other source to be selected by design, not just by default.
 */
export type BrokerId = 'DERIV';
export const CANONICAL_BROKER_ID: BrokerId = 'DERIV';

/**
 * Data feed health & connection lifecycle status.
 */
export type FeedStatus =
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'HEALTHY_STREAMING'
  | 'DEGRADED_LATENCY'
  | 'RATE_LIMITED'
  | 'ERROR';

/**
 * Runtime execution environment.
 * - BACKTEST: Deterministic bar-by-bar historical replay.
 * - SHADOW: Live market real-time tick mirror without placing live capital.
 * - LIVE: Live capital execution via Deriv sub-account.
 */
export type TradingEnvironment = 'BACKTEST' | 'SHADOW' | 'LIVE';

/**
 * Execution approval gate mode.
 * - FULLY_AUTONOMOUS: OS executes approved setups without human intervention.
 * - SEMI_AUTONOMOUS_CONFIRMATION: OS queues setup and awaits 1-click trader approval.
 * - MANUAL_APPROVAL_ONLY: All orders require manual biometric/signature approval.
 * - READ_ONLY_OBSERVATION: OS analyzes & signals, zero execution authority.
 */
export type ExecutionApprovalMode =
  | 'FULLY_AUTONOMOUS'
  | 'SEMI_AUTONOMOUS_CONFIRMATION'
  | 'MANUAL_APPROVAL_ONLY'
  | 'READ_ONLY_OBSERVATION';

// ============================================================================
// 2. TIMEFRAMES & STRUCTURAL ISOLATION GUARDS
// ============================================================================

/**
 * The 4 canonical system timeframes.
 */
export type Timeframe = '1H' | '15M' | '5M' | '1M';

/**
 * Compile-time guard: Structural timeframes exclude 1M.
 * 1M data MUST NEVER be ingested into structural calculations (Swings, BOS, OBs, FVGs).
 */
export type StructuralTimeframe = '1H' | '15M' | '5M';

/**
 * Execution timeframe reserved strictly for entry micro-triggers.
 */
export type ExecutionTimeframe = '1M';

/**
 * Structural hierarchy rank.
 * Higher number = higher precedence.
 * 1H (3) > 15M (2) > 5M (1). 1M is 0 (non-structural).
 */
export const TIMEFRAME_HIERARCHY_LEVEL: Record<Timeframe, number> = {
  '1H': 3, // High Timeframe (HTF): Bias, Major Dealing Range, Key Swings
  '15M': 2, // Medium Timeframe (MTF): Internal Structure, Minor BOS, Key OB/FVGs
  '5M': 1, // Low Timeframe (LTF): Micro CHoCH, Sweeps, Entry Confluence
  '1M': 0, // Execution Only: Micro-timing, NO structural state modification
} as const;

// ============================================================================
// 3. APPROVED INSTRUMENT SYMBOLS & ASSET CLASSES
// ============================================================================

/**
 * Master classification of tradeable asset categories.
 */
export type AssetClass =
  | 'FOREX_MAJOR'
  | 'FOREX_MINOR'
  | 'INDEX'
  | 'COMMODITY_METAL'
  | 'CRYPTOCURRENCY';

/**
 * The canonical approved instrument symbols matching Deriv's real 43-symbol catalog
 * (25 forex, 4 metals, 12 indices, 2 crypto) plus standard aliases.
 * Format adheres to canonical instrument naming convention (BASE_QUOTE).
 */
export type InstrumentSymbol =
  // 7 Forex Majors
  | 'EUR_USD'
  | 'GBP_USD'
  | 'USD_JPY'
  | 'USD_CHF'
  | 'AUD_USD'
  | 'USD_CAD'
  | 'NZD_USD'
  // 18 Forex Minors & Crosses (Total 25 Forex from Deriv catalog)
  | 'EUR_GBP'
  | 'EUR_JPY'
  | 'GBP_JPY'
  | 'AUD_JPY'
  | 'EUR_AUD'
  | 'GBP_AUD'
  | 'EUR_CAD'
  | 'GBP_CAD'
  | 'NZD_JPY'
  | 'AUD_CAD'
  | 'AUD_CHF'
  | 'AUD_NZD'
  | 'EUR_CHF'
  | 'EUR_NZD'
  | 'GBP_CHF'
  | 'GBP_NZD'
  | 'USD_MXN'
  | 'USD_PLN'
  // 4 Precious Metals (Commodities)
  | 'XAU_USD'
  | 'XAG_USD'
  | 'XPT_USD'
  | 'XPD_USD'
  // 12 Real Deriv Equity Indices
  | 'OTC_DJI'
  | 'OTC_SPC'
  | 'OTC_NDX'
  | 'OTC_FTSE'
  | 'OTC_GDAXI'
  | 'OTC_FCHI'
  | 'OTC_SX5E'
  | 'OTC_N225'
  | 'OTC_AS51'
  | 'OTC_HSI'
  | 'OTC_AEX'
  | 'OTC_SSMI'
  // 2 Cryptocurrencies
  | 'BTC_USD'
  | 'ETH_USD';

// ============================================================================
// 4. CANDLE & TICK CORE MODELS
// ============================================================================

/**
 * Canonical Candle Contract.
 * Rejects missing OHLC, NaN, inverted High < Low, or non-DERIV source.
 */
export interface Candle {
  readonly symbol: InstrumentSymbol;
  readonly timeframe: Timeframe;
  readonly timestamp: number; // Unix epoch in milliseconds
  readonly isoTimestamp: string; // ISO 8601 UTC representation
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
  readonly isComplete: boolean;
  readonly source: BrokerId; // Must strictly equal "DERIV"
  readonly spreadPips?: number;
}

/**
 * Structural Candle Contract.
 * Strict compile-time constraint ensuring 1M candles cannot be passed into
 * structural algorithms.
 */
export interface StructuralCandle extends Candle {
  readonly timeframe: StructuralTimeframe;
}

// ============================================================================
// 5. SMC STRUCTURAL & PRICE ACTION TYPES
// ============================================================================

/**
 * Directional directional bias evaluated per timeframe.
 */
export type DirectionalBias = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

/**
 * Wyckoff / Institutional Market Regime classification.
 */
export type MarketRegimeType =
  | 'TRENDING_EXPANSION'
  | 'CONSOLIDATION_RANGE'
  | 'ACCUMULATION'
  | 'DISTRIBUTION'
  | 'VOLATILE_EXPANSION';

/**
 * Swing point fractal classification.
 */
export type SwingPointType = 'SWING_HIGH' | 'SWING_LOW';

/**
 * Strength rating of a structural swing pivot.
 * - STRONG: Swing that generated a structural break or swept liquidity.
 * - WEAK: Unprotected swing pivot liable to be targeted.
 * - INTERMEDIATE: Internal sub-swing within a parent dealing range.
 */
export type SwingStrength = 'STRONG' | 'WEAK' | 'INTERMEDIATE';

/**
 * Validated structural swing point.
 * NOTE: 1M timeframes are compile-time forbidden for swing structure!
 */
export interface SwingPoint {
  readonly id: string;
  readonly symbol: InstrumentSymbol;
  readonly timeframe: StructuralTimeframe;
  readonly type: SwingPointType;
  readonly price: number;
  readonly timestamp: number;
  readonly candleIndex: number;
  readonly strength: SwingStrength;
  readonly isBroken: boolean;
  readonly brokenAtTimestamp?: number;
}

/**
 * Market structure break event.
 * - BOS (Break of Structure): Trend continuation break of a strong swing.
 * - CHOCH (Change of Character): First structural break signaling potential trend reversal.
 */
export type StructureBreakType = 'BOS' | 'CHOCH';

export interface StructureBreak {
  readonly id: string;
  readonly symbol: InstrumentSymbol;
  readonly timeframe: StructuralTimeframe;
  readonly type: StructureBreakType;
  readonly direction: 'BULLISH' | 'BEARISH';
  readonly breakPrice: number;
  readonly brokenSwingPointId: string;
  readonly triggerCandleTimestamp: number;
  readonly isConfirmedByCandleClose: boolean; // SMC requires candle body close, not just wick
}

// ============================================================================
// 6. LIQUIDITY POOLS & SWEEP EVENTS
// ============================================================================

/**
 * Types of institutional liquidity pools.
 * - BSL: Buy-Side Liquidity (resting buy stops above swing highs).
 * - SSL: Sell-Side Liquidity (resting sell stops below swing lows).
 * - EQH: Equal Highs (double/triple tops - concentrated stop clusters).
 * - EQL: Equal Lows (double/triple bottoms - concentrated stop clusters).
 * - SESSION_HIGH / SESSION_LOW: Asian / London / New York extremes.
 * - PREVIOUS_DAY_HIGH / PREVIOUS_DAY_LOW: Daily session reference points.
 */
export type LiquidityLevelType =
  | 'BSL'
  | 'SSL'
  | 'EQH'
  | 'EQL'
  | 'SESSION_HIGH'
  | 'SESSION_LOW'
  | 'PREVIOUS_DAY_HIGH'
  | 'PREVIOUS_DAY_LOW';

export interface LiquidityLevel {
  readonly id: string;
  readonly symbol: InstrumentSymbol;
  readonly timeframe: StructuralTimeframe;
  readonly type: LiquidityLevelType;
  readonly price: number;
  readonly originTimestamp: number;
  readonly isSwept: boolean;
  readonly sweepTimestamp?: number;
  readonly touchCount: number;
}

/**
 * Liquidity sweep classification.
 * - CONFIRMED_TURTLE_SOUP: Wick swept beyond level and closed back inside range.
 * - WICK_REJECTION: Sharp rejection tail leaving imbalance.
 * - CONTINUATION_BREAK: Breakout candle closed beyond level (liquidity absorbed into trend).
 */
export type LiquiditySweepStatus =
  | 'CONFIRMED_TURTLE_SOUP'
  | 'WICK_REJECTION'
  | 'CONTINUATION_BREAK';

export interface LiquiditySweepEvent {
  readonly id: string;
  readonly symbol: InstrumentSymbol;
  readonly timeframe: Timeframe;
  readonly liquidityLevelId: string;
  readonly levelType: LiquidityLevelType;
  readonly sweepHighPrice: number;
  readonly sweepLowPrice: number;
  readonly rejectionClosePrice: number;
  readonly rejectionWickRatio: number; // Ratio of wick to total candle range (e.g. > 0.60)
  readonly timestamp: number;
  readonly status: LiquiditySweepStatus;
}

// ============================================================================
// 7. ORDER BLOCKS (OB) & FAIR VALUE GAPS (FVG)
// ============================================================================

export type OrderBlockType = 'BULLISH_OB' | 'BEARISH_OB';

export interface OrderBlockZone {
  readonly id: string;
  readonly symbol: InstrumentSymbol;
  readonly timeframe: StructuralTimeframe;
  readonly type: OrderBlockType;
  readonly highPrice: number;
  readonly lowPrice: number;
  readonly meanThresholdPrice: number; // 50% midpoint / Consequent Encroachment (CE)
  readonly originCandleTimestamp: number;
  readonly isMitigated: boolean;
  readonly mitigationTimestamp?: number;
  readonly mitigationPercentage: number; // 0% (fresh) to 100% (fully mitigated)
  readonly qualityScore: number; // 0 to 100 based on volume, displacement & imbalance
}

/**
 * Three-candle imbalance:
 * - BISI: Buyside Imbalance Sellside Inefficiency (Bullish FVG).
 * - SIBI: Sellside Imbalance Buyside Inefficiency (Bearish FVG).
 */
export type FairValueGapType = 'BISI' | 'SIBI';

export interface FairValueGapZone {
  readonly id: string;
  readonly symbol: InstrumentSymbol;
  readonly timeframe: StructuralTimeframe;
  readonly type: FairValueGapType;
  readonly topPrice: number;
  readonly bottomPrice: number;
  readonly consequentEncroachmentPrice: number; // 50% midpoint of gap
  readonly candle1Timestamp: number;
  readonly candle2Timestamp: number;
  readonly candle3Timestamp: number;
  readonly isMitigated: boolean;
  readonly mitigationRatio: number;
  readonly isInversionFVG: boolean; // FVG breached and now acting as opposing polarity
}

// ============================================================================
// 8. PREMIUM / DISCOUNT MATRIX
// ============================================================================

export type ValuationZone =
  | 'DEEP_DISCOUNT' // < 25% of dealing range
  | 'DISCOUNT' // 25% - 50% of dealing range (Ideal for Longs)
  | 'EQUILIBRIUM' // ~50% midpoint
  | 'PREMIUM' // 50% - 75% of dealing range (Ideal for Shorts)
  | 'DEEP_PREMIUM'; // > 75% of dealing range

export interface PremiumDiscountZone {
  readonly symbol: InstrumentSymbol;
  readonly timeframe: StructuralTimeframe;
  readonly rangeHigh: number;
  readonly rangeLow: number;
  readonly equilibriumPrice: number; // Exactly (rangeHigh + rangeLow) / 2
  readonly premiumThreshold: number;
  readonly discountThreshold: number;
  readonly optimalTradeEntryUpper: number; // 79% Fibonacci retracement level
  readonly optimalTradeEntryLower: number; // 61.8% Fibonacci retracement level
  readonly currentZone: ValuationZone;
}

// ============================================================================
// 9. COMPOSITE SMC ANALYSIS & TRADE SETUP CANDIDATES
// ============================================================================

export type KillzoneSession =
  | 'ASIAN'
  | 'LONDON_OPEN'
  | 'NEW_YORK_AM'
  | 'NEW_YORK_PM'
  | 'OFF_HOURS';

/**
 * Full multi-timeframe SMC market snapshot.
 */
export interface SMCAnalysisResult {
  readonly symbol: InstrumentSymbol;
  readonly analyzedAt: number;
  readonly higherTimeframe1H: {
    readonly bias: DirectionalBias;
    readonly regime: MarketRegimeType;
    readonly swingPoints: readonly SwingPoint[];
    readonly structureBreaks: readonly StructureBreak[];
    readonly orderBlocks: readonly OrderBlockZone[];
    readonly fairValueGaps: readonly FairValueGapZone[];
    readonly premiumDiscount: PremiumDiscountZone;
  };
  readonly intermediateTimeframe15M: {
    readonly bias: DirectionalBias;
    readonly regime: MarketRegimeType;
    readonly swingPoints: readonly SwingPoint[];
    readonly structureBreaks: readonly StructureBreak[];
    readonly orderBlocks: readonly OrderBlockZone[];
    readonly fairValueGaps: readonly FairValueGapZone[];
    readonly liquidityLevels: readonly LiquidityLevel[];
  };
  readonly lowerTimeframe5M: {
    readonly bias: DirectionalBias;
    readonly swingPoints: readonly SwingPoint[];
    readonly structureBreaks: readonly StructureBreak[];
    readonly liquiditySweeps: readonly LiquiditySweepEvent[];
    readonly activeOrderBlocks: readonly OrderBlockZone[];
    readonly activeFVGs: readonly FairValueGapZone[];
  };
  readonly executionContext1M: {
    readonly lastClose: number;
    readonly tickSpread: number;
    readonly immediateMomentum: DirectionalBias;
    readonly note: string; // "Restricted from structural state calculations"
  };
  readonly confluenceScore: number; // 0 - 100
  readonly overallBias: DirectionalBias;
  readonly activeKillzone: KillzoneSession;
}

/**
 * Institutional SMC Trade Setup model.
 */
export type SetupModelType =
  | 'OB_RETEST_AFTER_SWEEP'
  | 'FVG_CE_ENTRY'
  | 'CHOCH_TURTLE_SOUP_REVERSAL'
  | 'CONTINUATION_EXPANSION';

export type SetupLifecycleStatus =
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'TRIGGERED'
  | 'EXPIRED'
  | 'FILLED'
  | 'INVALIDATED';

export interface SMCTradeSetup {
  readonly id: string;
  readonly symbol: InstrumentSymbol;
  readonly direction: 'LONG' | 'SHORT';
  readonly setupType: SetupModelType;
  readonly entryPrice: number;
  readonly stopLossPrice: number;
  readonly takeProfit1Price: number; // Usually opposing liquidity pool
  readonly takeProfit2Price: number; // Extended target / HTF liquidity
  readonly takeProfitFinalPrice: number;
  readonly riskRewardRatio: number; // Must exceed minimum threshold (e.g. >= 2.5)
  readonly riskPercentage: number;
  readonly estimatedUnits: number;
  readonly confluenceScore: number;
  readonly confluenceFactors: readonly string[];
  readonly status: SetupLifecycleStatus;
  readonly createdAtTimestamp: number;
  readonly expiryTimestamp: number;
}

// ============================================================================
// 10. RISK MANAGEMENT SETTINGS CONTRACT
// ============================================================================

export interface RiskManagementSettings {
  readonly maxRiskPerTradePercent: number; // e.g. 1.0% per trade
  readonly maxDailyLossPercent: number; // e.g. 3.0% circuit-breaker
  readonly maxTrailingDrawdownPercent: number; // e.g. 6.0% global max drawdown
  readonly maxOpenTradesTotal: number; // Maximum concurrent open positions
  readonly maxCorrelatedExposurePercent: number; // Max exposure on same currency/basket
  readonly minRiskRewardRatio: number; // Strict minimum (e.g. 2.5R)
  readonly requireKillzoneForEntry: boolean; // Enforce trades only during London/NY killzones
  readonly enableTrailingBreakEven: boolean; // Shift SL to BE at target multiple
  readonly breakEvenTriggerRMultiple: number; // e.g. 1.0R
  readonly partialTakeProfitRMultiple: number; // e.g. 2.0R
  readonly partialTakeProfitPercentage: number; // e.g. 50% off at TP1
}

// ============================================================================
// 11. DERIV ACTIVE SYMBOL INTERFACE
// ============================================================================

export interface DerivActiveSymbol {
  readonly symbol: string; // e.g. "frxEURUSD"
  readonly display_name: string; // e.g. "EUR/USD"
  readonly market: string; // e.g. "forex"
  readonly submarket: string; // e.g. "major_pairs"
  readonly symbol_type: string;
  readonly is_trading_suspended?: 0 | 1;
  readonly pip?: number;
  readonly underlying_symbol?: string;
  readonly underlying_symbol_name?: string;
  readonly subgroup?: string;
  readonly exchange_is_open?: 0 | 1;
}

export type DerivConnectionState =
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'RECONNECTING'
  | 'ERROR';

export interface DerivHealthMetrics {
  readonly status: FeedStatus;
  readonly connectionState: DerivConnectionState;
  readonly uptimeMs: number;
  readonly connectedSince: number | null;
  readonly lastPongLatencyMs: number | null;
  readonly averageLatencyMs: number | null;
  readonly messagesReceivedTotal: number;
  readonly reconnectCount: number;
  readonly lastError: string | null;
}

export type SafetyBlockReasonCode =
  | 'NO_ACTIVE_DATA_SOURCE'
  | 'FEED_DISCONNECTED'
  | 'FEED_ERROR'
  | 'FEED_RATE_LIMITED'
  | 'DEGRADED_LATENCY'
  | 'CANDLE_INTEGRITY_BREACH'
  | 'CROSS_TIMEFRAME_DESYNC'
  | 'UNEXPECTED_DATA_GAP'
  | 'BACKFILL_IN_PROGRESS'
  | 'UNAPPROVED_INSTRUMENT'
  | 'STALE_DATA';

export interface ActiveSafetyBlock {
  readonly id: string;
  readonly symbol: InstrumentSymbol | 'GLOBAL';
  readonly timeframe?: Timeframe | 'ALL';
  readonly code: SafetyBlockReasonCode;
  readonly severity: 'BLOCKING' | 'WARNING';
  readonly title: string;
  readonly explanation: string;
  readonly blockedSince: number;
  readonly resolutionAction: string;
}

export type IngestionPath =
  | 'REST_HISTORICAL'
  | 'LIVE_STREAM'
  | 'BACKFILL_RECOVERY';

export interface CandleLineageRecord {
  readonly id: string;
  readonly candleKey: string;
  readonly symbol: InstrumentSymbol;
  readonly timeframe: Timeframe;
  readonly candleTimestamp: number;
  readonly source: BrokerId;
  readonly ingestionPath: IngestionPath;
  readonly fetchedAt: number;
  readonly latencyMs?: number;
  readonly checksum: string;
  readonly validationPassed: boolean;
}

export interface LineageAuditSummary {
  readonly totalLogged: number;
  readonly restHistoricalCount: number;
  readonly liveStreamCount: number;
  readonly backfillRecoveryCount: number;
  readonly derivProvenanceRate: number;
  readonly oldestLoggedTimestamp: number | null;
  readonly newestLoggedTimestamp: number | null;
}

export interface VerifiedDerivInstrument {
  readonly canonicalSymbol: InstrumentSymbol;
  readonly derivSymbol: string;
  readonly displayName: string;
  readonly market: string;
  readonly pip: number;
  readonly isTradingSuspended: boolean;
}

export interface UnofferedDerivInstrument {
  readonly canonicalSymbol: InstrumentSymbol;
  readonly expectedDerivSymbol: string;
  readonly reason: string;
}

export interface SymbolVerificationReport {
  readonly totalApproved: number;
  readonly offeredCount: number;
  readonly unofferedCount: number;
  readonly offered: readonly VerifiedDerivInstrument[];
  readonly unoffered: readonly UnofferedDerivInstrument[];
  readonly verifiedAt: number;
}

export interface DerivBackfillJobResult {
  readonly symbol: InstrumentSymbol;
  readonly timeframe: Timeframe;
  readonly gapDetected: boolean;
  readonly missingCandlesEstimated: number;
  readonly candlesRecovered: number;
  readonly durationMs: number;
  readonly error?: string;
}

export type CatalogMarketCategory =
  | 'forex'
  | 'commodities'
  | 'indices'
  | 'cryptocurrency';

export interface CatalogTradingTimesInfo {
  readonly openTimes: readonly string[];
  readonly closeTimes: readonly string[];
  readonly settlementTime?: string;
  readonly tradingDays: readonly string[];
  readonly events: ReadonlyArray<{ dates: string; descrip: string }>;
}

export interface CatalogInstrumentItem {
  readonly underlyingSymbol: string;
  readonly displayName: string;
  readonly category: CatalogMarketCategory;
  readonly submarket: string;
  readonly pipSize: number;
  readonly exchangeIsOpen: boolean;
  readonly isTradingSuspended: boolean;
  readonly tradingTimes: CatalogTradingTimesInfo | null;
  readonly isMarketOpenNow: boolean;
  readonly statusDescription: string;
}

export interface WatchlistEntry {
  readonly symbol: string;
  readonly canonicalSymbol: string;
  readonly derivSymbol: string;
  readonly displayName: string;
  readonly category: string;
  readonly subscriptionId: string | null;
  readonly status: 'INITIALIZING' | 'ACTIVE' | 'ERROR';
  readonly addedAt: number;
  readonly lastBackfillAt?: number;
  readonly isStreaming: boolean;
}
