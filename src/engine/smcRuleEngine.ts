/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SMC Master Rule Engine
 *
 * Top-Level Entry Point: performSMCAnalysis(...)
 *
 * Unifies Phases 0, 1, 2, and 3 into the Canonical SMCAnalysisResult:
 * - Phase 1: getCandles() + Candle Integrity Sync Audit (fail-closed gate).
 * - Phase 2: Swing Points, BOS/CHoCH, Dealing Range, Premium/Discount.
 * - Phase 3: Liquidity Pools, Displacement Order Blocks, FVGs, POI Intelligence.
 * - Multi-Timeframe Orchestrator: 1H (HTF) -> 15M (MTF) -> 5M (LTF).
 *
 * HARD RULE 4 ENFORCEMENT:
 * 1M data is strictly isolated. It is only ingested into executionContext1M for micro-timing
 * annotations (lastClose, tickSpread, immediateMomentum, note). It is strictly forbidden from
 * participating in bias, location, POI, or trigger evaluations.
 */

import {
  Candle,
  DirectionalBias,
  FairValueGapZone,
  InstrumentSymbol,
  KillzoneSession,
  LiquidityLevel,
  LiquiditySweepEvent,
  OrderBlockZone,
  PremiumDiscountZone,
  SMCAnalysisResult,
  StructureBreak,
  SwingPoint,
} from '../types/smc';
import { assertStructuralTimeframe } from './canonicalDataContracts';
import { SmcKnowledgeCoreEngine } from './smcKnowledgeCoreEngine';
import {
  MultiTimeframeOrchestrationResult,
  SmcMultiTimeframeEngine,
} from './smcMultiTimeframeEngine';

/**
 * Calculates current killzone session from unix timestamp (UTC).
 */
export function determineKillzoneSession(timestampMs: number): KillzoneSession {
  const date = new Date(timestampMs);
  const utcHour = date.getUTCHours();
  const utcMinute = date.getUTCMinutes();
  const timeDecimal = utcHour + utcMinute / 60;

  // Asian Killzone: 00:00 - 06:00 UTC
  if (timeDecimal >= 0 && timeDecimal < 6) {
    return 'ASIAN';
  }
  // London Open Killzone: 07:00 - 10:30 UTC
  if (timeDecimal >= 7 && timeDecimal < 10.5) {
    return 'LONDON_OPEN';
  }
  // New York AM Killzone: 12:00 - 15:30 UTC
  if (timeDecimal >= 12 && timeDecimal < 15.5) {
    return 'NEW_YORK_AM';
  }
  // New York PM Killzone: 16:00 - 19:00 UTC
  if (timeDecimal >= 16 && timeDecimal < 19) {
    return 'NEW_YORK_PM';
  }
  return 'OFF_HOURS';
}

/**
 * Computes micro-level immediate momentum for 1M candle annotations.
 * Hard Rule 4: strictly isolated to executionContext1M annotations.
 */
function extract1mMicroContext(
  candles1m?: readonly Candle[],
  fallbackPrice: number = 0,
): {
  lastClose: number;
  tickSpread: number;
  immediateMomentum: DirectionalBias;
  note: string;
} {
  const note = 'Restricted from structural state calculations (Hard Rule 4)';

  if (!candles1m || candles1m.length === 0) {
    return {
      lastClose: fallbackPrice,
      tickSpread: 0.8,
      immediateMomentum: 'NEUTRAL',
      note,
    };
  }

  const latest1m = candles1m[candles1m.length - 1];
  const lastClose = latest1m.close;
  const tickSpread = latest1m.spreadPips ?? 0.8;

  // Micro momentum based solely on last 3 1M bars
  const recentBars = candles1m.slice(-3);
  let immediateMomentum: DirectionalBias = 'NEUTRAL';
  if (recentBars.length >= 2) {
    const first = recentBars[0];
    const last = recentBars[recentBars.length - 1];
    if (last.close > first.open) {
      immediateMomentum = 'BULLISH';
    } else if (last.close < first.open) {
      immediateMomentum = 'BEARISH';
    }
  }

  return {
    lastClose,
    tickSpread,
    immediateMomentum,
    note,
  };
}

/**
 * Calculates institutional confluence score (0 - 100).
 */
function calculateConfluenceScore(
  orchestration: MultiTimeframeOrchestrationResult,
  killzone: KillzoneSession,
): number {
  const { htf1h, mtf15m, ltf5m, candleIntegrity, status } = orchestration;

  // Fail closed conditions
  if (status === 'FAIL_CLOSED_INTEGRITY' || candleIntegrity.syncScore < 70) {
    return 0;
  }
  if (ltf5m.contradictsHtfBias) {
    return 0;
  }
  if (htf1h.directionalBias === 'NEUTRAL') {
    return 10;
  }

  let score = 0;

  // 1. HTF Trend established (+25)
  score += 25;

  // 2. MTF Location in favorable zone (+20)
  if (mtf15m.isLocationAligned) {
    score += 20;
    if (mtf15m.inOteZone) score += 5;
  }

  // 3. MTF Price at key POI with high conviction (+25)
  if (mtf15m.isAtKeyPoi && mtf15m.isPoiHtfAligned) {
    if (mtf15m.poiConvictionGrade === 'A_PLUS') score += 25;
    else if (mtf15m.poiConvictionGrade === 'A') score += 20;
    else if (mtf15m.poiConvictionGrade === 'B') score += 12;
  }

  // 4. LTF 5M 4-Stage Confirmation (+20)
  if (ltf5m.sweepStage.detected) score += 5;
  if (ltf5m.displacementStage.detected) score += 5;
  if (ltf5m.structureBreakStage.detected) score += 5;
  if (ltf5m.retracementStage.detected) score += 5;

  // 5. Active Killzone (+10)
  if (killzone !== 'OFF_HOURS') {
    score += 10;
  }

  return Math.min(100, score);
}

/**
 * Top-level master performSMCAnalysis entry point.
 * Composes 1H HTF, 15M MTF, 5M LTF, and 1M micro annotations into SMCAnalysisResult.
 */
export function performSMCAnalysis(
  symbol: InstrumentSymbol,
  candles1h: readonly Candle[],
  candles15m: readonly Candle[],
  candles5m: readonly Candle[],
  candles1m?: readonly Candle[],
  options?: { runContext?: string },
): SMCAnalysisResult {
  const analyzedAt = Date.now();

  // 1. Run multi-timeframe orchestration
  const orchestration = SmcMultiTimeframeEngine.orchestrateMultiTimeframeAnalysis({
    symbol,
    candles1H: candles1h,
    candles15M: candles15m,
    candles5M: candles5m,
    candles1M: candles1m,
    runContext: options?.runContext ?? 'master_analysis',
  });

  // 2. Audit rule firings in Knowledge Core Engine
  SmcKnowledgeCoreEngine.auditOrchestration(orchestration);

  const { htf1h, mtf15m, ltf5m } = orchestration;

  // 3. Fallback price reference
  const latestPrice =
    candles5m[candles5m.length - 1]?.close ??
    candles15m[candles15m.length - 1]?.close ??
    candles1h[candles1h.length - 1]?.close ??
    0;

  // 4. Resolve Killzone session
  const latestTimestamp =
    candles5m[candles5m.length - 1]?.timestamp ?? analyzedAt;
  const activeKillzone = determineKillzoneSession(latestTimestamp);

  // 5. Hard Rule 4: Isolated 1M micro context
  const executionContext1M = extract1mMicroContext(candles1m, latestPrice);

  // 6. Confluence score
  const confluenceScore = calculateConfluenceScore(orchestration, activeKillzone);

  // 7. Compose 1H HTF container
  const higherTimeframe1H = {
    bias: htf1h.directionalBias,
    regime: htf1h.marketRegime,
    swingPoints: htf1h.swingPoints,
    structureBreaks: htf1h.structureBreaks,
    orderBlocks: htf1h.activeOrderBlocks as readonly OrderBlockZone[],
    fairValueGaps: htf1h.activeFairValueGaps as readonly FairValueGapZone[],
    premiumDiscount: htf1h.premiumDiscount ?? {
      symbol,
      timeframe: '1H',
      rangeHigh: latestPrice * 1.01,
      rangeLow: latestPrice * 0.99,
      equilibriumPrice: latestPrice,
      premiumThreshold: latestPrice * 1.005,
      discountThreshold: latestPrice * 0.995,
      optimalTradeEntryUpper: latestPrice * 1.008,
      optimalTradeEntryLower: latestPrice * 1.006,
      currentZone: 'EQUILIBRIUM',
    },
  };

  // 8. Compose 15M MTF container
  const intermediateTimeframe15M = {
    bias: mtf15m.structureAnalysis.trendBias,
    regime: mtf15m.structureAnalysis.marketRegime,
    swingPoints: mtf15m.swingPoints,
    structureBreaks: mtf15m.structureBreaks,
    orderBlocks: mtf15m.activeOrderBlocks,
    fairValueGaps: mtf15m.activeFVGs,
    liquidityLevels: mtf15m.liquidityLevels,
  };

  // 9. Compose 5M LTF container
  const lowerTimeframe5M = {
    bias: ltf5m.structureAnalysis.trendBias,
    swingPoints: ltf5m.swingPoints,
    structureBreaks: ltf5m.structureBreaks,
    liquiditySweeps: ltf5m.liquiditySweeps,
    activeOrderBlocks: ltf5m.activeOrderBlocks,
    activeFVGs: ltf5m.activeFVGs,
  };

  return {
    symbol,
    analyzedAt,
    higherTimeframe1H,
    intermediateTimeframe15M,
    lowerTimeframe5M,
    executionContext1M,
    confluenceScore,
    overallBias: orchestration.overallBias,
    activeKillzone,
  };
}

export class SmcRuleEngine {
  /**
   * Static alias pointing to performSMCAnalysis.
   */
  public static performSMCAnalysis = performSMCAnalysis;

  /**
   * Rich execution helper returning both SMCAnalysisResult and detailed orchestration.
   */
  public static performComprehensiveAnalysis(
    symbol: InstrumentSymbol,
    candles1h: readonly Candle[],
    candles15m: readonly Candle[],
    candles5m: readonly Candle[],
    candles1m?: readonly Candle[],
    options?: { runContext?: string },
  ): {
    analysisResult: SMCAnalysisResult;
    orchestration: MultiTimeframeOrchestrationResult;
  } {
    const orchestration = SmcMultiTimeframeEngine.orchestrateMultiTimeframeAnalysis({
      symbol,
      candles1H: candles1h,
      candles15M: candles15m,
      candles5M: candles5m,
      candles1M: candles1m,
      runContext: options?.runContext ?? 'comprehensive_analysis',
    });

    const analysisResult = performSMCAnalysis(
      symbol,
      candles1h,
      candles15m,
      candles5m,
      candles1m,
      options,
    );

    return {
      analysisResult,
      orchestration,
    };
  }
}
