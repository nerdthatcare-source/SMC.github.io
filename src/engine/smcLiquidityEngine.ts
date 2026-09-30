/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SMC Liquidity Engine
 *
 * Detects institutional liquidity pools across two canonical categories:
 * 1. External Range Liquidity (ERL):
 *    - Prior Week High / Low (PWH / PWL)
 *    - Prior Day High / Low (PDH / PDL)
 *    - Session Extremes (Asian High / Asian Low)
 *    - Major Structural Swings (intact Strong Swings and defining dealing range boundaries)
 * 2. Internal Range Liquidity (IRL):
 *    - Equal Highs (EQH) and Equal Lows (EQL) within 0.15 * ATR cluster tolerance
 *    - Minor / Intermediate internal swing pivots within the active dealing range
 *
 * Side classification:
 * - BUY_SIDE: Resting buy stops above highs (targeted by institutional smart money to sell into).
 * - SELL_SIDE: Resting sell stops below lows (targeted by institutional smart money to buy into).
 *
 * Pure calculation: No I/O, consumes canonical candles and Phase 2 structure output.
 */

import {
  Candle,
  InstrumentSymbol,
  LiquidityLevel,
  LiquidityLevelType,
  StructuralTimeframe,
} from '../types/smc';
import { assertStructuralTimeframe } from './canonicalDataContracts';
import { CanonicalPeriodLevelsEngine, PeriodReferenceLevelsReport } from './canonicalPeriodLevelsEngine';
import { CanonicalSwingPoint } from './canonicalStructureEngine';
import { getInstrumentConfig } from './instrumentMarketConfiguration';
import { MarketDataNormalization } from './marketDataNormalization';
import { TimeframeStructureAnalysis } from './smcMarketStructureEngine';

export type LiquiditySide = 'BUY_SIDE' | 'SELL_SIDE';

export type LiquidityCategory = 'EXTERNAL_RANGE' | 'INTERNAL_RANGE';

export type LiquidityOriginType =
  | 'PREVIOUS_WEEK_HIGH'
  | 'PREVIOUS_WEEK_LOW'
  | 'PREVIOUS_DAY_HIGH'
  | 'PREVIOUS_DAY_LOW'
  | 'SESSION_ASIAN_HIGH'
  | 'SESSION_ASIAN_LOW'
  | 'MAJOR_SWING_HIGH'
  | 'MAJOR_SWING_LOW'
  | 'EQUAL_HIGHS'
  | 'EQUAL_LOWS'
  | 'MINOR_SWING_HIGH'
  | 'MINOR_SWING_LOW';

export interface SmcLiquidityPool {
  readonly id: string;
  readonly symbol: InstrumentSymbol;
  readonly timeframe: StructuralTimeframe;
  readonly side: LiquiditySide;
  readonly category: LiquidityCategory;
  readonly originType: LiquidityOriginType;
  readonly price: number;
  readonly priceTolerance: number; // Cluster window (e.g. 0.15 * ATR for EQH/EQL)
  readonly constituentSwingIds: readonly string[];
  readonly originTimestamp: number;
  readonly originTimeIso: string;
  readonly touchCount: number;
  readonly estimatedVolumeWeight: number; // Heuristic weighting (0 - 100)
  readonly isSwept: boolean;
  readonly sweepTimestamp?: number;
  readonly canonicalLevelModel: LiquidityLevel;
}

export interface LiquidityDetectionInput {
  readonly symbol: InstrumentSymbol;
  readonly timeframe: StructuralTimeframe;
  readonly candles: readonly Candle[];
  readonly structureAnalysis: TimeframeStructureAnalysis;
  readonly periodLevels?: PeriodReferenceLevelsReport | null;
  readonly customAtr?: number;
}

export interface LiquidityAnalysisReport {
  readonly symbol: InstrumentSymbol;
  readonly timeframe: StructuralTimeframe;
  readonly calculatedAt: number;
  readonly atr: number;
  readonly clusterTolerancePrice: number;
  readonly externalPools: readonly SmcLiquidityPool[];
  readonly internalPools: readonly SmcLiquidityPool[];
  readonly allPools: readonly SmcLiquidityPool[];
  readonly nearestBuySidePool: SmcLiquidityPool | null;
  readonly nearestSellSidePool: SmcLiquidityPool | null;
}

export class SmcLiquidityEngine {
  /**
   * Computes the 14-period True Range (ATR) from candles, falling back to instrument configuration.
   */
  public static calculateAtr(candles: readonly Candle[], symbol: InstrumentSymbol): number {
    const config = getInstrumentConfig(symbol);
    const fallbackAtr = config.volatilityProfile.baselineAtr15M * config.pipSize;

    if (!candles || candles.length < 2) {
      return fallbackAtr;
    }

    const period = Math.min(14, candles.length - 1);
    let trueRangeSum = 0;

    for (let i = candles.length - period; i < candles.length; i++) {
      const current = candles[i];
      const previous = candles[i - 1];
      const tr = Math.max(
        current.high - current.low,
        Math.abs(current.high - previous.close),
        Math.abs(current.low - previous.close),
      );
      trueRangeSum += tr;
    }

    const calculated = trueRangeSum / period;
    return calculated > 0 ? calculated : fallbackAtr;
  }

  /**
   * Pure calculation: Detects External and Internal liquidity pools from structure and period levels.
   */
  public static detectLiquidityPools(input: LiquidityDetectionInput): LiquidityAnalysisReport {
    const { symbol, timeframe, candles, structureAnalysis } = input;
    assertStructuralTimeframe(timeframe);

    const calculatedAt = candles.length > 0 ? candles[candles.length - 1].timestamp : Date.now();
    const currentPrice = candles.length > 0 ? candles[candles.length - 1].close : 0;

    // 1. Calculate ATR and cluster tolerance (strict 0.15 * ATR rule for EQH/EQL)
    const atr = input.customAtr ?? this.calculateAtr(candles, symbol);
    const clusterTolerancePrice = atr * 0.15;

    const externalPools: SmcLiquidityPool[] = [];
    const internalPools: SmcLiquidityPool[] = [];

    // 2. Fetch Period Reference Levels (PWH, PWL, PDH, PDL, Asian High, Asian Low)
    const periodReport =
      input.periodLevels ??
      CanonicalPeriodLevelsEngine.computePeriodReferenceLevels(candles, symbol, timeframe);

    // Prior Week High & Low (External Range Liquidity)
    if (periodReport.priorWeek) {
      const pwhPrice = periodReport.priorWeek.pwh;
      externalPools.push({
        id: `LIQ_PWH_${symbol}_${periodReport.priorWeek.weekIso}`,
        symbol,
        timeframe,
        side: 'BUY_SIDE',
        category: 'EXTERNAL_RANGE',
        originType: 'PREVIOUS_WEEK_HIGH',
        price: pwhPrice,
        priceTolerance: clusterTolerancePrice,
        constituentSwingIds: [],
        originTimestamp: calculatedAt,
        originTimeIso: new Date(calculatedAt).toISOString(),
        touchCount: 1,
        estimatedVolumeWeight: 95,
        isSwept: periodReport.priorWeek.pwhSwept,
        sweepTimestamp: periodReport.priorWeek.pwhSweepTimestamp,
        canonicalLevelModel: {
          id: `LIQ_PWH_${symbol}_${periodReport.priorWeek.weekIso}`,
          symbol,
          timeframe,
          type: 'BSL',
          price: pwhPrice,
          originTimestamp: calculatedAt,
          isSwept: periodReport.priorWeek.pwhSwept,
          sweepTimestamp: periodReport.priorWeek.pwhSweepTimestamp,
          touchCount: 1,
        },
      });

      const pwlPrice = periodReport.priorWeek.pwl;
      externalPools.push({
        id: `LIQ_PWL_${symbol}_${periodReport.priorWeek.weekIso}`,
        symbol,
        timeframe,
        side: 'SELL_SIDE',
        category: 'EXTERNAL_RANGE',
        originType: 'PREVIOUS_WEEK_LOW',
        price: pwlPrice,
        priceTolerance: clusterTolerancePrice,
        constituentSwingIds: [],
        originTimestamp: calculatedAt,
        originTimeIso: new Date(calculatedAt).toISOString(),
        touchCount: 1,
        estimatedVolumeWeight: 95,
        isSwept: periodReport.priorWeek.pwlSwept,
        sweepTimestamp: periodReport.priorWeek.pwlSweepTimestamp,
        canonicalLevelModel: {
          id: `LIQ_PWL_${symbol}_${periodReport.priorWeek.weekIso}`,
          symbol,
          timeframe,
          type: 'SSL',
          price: pwlPrice,
          originTimestamp: calculatedAt,
          isSwept: periodReport.priorWeek.pwlSwept,
          sweepTimestamp: periodReport.priorWeek.pwlSweepTimestamp,
          touchCount: 1,
        },
      });
    }

    // Prior Day High & Low (External Range Liquidity)
    if (periodReport.priorDay) {
      const pdhPrice = periodReport.priorDay.pdh;
      externalPools.push({
        id: `LIQ_PDH_${symbol}_${periodReport.priorDay.dateIso}`,
        symbol,
        timeframe,
        side: 'BUY_SIDE',
        category: 'EXTERNAL_RANGE',
        originType: 'PREVIOUS_DAY_HIGH',
        price: pdhPrice,
        priceTolerance: clusterTolerancePrice,
        constituentSwingIds: [],
        originTimestamp: calculatedAt,
        originTimeIso: new Date(calculatedAt).toISOString(),
        touchCount: 1,
        estimatedVolumeWeight: 85,
        isSwept: periodReport.priorDay.pdhSwept,
        sweepTimestamp: periodReport.priorDay.pdhSweepTimestamp,
        canonicalLevelModel: {
          id: `LIQ_PDH_${symbol}_${periodReport.priorDay.dateIso}`,
          symbol,
          timeframe,
          type: 'PREVIOUS_DAY_HIGH',
          price: pdhPrice,
          originTimestamp: calculatedAt,
          isSwept: periodReport.priorDay.pdhSwept,
          sweepTimestamp: periodReport.priorDay.pdhSweepTimestamp,
          touchCount: 1,
        },
      });

      const pdlPrice = periodReport.priorDay.pdl;
      externalPools.push({
        id: `LIQ_PDL_${symbol}_${periodReport.priorDay.dateIso}`,
        symbol,
        timeframe,
        side: 'SELL_SIDE',
        category: 'EXTERNAL_RANGE',
        originType: 'PREVIOUS_DAY_LOW',
        price: pdlPrice,
        priceTolerance: clusterTolerancePrice,
        constituentSwingIds: [],
        originTimestamp: calculatedAt,
        originTimeIso: new Date(calculatedAt).toISOString(),
        touchCount: 1,
        estimatedVolumeWeight: 85,
        isSwept: periodReport.priorDay.pdlSwept,
        sweepTimestamp: periodReport.priorDay.pdlSweepTimestamp,
        canonicalLevelModel: {
          id: `LIQ_PDL_${symbol}_${periodReport.priorDay.dateIso}`,
          symbol,
          timeframe,
          type: 'PREVIOUS_DAY_LOW',
          price: pdlPrice,
          originTimestamp: calculatedAt,
          isSwept: periodReport.priorDay.pdlSwept,
          sweepTimestamp: periodReport.priorDay.pdlSweepTimestamp,
          touchCount: 1,
        },
      });
    }

    // Current Session Asian High / Low
    if (periodReport.currentSession && periodReport.currentSession.asianHigh > 0) {
      externalPools.push({
        id: `LIQ_ASIAN_HIGH_${symbol}_${calculatedAt}`,
        symbol,
        timeframe,
        side: 'BUY_SIDE',
        category: 'EXTERNAL_RANGE',
        originType: 'SESSION_ASIAN_HIGH',
        price: periodReport.currentSession.asianHigh,
        priceTolerance: clusterTolerancePrice,
        constituentSwingIds: [],
        originTimestamp: calculatedAt,
        originTimeIso: new Date(calculatedAt).toISOString(),
        touchCount: 1,
        estimatedVolumeWeight: 75,
        isSwept: periodReport.currentSession.asianSweptBSL,
        canonicalLevelModel: {
          id: `LIQ_ASIAN_HIGH_${symbol}_${calculatedAt}`,
          symbol,
          timeframe,
          type: 'SESSION_HIGH',
          price: periodReport.currentSession.asianHigh,
          originTimestamp: calculatedAt,
          isSwept: periodReport.currentSession.asianSweptBSL,
          touchCount: 1,
        },
      });

      externalPools.push({
        id: `LIQ_ASIAN_LOW_${symbol}_${calculatedAt}`,
        symbol,
        timeframe,
        side: 'SELL_SIDE',
        category: 'EXTERNAL_RANGE',
        originType: 'SESSION_ASIAN_LOW',
        price: periodReport.currentSession.asianLow,
        priceTolerance: clusterTolerancePrice,
        constituentSwingIds: [],
        originTimestamp: calculatedAt,
        originTimeIso: new Date(calculatedAt).toISOString(),
        touchCount: 1,
        estimatedVolumeWeight: 75,
        isSwept: periodReport.currentSession.asianSweptSSL,
        canonicalLevelModel: {
          id: `LIQ_ASIAN_LOW_${symbol}_${calculatedAt}`,
          symbol,
          timeframe,
          type: 'SESSION_LOW',
          price: periodReport.currentSession.asianLow,
          originTimestamp: calculatedAt,
          isSwept: periodReport.currentSession.asianSweptSSL,
          touchCount: 1,
        },
      });
    }

    // 3. Process Swings from Phase 2 Structure
    const swings = structureAnalysis.swings;
    const swingHighs = swings.filter((s) => s.type === 'SWING_HIGH');
    const swingLows = swings.filter((s) => s.type === 'SWING_LOW');

    // A. Detect Equal Highs (EQH) within 0.15 * ATR
    const clusteredHighs = this.clusterSwings(swingHighs, clusterTolerancePrice);
    for (const cluster of clusteredHighs) {
      if (cluster.length >= 2) {
        // Equal Highs detected! Highly concentrated buy stop pool
        const avgPrice = cluster.reduce((sum, s) => sum + s.price, 0) / cluster.length;
        const normalizedPrice = MarketDataNormalization.roundToPrecision(avgPrice, symbol);
        const newestSwing = cluster[cluster.length - 1];

        internalPools.push({
          id: `LIQ_EQH_${symbol}_${newestSwing.id}`,
          symbol,
          timeframe,
          side: 'BUY_SIDE',
          category: 'INTERNAL_RANGE',
          originType: 'EQUAL_HIGHS',
          price: normalizedPrice,
          priceTolerance: clusterTolerancePrice,
          constituentSwingIds: cluster.map((s) => s.id),
          originTimestamp: newestSwing.timestamp,
          originTimeIso: new Date(newestSwing.timestamp).toISOString(),
          touchCount: cluster.length,
          estimatedVolumeWeight: Math.min(95, 60 + cluster.length * 15),
          isSwept: cluster.every((s) => s.isBroken),
          canonicalLevelModel: {
            id: `LIQ_EQH_${symbol}_${newestSwing.id}`,
            symbol,
            timeframe,
            type: 'EQH',
            price: normalizedPrice,
            originTimestamp: newestSwing.timestamp,
            isSwept: cluster.every((s) => s.isBroken),
            touchCount: cluster.length,
          },
        });
      } else {
        // Single swing high
        const swing = cluster[0];
        const isMajor = swing.strength === 'STRONG' || swing.classification === 'HH';
        const targetList = isMajor ? externalPools : internalPools;
        const originType: LiquidityOriginType = isMajor ? 'MAJOR_SWING_HIGH' : 'MINOR_SWING_HIGH';

        targetList.push({
          id: `LIQ_${originType}_${symbol}_${swing.id}`,
          symbol,
          timeframe,
          side: 'BUY_SIDE',
          category: isMajor ? 'EXTERNAL_RANGE' : 'INTERNAL_RANGE',
          originType,
          price: swing.price,
          priceTolerance: clusterTolerancePrice,
          constituentSwingIds: [swing.id],
          originTimestamp: swing.timestamp,
          originTimeIso: new Date(swing.timestamp).toISOString(),
          touchCount: 1,
          estimatedVolumeWeight: isMajor ? 70 : 45,
          isSwept: swing.isBroken,
          sweepTimestamp: swing.brokenAtTimestamp,
          canonicalLevelModel: {
            id: `LIQ_${originType}_${symbol}_${swing.id}`,
            symbol,
            timeframe,
            type: 'BSL',
            price: swing.price,
            originTimestamp: swing.timestamp,
            isSwept: swing.isBroken,
            sweepTimestamp: swing.brokenAtTimestamp,
            touchCount: 1,
          },
        });
      }
    }

    // B. Detect Equal Lows (EQL) within 0.15 * ATR
    const clusteredLows = this.clusterSwings(swingLows, clusterTolerancePrice);
    for (const cluster of clusteredLows) {
      if (cluster.length >= 2) {
        // Equal Lows detected! Highly concentrated sell stop pool
        const avgPrice = cluster.reduce((sum, s) => sum + s.price, 0) / cluster.length;
        const normalizedPrice = MarketDataNormalization.roundToPrecision(avgPrice, symbol);
        const newestSwing = cluster[cluster.length - 1];

        internalPools.push({
          id: `LIQ_EQL_${symbol}_${newestSwing.id}`,
          symbol,
          timeframe,
          side: 'SELL_SIDE',
          category: 'INTERNAL_RANGE',
          originType: 'EQUAL_LOWS',
          price: normalizedPrice,
          priceTolerance: clusterTolerancePrice,
          constituentSwingIds: cluster.map((s) => s.id),
          originTimestamp: newestSwing.timestamp,
          originTimeIso: new Date(newestSwing.timestamp).toISOString(),
          touchCount: cluster.length,
          estimatedVolumeWeight: Math.min(95, 60 + cluster.length * 15),
          isSwept: cluster.every((s) => s.isBroken),
          canonicalLevelModel: {
            id: `LIQ_EQL_${symbol}_${newestSwing.id}`,
            symbol,
            timeframe,
            type: 'EQL',
            price: normalizedPrice,
            originTimestamp: newestSwing.timestamp,
            isSwept: cluster.every((s) => s.isBroken),
            touchCount: cluster.length,
          },
        });
      } else {
        // Single swing low
        const swing = cluster[0];
        const isMajor = swing.strength === 'STRONG' || swing.classification === 'LL';
        const targetList = isMajor ? externalPools : internalPools;
        const originType: LiquidityOriginType = isMajor ? 'MAJOR_SWING_LOW' : 'MINOR_SWING_LOW';

        targetList.push({
          id: `LIQ_${originType}_${symbol}_${swing.id}`,
          symbol,
          timeframe,
          side: 'SELL_SIDE',
          category: isMajor ? 'EXTERNAL_RANGE' : 'INTERNAL_RANGE',
          originType,
          price: swing.price,
          priceTolerance: clusterTolerancePrice,
          constituentSwingIds: [swing.id],
          originTimestamp: swing.timestamp,
          originTimeIso: new Date(swing.timestamp).toISOString(),
          touchCount: 1,
          estimatedVolumeWeight: isMajor ? 70 : 45,
          isSwept: swing.isBroken,
          sweepTimestamp: swing.brokenAtTimestamp,
          canonicalLevelModel: {
            id: `LIQ_${originType}_${symbol}_${swing.id}`,
            symbol,
            timeframe,
            type: 'SSL',
            price: swing.price,
            originTimestamp: swing.timestamp,
            isSwept: swing.isBroken,
            sweepTimestamp: swing.brokenAtTimestamp,
            touchCount: 1,
          },
        });
      }
    }

    const allPools = [...externalPools, ...internalPools];

    // Find nearest intact Buy-Side and Sell-Side pools relative to current price
    const intactBuySide = allPools
      .filter((p) => p.side === 'BUY_SIDE' && !p.isSwept && p.price >= currentPrice)
      .sort((a, b) => a.price - b.price);
    const nearestBuySidePool = intactBuySide.length > 0 ? intactBuySide[0] : null;

    const intactSellSide = allPools
      .filter((p) => p.side === 'SELL_SIDE' && !p.isSwept && p.price <= currentPrice)
      .sort((a, b) => b.price - a.price);
    const nearestSellSidePool = intactSellSide.length > 0 ? intactSellSide[0] : null;

    return {
      symbol,
      timeframe,
      calculatedAt,
      atr,
      clusterTolerancePrice,
      externalPools,
      internalPools,
      allPools,
      nearestBuySidePool,
      nearestSellSidePool,
    };
  }

  /**
   * Helper: Clusters swing points within a tolerance window (0.15 * ATR) to identify EQH / EQL.
   */
  private static clusterSwings(
    swings: readonly CanonicalSwingPoint[],
    tolerance: number,
  ): CanonicalSwingPoint[][] {
    if (swings.length === 0) return [];

    const sortedByPrice = [...swings].sort((a, b) => a.price - b.price);
    const clusters: CanonicalSwingPoint[][] = [];
    let currentCluster: CanonicalSwingPoint[] = [sortedByPrice[0]];

    for (let i = 1; i < sortedByPrice.length; i++) {
      const prev = currentCluster[currentCluster.length - 1];
      const curr = sortedByPrice[i];

      if (curr.price - prev.price <= tolerance) {
        currentCluster.push(curr);
      } else {
        clusters.push(currentCluster);
        currentCluster = [curr];
      }
    }
    clusters.push(currentCluster);

    return clusters;
  }
}
