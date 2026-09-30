/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SMC 5M Execution Engine
 *
 * Lower-Timeframe (LTF) Execution & Confirmation Sequence:
 * 1. Runs strictly on 5M canonical candles.
 * 2. Detects the canonical 4-stage confirmation sequence:
 *    Stage 1: Liquidity sweep (Phase 3 lifecycle SWEPT or REVERSED state).
 *    Stage 2: Displacement (candle body / range ratio > 0.65) in direction of 1H bias.
 *    Stage 3: CHoCH or BOS (Phase 2 structure break) in direction of 1H bias.
 *    Stage 4: Retracement into the 15M POI (or newly formed 5M POI within 15M zone).
 * 3. Rejects any 5M trigger signal that contradicts 1H directional bias (fails closed).
 *
 * HARD SMC INVARIANTS:
 * - 5M is the execution trigger timeframe.
 * - 1M data is strictly quarantined from this engine.
 * - Does not recompute Phase 2 or Phase 3 algorithms; consumes them.
 */

import {
  Candle,
  DirectionalBias,
  FairValueGapZone,
  InstrumentSymbol,
  LiquiditySweepEvent,
  OrderBlockZone,
  StructureBreak,
  SwingPoint,
} from '../types/smc';
import { assertStructuralTimeframe } from './canonicalDataContracts';
import { CanonicalMarketDataEngine } from './canonicalMarketDataEngine';
import { Smc15mSetupResult } from './smc15mSetupEngine';
import { Smc1hStructuralAnalysis } from './smc1hStructuralEngine';
import { FvgAnalysisReport, SmcFvgEngine } from './smcFvgEngine';
import { LiquidityAnalysisReport, SmcLiquidityEngine, SmcLiquidityPool } from './smcLiquidityEngine';
import {
  LifecycleEvaluationResult,
  PoolLifecycleSnapshot,
  SmcLiquidityLifecycleEngine,
  SmcLiquidityStore,
} from './smcLiquidityLifecycleEngine';
import {
  SmcMarketStructureEngine,
  StructureBreakEvent,
  TimeframeStructureAnalysis,
} from './smcMarketStructureEngine';
import { OrderBlockAnalysisReport, SmcOrderBlockEngine } from './smcOrderBlockEngine';

export type SmcExecutionTriggerState =
  | 'TRIGGER_CONFIRMED'
  | 'AWAITING_SWEEP'
  | 'AWAITING_DISPLACEMENT'
  | 'AWAITING_STRUCTURE_BREAK'
  | 'AWAITING_RETRACEMENT'
  | 'REJECTED_CONTRADICTS_HTF_BIAS'
  | 'NO_SETUP_ACTIVE';

export interface SweepStageResult {
  readonly detected: boolean;
  readonly pool: SmcLiquidityPool | null;
  readonly sweepEvent: LiquiditySweepEvent | null;
  readonly poolState?: 'SWEPT' | 'REVERSED';
  readonly timestamp?: number;
}

export interface DisplacementStageResult {
  readonly detected: boolean;
  readonly ratio: number; // > 0.65
  readonly candle: Candle | null;
  readonly direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  readonly timestamp?: number;
}

export interface StructureBreakStageResult {
  readonly detected: boolean;
  readonly breakEvent: StructureBreakEvent | null;
  readonly type?: 'BOS' | 'CHOCH';
  readonly direction?: 'BULLISH' | 'BEARISH';
  readonly timestamp?: number;
}

export interface RetracementStageResult {
  readonly detected: boolean;
  readonly retracementPrice: number;
  readonly isInsideTargetPoi: boolean;
  readonly targetPoiId?: string;
}

export interface Smc5mExecutionResult {
  readonly symbol: InstrumentSymbol;
  readonly timeframe: '5M';
  readonly evaluatedAt: number;
  readonly currentPrice: number;
  readonly htf1hBias: DirectionalBias;
  readonly triggerState: SmcExecutionTriggerState;
  readonly isTriggerConfirmed: boolean;
  readonly contradictsHtfBias: boolean;
  readonly rejectionReason: string | null;
  readonly sweepStage: SweepStageResult;
  readonly displacementStage: DisplacementStageResult;
  readonly structureBreakStage: StructureBreakStageResult;
  readonly retracementStage: RetracementStageResult;
  readonly structureAnalysis: TimeframeStructureAnalysis;
  readonly liquidityLifecycle: LifecycleEvaluationResult;
  readonly orderBlockReport: OrderBlockAnalysisReport;
  readonly fvgReport: FvgAnalysisReport;
  readonly liquidityReport: LiquidityAnalysisReport;
  readonly swingPoints: readonly SwingPoint[];
  readonly structureBreaks: readonly StructureBreak[];
  readonly liquiditySweeps: readonly LiquiditySweepEvent[];
  readonly activeOrderBlocks: readonly OrderBlockZone[];
  readonly activeFVGs: readonly FairValueGapZone[];
}

export class Smc5mExecutionEngine {
  /**
   * Evaluates the 5M confirmation sequence against HTF 1H bias and 15M setup context.
   */
  public static evaluate5mExecution(input: {
    candles5M: readonly Candle[];
    htf1hAnalysis: Smc1hStructuralAnalysis;
    setup15mResult: Smc15mSetupResult;
    symbolOverride?: InstrumentSymbol;
    runContext?: string;
  }): Smc5mExecutionResult {
    assertStructuralTimeframe('5M');

    const { candles5M, htf1hAnalysis, setup15mResult, symbolOverride, runContext } = input;
    const symbol = symbolOverride ?? (candles5M[0]?.symbol || htf1hAnalysis.symbol || 'EUR_USD');
    const htfBias = htf1hAnalysis.directionalBias;

    // Handle empty feed
    if (!candles5M || candles5M.length === 0) {
      const emptyStruct = SmcMarketStructureEngine.analyzeTimeframeStructure([], '5M');
      return {
        symbol,
        timeframe: '5M',
        evaluatedAt: Date.now(),
        currentPrice: 0,
        htf1hBias: htfBias,
        triggerState: 'NO_SETUP_ACTIVE',
        isTriggerConfirmed: false,
        contradictsHtfBias: false,
        rejectionReason: 'NO_5M_CANDLES_AVAILABLE',
        sweepStage: { detected: false, pool: null, sweepEvent: null },
        displacementStage: { detected: false, ratio: 0, candle: null, direction: 'NEUTRAL' },
        structureBreakStage: { detected: false, breakEvent: null },
        retracementStage: { detected: false, retracementPrice: 0, isInsideTargetPoi: false },
        structureAnalysis: emptyStruct,
        liquidityLifecycle: {
          symbol,
          timeframe: '5M',
          evaluatedAt: Date.now(),
          activePoolsCount: 0,
          untouchedCount: 0,
          approachingCount: 0,
          sweptCount: 0,
          reversedCount: 0,
          poolSnapshots: [],
          newSweepEvents: [],
        },
        orderBlockReport: {
          symbol,
          timeframe: '5M',
          calculatedAt: Date.now(),
          orderBlocks: [],
          unmitigatedBullishBlocks: [],
          unmitigatedBearishBlocks: [],
          swingBlocks: [],
          internalBlocks: [],
        },
        fvgReport: {
          symbol,
          timeframe: '5M',
          calculatedAt: Date.now(),
          totalGapsDetected: 0,
          unmitigatedBisiGaps: [],
          unmitigatedSibiGaps: [],
          allGaps: [],
          activeInversionGaps: [],
          nearestBullishFvg: null,
          nearestBearishFvg: null,
        },
        liquidityReport: {
          symbol,
          timeframe: '5M',
          calculatedAt: Date.now(),
          atr: 0.001,
          clusterTolerancePrice: 0.00015,
          externalPools: [],
          internalPools: [],
          allPools: [],
          nearestBuySidePool: null,
          nearestSellSidePool: null,
        },
        swingPoints: [],
        structureBreaks: [],
        liquiditySweeps: [],
        activeOrderBlocks: [],
        activeFVGs: [],
      };
    }

    const latestCandle = candles5M[candles5M.length - 1];
    const currentPrice = latestCandle.close;

    // 1. Phase 2 5M structure analysis
    const structureAnalysis = SmcMarketStructureEngine.analyzeTimeframeStructure(
      candles5M,
      '5M',
    );

    // 2. Phase 3 5M liquidity analysis
    const liquidityReport = SmcLiquidityEngine.detectLiquidityPools({
      symbol,
      timeframe: '5M',
      candles: candles5M,
      structureAnalysis,
    });

    // 3. Evaluate pool lifecycle using scoped store
    const lifecycleResult = SmcLiquidityLifecycleEngine.evaluatePools(
      liquidityReport.allPools,
      candles5M,
      '5M',
    );

    // Ingest into scoped store
    const scopedStore = SmcLiquidityStore.getScopedInstance(
      symbol,
      '5M',
      runContext ?? 'default',
    );
    scopedStore.ingestEvaluation(lifecycleResult);

    // 4. Phase 3 5M Order Blocks & FVGs
    const orderBlockReport = SmcOrderBlockEngine.detectOrderBlocks(
      candles5M,
      structureAnalysis,
    );
    const fvgReport = SmcFvgEngine.detectFairValueGaps(candles5M, '5M');

    // CONTRADICTION CHECK:
    // If HTF bias is NEUTRAL, we cannot confirm a directional trade trigger.
    if (htfBias === 'NEUTRAL') {
      return this.buildResult({
        symbol,
        timeframe: '5M',
        evaluatedAt: latestCandle.timestamp,
        currentPrice,
        htf1hBias: htfBias,
        triggerState: 'NO_SETUP_ACTIVE',
        isTriggerConfirmed: false,
        contradictsHtfBias: false,
        rejectionReason: 'HTF_1H_BIAS_NEUTRAL: No directional bias established on 1H',
        sweepStage: { detected: false, pool: null, sweepEvent: null },
        displacementStage: { detected: false, ratio: 0, candle: null, direction: 'NEUTRAL' },
        structureBreakStage: { detected: false, breakEvent: null },
        retracementStage: { detected: false, retracementPrice: currentPrice, isInsideTargetPoi: false },
        structureAnalysis,
        liquidityLifecycle: lifecycleResult,
        orderBlockReport,
        fvgReport,
        liquidityReport,
      });
    }

    // Check for counter-HTF triggers on 5M:
    // Contradiction occurs if the latest confirmed structure break on 5M is in the opposing direction,
    // or if an opposing break occurred after any aligned break.
    const opposingDirection = htfBias === 'BULLISH' ? 'BEARISH' : 'BULLISH';
    const alignedDirection = htfBias === 'BULLISH' ? 'BULLISH' : 'BEARISH';

    const breaks = structureAnalysis.structureBreaks;
    const latestBreak = breaks.length > 0 ? breaks[breaks.length - 1] : null;

    const alignedBreaks = breaks.filter((b) => b.direction === alignedDirection);
    const counterBreaks = breaks.filter((b) => b.direction === opposingDirection);

    const latestAlignedBreak =
      alignedBreaks.length > 0 ? alignedBreaks[alignedBreaks.length - 1] : null;
    const latestCounterBreak =
      counterBreaks.length > 0 ? counterBreaks[counterBreaks.length - 1] : null;

    const isContradiction =
      (latestCounterBreak !== null &&
        (latestAlignedBreak === null ||
          latestCounterBreak.triggerCandleTimestamp > latestAlignedBreak.triggerCandleTimestamp)) ||
      (latestBreak !== null && latestBreak.direction === opposingDirection);

    if (isContradiction && latestCounterBreak) {
      return this.buildResult({
        symbol,
        timeframe: '5M',
        evaluatedAt: latestCandle.timestamp,
        currentPrice,
        htf1hBias: htfBias,
        triggerState: 'REJECTED_CONTRADICTS_HTF_BIAS',
        isTriggerConfirmed: false,
        contradictsHtfBias: true,
        rejectionReason: `CONTRADICTION: 5M formed ${latestCounterBreak.direction} ${latestCounterBreak.type}, contradicting 1H ${htfBias} bias`,
        sweepStage: { detected: false, pool: null, sweepEvent: null },
        displacementStage: { detected: false, ratio: 0, candle: null, direction: 'NEUTRAL' },
        structureBreakStage: {
          detected: true,
          breakEvent: latestCounterBreak,
          type: latestCounterBreak.type,
          direction: latestCounterBreak.direction,
          timestamp: latestCounterBreak.triggerCandleTimestamp,
        },
        retracementStage: { detected: false, retracementPrice: currentPrice, isInsideTargetPoi: false },
        structureAnalysis,
        liquidityLifecycle: lifecycleResult,
        orderBlockReport,
        fvgReport,
        liquidityReport,
      });
    }

    // STAGE 1: Liquidity sweep detection (Phase 3 lifecycle SWEPT or REVERSED state)
    // For BULLISH setup: expect Sell-Side Liquidity (SSL, EQL, Session Low, etc.) swept
    // For BEARISH setup: expect Buy-Side Liquidity (BSL, EQH, Session High, etc.) swept
    const targetPoolSide = htfBias === 'BULLISH' ? 'SELL_SIDE' : 'BUY_SIDE';
    const opposingPoolSide = htfBias === 'BULLISH' ? 'BUY_SIDE' : 'SELL_SIDE';

    // Check if an opposing sweep occurred (e.g., BSL swept during bullish bias that led to bearish continuation)
    const opposingSweep = lifecycleResult.poolSnapshots.find(
      (s) => s.pool.side === opposingPoolSide && (s.state === 'SWEPT' || s.state === 'REVERSED'),
    );

    const alignedSweepSnapshots = lifecycleResult.poolSnapshots.filter(
      (s) => s.pool.side === targetPoolSide && (s.state === 'SWEPT' || s.state === 'REVERSED'),
    );

    // Sort by sweep timestamp descending
    alignedSweepSnapshots.sort(
      (a, b) => (b.sweepEvent?.timestamp ?? 0) - (a.sweepEvent?.timestamp ?? 0),
    );

    // Look for an aligned sweep that has a subsequent displacement impulse (body/range > 0.65)
    let selectedSweep: PoolLifecycleSnapshot | null = null;
    let maxDisplacementRatio = 0;
    let displacementCandle: Candle | null = null;
    let displacementDetected = false;

    for (const snap of alignedSweepSnapshots) {
      const sTimestamp = snap.sweepEvent?.timestamp ?? snap.pool.originTimestamp;
      for (const c of candles5M) {
        if (c.timestamp < sTimestamp) continue;
        const range = c.high - c.low;
        if (range <= 0.00001) continue;
        const body = Math.abs(c.close - c.open);
        const ratio = body / range;

        const isDirectionCorrect =
          htfBias === 'BULLISH' ? c.close > c.open : c.close < c.open;

        if (ratio > 0.65 && isDirectionCorrect) {
          if (ratio > maxDisplacementRatio) {
            maxDisplacementRatio = ratio;
            displacementCandle = c;
            displacementDetected = true;
            selectedSweep = snap;
          }
        }
      }
      if (displacementDetected) {
        break;
      }
    }

    // Fallback to most recent sweep if no displacement matched yet
    if (!selectedSweep && alignedSweepSnapshots.length > 0) {
      selectedSweep = alignedSweepSnapshots[0];
    }

    const sweepDetected = selectedSweep !== null;
    const sweepTimestamp = selectedSweep?.sweepEvent?.timestamp ?? (selectedSweep ? candles5M[0].timestamp : undefined);

    const sweepStage: SweepStageResult = {
      detected: sweepDetected,
      pool: selectedSweep?.pool ?? null,
      sweepEvent: selectedSweep?.sweepEvent ?? null,
      poolState: selectedSweep?.state === 'REVERSED' ? 'REVERSED' : selectedSweep?.state === 'SWEPT' ? 'SWEPT' : undefined,
      timestamp: sweepTimestamp,
    };

    if (!sweepDetected) {
      // Check if opposing sweep and break occurred -> explicit contradiction rejection!
      if (opposingSweep && latestCounterBreak) {
        return this.buildResult({
          symbol,
          timeframe: '5M',
          evaluatedAt: latestCandle.timestamp,
          currentPrice,
          htf1hBias: htfBias,
          triggerState: 'REJECTED_CONTRADICTS_HTF_BIAS',
          isTriggerConfirmed: false,
          contradictsHtfBias: true,
          rejectionReason: `CONTRADICTION: 5M formed ${opposingSweep.pool.side} sweep and ${latestCounterBreak.direction} ${latestCounterBreak.type}, contradicting 1H ${htfBias} bias`,
          sweepStage,
          displacementStage: { detected: false, ratio: 0, candle: null, direction: 'NEUTRAL' },
          structureBreakStage: { detected: true, breakEvent: latestCounterBreak, type: latestCounterBreak.type, direction: latestCounterBreak.direction },
          retracementStage: { detected: false, retracementPrice: currentPrice, isInsideTargetPoi: false },
          structureAnalysis,
          liquidityLifecycle: lifecycleResult,
          orderBlockReport,
          fvgReport,
          liquidityReport,
        });
      }

      return this.buildResult({
        symbol,
        timeframe: '5M',
        evaluatedAt: latestCandle.timestamp,
        currentPrice,
        htf1hBias: htfBias,
        triggerState: 'AWAITING_SWEEP',
        isTriggerConfirmed: false,
        contradictsHtfBias: false,
        rejectionReason: `AWAITING_5M_SWEEP: No ${targetPoolSide} liquidity sweep found on 5M`,
        sweepStage,
        displacementStage: { detected: false, ratio: 0, candle: null, direction: 'NEUTRAL' },
        structureBreakStage: { detected: false, breakEvent: null },
        retracementStage: { detected: false, retracementPrice: currentPrice, isInsideTargetPoi: false },
        structureAnalysis,
        liquidityLifecycle: lifecycleResult,
        orderBlockReport,
        fvgReport,
        liquidityReport,
      });
    }

    const displacementStage: DisplacementStageResult = {
      detected: displacementDetected,
      ratio: Math.round(maxDisplacementRatio * 100) / 100,
      candle: displacementCandle,
      direction: htfBias === 'BULLISH' ? 'BULLISH' : 'BEARISH',
      timestamp: displacementCandle?.timestamp,
    };

    if (!displacementDetected) {
      return this.buildResult({
        symbol,
        timeframe: '5M',
        evaluatedAt: latestCandle.timestamp,
        currentPrice,
        htf1hBias: htfBias,
        triggerState: 'AWAITING_DISPLACEMENT',
        isTriggerConfirmed: false,
        contradictsHtfBias: false,
        rejectionReason: `AWAITING_DISPLACEMENT: No 5M candle with body/range ratio > 0.65 in direction of ${htfBias} bias`,
        sweepStage,
        displacementStage,
        structureBreakStage: { detected: false, breakEvent: null },
        retracementStage: { detected: false, retracementPrice: currentPrice, isInsideTargetPoi: false },
        structureAnalysis,
        liquidityLifecycle: lifecycleResult,
        orderBlockReport,
        fvgReport,
        liquidityReport,
      });
    }

    // STAGE 3: CHoCH or BOS in direction of 1H bias
    // Find structure breaks in direction of 1H bias occurring at or after the sweep/displacement
    const stageAlignedBreaks = structureAnalysis.structureBreaks.filter(
      (b) =>
        b.direction === (htfBias === 'BULLISH' ? 'BULLISH' : 'BEARISH') &&
        (sweepTimestamp === undefined || b.triggerCandleTimestamp >= sweepTimestamp),
    );

    const stageBreak =
      stageAlignedBreaks.length > 0
        ? stageAlignedBreaks[stageAlignedBreaks.length - 1]
        : null;

    // Check if a contradicting break happened AFTER the aligned break
    if (
      latestCounterBreak &&
      stageBreak &&
      latestCounterBreak.triggerCandleTimestamp > stageBreak.triggerCandleTimestamp
    ) {
      return this.buildResult({
        symbol,
        timeframe: '5M',
        evaluatedAt: latestCandle.timestamp,
        currentPrice,
        htf1hBias: htfBias,
        triggerState: 'REJECTED_CONTRADICTS_HTF_BIAS',
        isTriggerConfirmed: false,
        contradictsHtfBias: true,
        rejectionReason: `CONTRADICTION: 5M subsequent ${latestCounterBreak.direction} ${latestCounterBreak.type} invalidates setup against 1H ${htfBias} bias`,
        sweepStage,
        displacementStage,
        structureBreakStage: {
          detected: true,
          breakEvent: latestCounterBreak,
          type: latestCounterBreak.type,
          direction: latestCounterBreak.direction,
          timestamp: latestCounterBreak.triggerCandleTimestamp,
        },
        retracementStage: { detected: false, retracementPrice: currentPrice, isInsideTargetPoi: false },
        structureAnalysis,
        liquidityLifecycle: lifecycleResult,
        orderBlockReport,
        fvgReport,
        liquidityReport,
      });
    }

    const structureBreakStage: StructureBreakStageResult = {
      detected: stageBreak !== null,
      breakEvent: stageBreak,
      type: stageBreak?.type,
      direction: stageBreak?.direction,
      timestamp: stageBreak?.triggerCandleTimestamp,
    };

    if (!stageBreak) {
      return this.buildResult({
        symbol,
        timeframe: '5M',
        evaluatedAt: latestCandle.timestamp,
        currentPrice,
        htf1hBias: htfBias,
        triggerState: 'AWAITING_STRUCTURE_BREAK',
        isTriggerConfirmed: false,
        contradictsHtfBias: false,
        rejectionReason: `AWAITING_STRUCTURE_BREAK: Sweep and displacement confirmed, awaiting 5M ${htfBias} BOS or CHoCH`,
        sweepStage,
        displacementStage,
        structureBreakStage,
        retracementStage: { detected: false, retracementPrice: currentPrice, isInsideTargetPoi: false },
        structureAnalysis,
        liquidityLifecycle: lifecycleResult,
        orderBlockReport,
        fvgReport,
        liquidityReport,
      });
    }

    // STAGE 4: Retracement into the 15M POI (or newly formed 5M POI aligned with 15M POI)
    // Check if price has retraced into setup15mResult.activeSetupPoi or 15M key POI bounds
    const active15mPoi = setup15mResult.activeSetupPoi?.poiContext;
    let isInsidePoi = false;
    let targetPoiId: string | undefined;

    if (active15mPoi) {
      const minPrice = Math.min(active15mPoi.lowPrice, active15mPoi.highPrice);
      const maxPrice = Math.max(active15mPoi.lowPrice, active15mPoi.highPrice);
      targetPoiId = active15mPoi.id;

      // Price is retraced if currentPrice is within or touching 15M POI bounds (with 0.05% tolerance)
      const buffer = (maxPrice - minPrice) * 0.25 || 0.0003;
      if (currentPrice >= minPrice - buffer && currentPrice <= maxPrice + buffer) {
        isInsidePoi = true;
      }
    } else {
      // Fallback: check unmitigated 5M order blocks or FVGs formed by displacement
      const fresh5mOb = orderBlockReport.orderBlocks.find(
        (ob) => ob.mitigationState === 'UNMITIGATED' || ob.mitigationState === 'PARTIALLY_MITIGATED',
      );
      if (fresh5mOb) {
        targetPoiId = fresh5mOb.id;
        const minP = Math.min(fresh5mOb.lowPrice, fresh5mOb.highPrice);
        const maxP = Math.max(fresh5mOb.lowPrice, fresh5mOb.highPrice);
        if (currentPrice >= minP && currentPrice <= maxP) {
          isInsidePoi = true;
        }
      } else {
        // If price is within dealing range discount/premium
        isInsidePoi = setup15mResult.isAtKeyPoi || setup15mResult.isLocationAligned;
      }
    }

    const retracementStage: RetracementStageResult = {
      detected: isInsidePoi,
      retracementPrice: currentPrice,
      isInsideTargetPoi: isInsidePoi,
      targetPoiId,
    };

    if (!isInsidePoi) {
      return this.buildResult({
        symbol,
        timeframe: '5M',
        evaluatedAt: latestCandle.timestamp,
        currentPrice,
        htf1hBias: htfBias,
        triggerState: 'AWAITING_RETRACEMENT',
        isTriggerConfirmed: false,
        contradictsHtfBias: false,
        rejectionReason: `AWAITING_RETRACEMENT: Structure break confirmed; awaiting price retracement into 15M POI (${targetPoiId ?? 'POI zone'})`,
        sweepStage,
        displacementStage,
        structureBreakStage,
        retracementStage,
        structureAnalysis,
        liquidityLifecycle: lifecycleResult,
        orderBlockReport,
        fvgReport,
        liquidityReport,
      });
    }

    // ALL 4 STAGES CONFIRMED IN SEQUENCE!
    return this.buildResult({
      symbol,
      timeframe: '5M',
      evaluatedAt: latestCandle.timestamp,
      currentPrice,
      htf1hBias: htfBias,
      triggerState: 'TRIGGER_CONFIRMED',
      isTriggerConfirmed: true,
      contradictsHtfBias: false,
      rejectionReason: null,
      sweepStage,
      displacementStage,
      structureBreakStage,
      retracementStage,
      structureAnalysis,
      liquidityLifecycle: lifecycleResult,
      orderBlockReport,
      fvgReport,
      liquidityReport,
    });
  }

  private static buildResult(params: {
    symbol: InstrumentSymbol;
    timeframe: '5M';
    evaluatedAt: number;
    currentPrice: number;
    htf1hBias: DirectionalBias;
    triggerState: SmcExecutionTriggerState;
    isTriggerConfirmed: boolean;
    contradictsHtfBias: boolean;
    rejectionReason: string | null;
    sweepStage: SweepStageResult;
    displacementStage: DisplacementStageResult;
    structureBreakStage: StructureBreakStageResult;
    retracementStage: RetracementStageResult;
    structureAnalysis: TimeframeStructureAnalysis;
    liquidityLifecycle: LifecycleEvaluationResult;
    orderBlockReport: OrderBlockAnalysisReport;
    fvgReport: FvgAnalysisReport;
    liquidityReport: LiquidityAnalysisReport;
  }): Smc5mExecutionResult {
    const {
      symbol,
      timeframe,
      evaluatedAt,
      currentPrice,
      htf1hBias,
      triggerState,
      isTriggerConfirmed,
      contradictsHtfBias,
      rejectionReason,
      sweepStage,
      displacementStage,
      structureBreakStage,
      retracementStage,
      structureAnalysis,
      liquidityLifecycle,
      orderBlockReport,
      fvgReport,
      liquidityReport,
    } = params;

    const swingPoints: readonly SwingPoint[] = structureAnalysis.swings;
    const structureBreaks: readonly StructureBreak[] = structureAnalysis.structureBreaks;
    const liquiditySweeps: readonly LiquiditySweepEvent[] = liquidityLifecycle.newSweepEvents;
    const activeOrderBlocks: readonly OrderBlockZone[] = orderBlockReport.orderBlocks;
    const activeFVGs: readonly FairValueGapZone[] = fvgReport.allGaps;

    return {
      symbol,
      timeframe,
      evaluatedAt,
      currentPrice,
      htf1hBias,
      triggerState,
      isTriggerConfirmed,
      contradictsHtfBias,
      rejectionReason,
      sweepStage,
      displacementStage,
      structureBreakStage,
      retracementStage,
      structureAnalysis,
      liquidityLifecycle,
      orderBlockReport,
      fvgReport,
      liquidityReport,
      swingPoints,
      structureBreaks,
      liquiditySweeps,
      activeOrderBlocks,
      activeFVGs,
    };
  }

  /**
   * Facade method reading 5M candles from Phase 1 CanonicalMarketDataEngine.
   */
  public static evaluateFromMarketData(
    marketDataEngine: CanonicalMarketDataEngine,
    htf1hAnalysis: Smc1hStructuralAnalysis,
    setup15mResult: Smc15mSetupResult,
    symbol: InstrumentSymbol,
    runContext?: string,
  ): Smc5mExecutionResult {
    const candles5M = marketDataEngine.getCandles(symbol, '5M');
    return this.evaluate5mExecution({
      candles5M,
      htf1hAnalysis,
      setup15mResult,
      symbolOverride: symbol,
      runContext,
    });
  }
}
