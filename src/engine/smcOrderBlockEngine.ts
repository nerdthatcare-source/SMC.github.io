/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SMC Displacement Order Block Engine
 *
 * Identifies, validates, and tracks institutional Order Blocks (OB).
 *
 * INSTITUTIONAL SMC RULES:
 * 1. An Order Block is formed by the final opposing consolidation candle prior to an
 *    explosive displacement impulse that violates market structure (BOS or CHoCH).
 * 2. Scope Tagging:
 *    - SWING OB: Originates from a displacement that broke a major SWING pivot.
 *    - INTERNAL OB: Originates from a displacement that broke an INTERNAL structure level.
 * 3. 50% Mean Threshold (MT):
 *    - The exact mathematical midpoint: (high + low) / 2.
 *    - Institutional smart money treats MT as the definitive line between order absorption
 *      and zone invalidation.
 * 4. Mitigation Lifecycle:
 *    - UNMITIGATED: Fresh liquidity footprint. Highest statistical conviction.
 *    - PARTIALLY_MITIGATED: Price wicked into the outer zone but failed to test MT.
 *    - FULLY_MITIGATED: Price reached or pierced MT. Resting limit orders largely absorbed.
 *    - INVALIDATED: Candle body closed beyond the opposing boundary of the order block.
 *
 * Pure calculation: No I/O, consumes canonical candles and Phase 2 structure output.
 */

import {
  Candle,
  InstrumentSymbol,
  OrderBlockType,
  OrderBlockZone,
  StructuralTimeframe,
} from '../types/smc';
import { assertStructuralTimeframe } from './canonicalDataContracts';
import { MarketDataNormalization } from './marketDataNormalization';
import {
  StructureBreakEvent,
  StructureBreakScope,
  TimeframeStructureAnalysis,
} from './smcMarketStructureEngine';

export type ObMitigationState =
  | 'UNMITIGATED'
  | 'PARTIALLY_MITIGATED'
  | 'FULLY_MITIGATED'
  | 'INVALIDATED';

export interface SmcOrderBlock extends OrderBlockZone {
  readonly scope: StructureBreakScope; // SWING or INTERNAL from Phase 2
  readonly mitigationState: ObMitigationState;
  readonly openPrice: number;
  readonly closePrice: number;
  readonly originCandleIndex: number;
  readonly triggerBreakId: string;
  readonly triggerBreakScope: StructureBreakScope;
  readonly triggerBreakType: 'BOS' | 'CHOCH';
  readonly displacementPips: number;
  readonly leavesImbalance: boolean;
  readonly invalidationPrice: number; // Opposing boundary price
}

export interface OrderBlockAnalysisReport {
  readonly symbol: InstrumentSymbol;
  readonly timeframe: StructuralTimeframe;
  readonly calculatedAt: number;
  readonly orderBlocks: readonly SmcOrderBlock[];
  readonly unmitigatedBullishBlocks: readonly SmcOrderBlock[];
  readonly unmitigatedBearishBlocks: readonly SmcOrderBlock[];
  readonly swingBlocks: readonly SmcOrderBlock[];
  readonly internalBlocks: readonly SmcOrderBlock[];
}

export class SmcOrderBlockEngine {
  /**
   * Pure calculation: Detects Order Blocks from displacement breaks and tracks their mitigation state.
   */
  public static detectOrderBlocks(
    candles: readonly Candle[],
    structureAnalysis: TimeframeStructureAnalysis,
  ): OrderBlockAnalysisReport {
    const { symbol, timeframe, structureBreaks } = structureAnalysis;
    assertStructuralTimeframe(timeframe);

    const calculatedAt = candles.length > 0 ? candles[candles.length - 1].timestamp : Date.now();

    if (!candles || candles.length === 0 || structureBreaks.length === 0) {
      return {
        symbol,
        timeframe,
        calculatedAt,
        orderBlocks: [],
        unmitigatedBullishBlocks: [],
        unmitigatedBearishBlocks: [],
        swingBlocks: [],
        internalBlocks: [],
      };
    }

    const detectedBlocks: SmcOrderBlock[] = [];

    // Analyze each structure break confirmed in Phase 2
    for (const sBreak of structureBreaks) {
      const ob = this.findOrderBlockForBreak(candles, sBreak, timeframe, symbol);
      if (ob) {
        // Prevent duplicate blocks if two breaks originated from the same base candle
        const exists = detectedBlocks.some(
          (b) => b.originCandleTimestamp === ob.originCandleTimestamp && b.type === ob.type,
        );
        if (!exists) {
          detectedBlocks.push(ob);
        }
      }
    }

    // Sort order blocks chronologically (newest first)
    detectedBlocks.sort((a, b) => b.originCandleTimestamp - a.originCandleTimestamp);

    const unmitigatedBullishBlocks = detectedBlocks.filter(
      (b) => b.type === 'BULLISH_OB' && (b.mitigationState === 'UNMITIGATED' || b.mitigationState === 'PARTIALLY_MITIGATED'),
    );

    const unmitigatedBearishBlocks = detectedBlocks.filter(
      (b) => b.type === 'BEARISH_OB' && (b.mitigationState === 'UNMITIGATED' || b.mitigationState === 'PARTIALLY_MITIGATED'),
    );

    const swingBlocks = detectedBlocks.filter((b) => b.scope === 'SWING');
    const internalBlocks = detectedBlocks.filter((b) => b.scope === 'INTERNAL');

    return {
      symbol,
      timeframe,
      calculatedAt,
      orderBlocks: detectedBlocks,
      unmitigatedBullishBlocks,
      unmitigatedBearishBlocks,
      swingBlocks,
      internalBlocks,
    };
  }

  /**
   * Identifies the base order block candle that preceded a specific structure break.
   */
  private static findOrderBlockForBreak(
    candles: readonly Candle[],
    sBreak: StructureBreakEvent,
    timeframe: StructuralTimeframe,
    symbol: InstrumentSymbol,
  ): SmcOrderBlock | null {
    const triggerIndex = sBreak.triggerCandleIndex;
    if (triggerIndex <= 0 || triggerIndex >= candles.length) {
      return null;
    }

    const isBullishBreak = sBreak.direction === 'BULLISH';
    const targetType: OrderBlockType = isBullishBreak ? 'BULLISH_OB' : 'BEARISH_OB';

    // Look backward from the break trigger candle (up to 12 bars back) to find the origin base candle
    const maxLookback = Math.min(12, triggerIndex);
    let baseCandleIndex = -1;

    if (isBullishBreak) {
      // For Bullish Break: Find the last down-close candle (close < open) prior to the bullish impulse
      for (let i = triggerIndex - 1; i >= triggerIndex - maxLookback; i--) {
        if (candles[i].close < candles[i].open) {
          baseCandleIndex = i;
          break;
        }
      }
      // Fallback: If no down-close candle was found, select the candle with the lowest low in the impulse
      if (baseCandleIndex === -1) {
        let lowestLow = Infinity;
        for (let i = triggerIndex - 1; i >= triggerIndex - maxLookback; i--) {
          if (candles[i].low < lowestLow) {
            lowestLow = candles[i].low;
            baseCandleIndex = i;
          }
        }
      }
    } else {
      // For Bearish Break: Find the last up-close candle (close > open) prior to the bearish impulse
      for (let i = triggerIndex - 1; i >= triggerIndex - maxLookback; i--) {
        if (candles[i].close > candles[i].open) {
          baseCandleIndex = i;
          break;
        }
      }
      // Fallback: lowest high or highest high in the impulse
      if (baseCandleIndex === -1) {
        let highestHigh = -Infinity;
        for (let i = triggerIndex - 1; i >= triggerIndex - maxLookback; i--) {
          if (candles[i].high > highestHigh) {
            highestHigh = candles[i].high;
            baseCandleIndex = i;
          }
        }
      }
    }

    if (baseCandleIndex === -1) {
      return null;
    }

    const baseCandle = candles[baseCandleIndex];
    const highPrice = baseCandle.high;
    const lowPrice = baseCandle.low;
    const meanThresholdPrice = MarketDataNormalization.roundToPrecision(
      (highPrice + lowPrice) / 2,
      symbol,
    );
    const invalidationPrice = isBullishBreak ? lowPrice : highPrice;

    // Check displacement impulse magnitude (distance from base candle close to break price)
    const displacementDelta = Math.abs(sBreak.breakPrice - baseCandle.close);
    const displacementPips = MarketDataNormalization.priceDeltaToPips(displacementDelta, symbol);

    // Check if immediate subsequent candle left an imbalance (FVG check)
    let leavesImbalance = false;
    if (baseCandleIndex + 2 < candles.length) {
      const c1 = baseCandle;
      const c3 = candles[baseCandleIndex + 2];
      if (isBullishBreak && c3.low > c1.high) {
        leavesImbalance = true;
      } else if (!isBullishBreak && c3.high < c1.low) {
        leavesImbalance = true;
      }
    }

    // Track mitigation lifecycle across all candles AFTER the displacement impulse
    const { mitigationState, isMitigated, mitigationPercentage, mitigationTimestamp } =
      this.evaluateObMitigation(candles, baseCandleIndex, targetType, highPrice, lowPrice, meanThresholdPrice);

    // Compute quality score (0 - 100)
    let qualityScore = 50;
    if (sBreak.scope === 'SWING') qualityScore += 20; // Swing breaks possess institutional conviction
    if (leavesImbalance) qualityScore += 15; // Clean displacement leaving FVG
    if (displacementPips >= 20) qualityScore += 15;
    if (mitigationState === 'UNMITIGATED') qualityScore += 10;
    else if (mitigationState === 'PARTIALLY_MITIGATED') qualityScore -= 10;
    else if (mitigationState === 'FULLY_MITIGATED') qualityScore -= 30;
    else if (mitigationState === 'INVALIDATED') qualityScore = 0;

    qualityScore = Math.max(0, Math.min(100, qualityScore));

    const id = `OB_${sBreak.scope}_${targetType}_${symbol}_${baseCandle.timestamp}`;

    return {
      id,
      symbol,
      timeframe,
      type: targetType,
      scope: sBreak.scope,
      highPrice,
      lowPrice,
      openPrice: baseCandle.open,
      closePrice: baseCandle.close,
      meanThresholdPrice,
      invalidationPrice,
      originCandleTimestamp: baseCandle.timestamp,
      originCandleIndex: baseCandleIndex,
      isMitigated,
      mitigationTimestamp,
      mitigationPercentage,
      qualityScore,
      mitigationState,
      triggerBreakId: sBreak.id,
      triggerBreakScope: sBreak.scope,
      triggerBreakType: sBreak.type,
      displacementPips,
      leavesImbalance,
    };
  }

  /**
   * Evaluates the mitigation state of an Order Block across subsequent candles.
   */
  private static evaluateObMitigation(
    candles: readonly Candle[],
    baseCandleIndex: number,
    type: OrderBlockType,
    highPrice: number,
    lowPrice: number,
    meanThresholdPrice: number,
  ): {
    mitigationState: ObMitigationState;
    isMitigated: boolean;
    mitigationPercentage: number;
    mitigationTimestamp?: number;
  } {
    // Only inspect candles after the base candle + 1 (allow impulse to develop)
    const subsequent = candles.slice(baseCandleIndex + 2);
    if (subsequent.length === 0) {
      return {
        mitigationState: 'UNMITIGATED',
        isMitigated: false,
        mitigationPercentage: 0,
      };
    }

    let isMitigated = false;
    let mitigationState: ObMitigationState = 'UNMITIGATED';
    let mitigationPercentage = 0;
    let mitigationTimestamp: number | undefined;

    const zoneRange = Math.max(0.00001, highPrice - lowPrice);

    for (const c of subsequent) {
      if (type === 'BULLISH_OB') {
        // Bullish OB: Zone is [lowPrice, highPrice]. Invalidation is body close below lowPrice.
        if (c.close < lowPrice) {
          return {
            mitigationState: 'INVALIDATED',
            isMitigated: true,
            mitigationPercentage: 100,
            mitigationTimestamp: c.timestamp,
          };
        }

        // Check if price retraced into the zone
        if (c.low <= highPrice) {
          const penetration = highPrice - c.low;
          const ratio = Math.min(1.0, Math.max(0, penetration / zoneRange));
          mitigationPercentage = Math.max(mitigationPercentage, Math.round(ratio * 100));

          if (c.low <= meanThresholdPrice) {
            // Penetrated 50% Mean Threshold -> FULLY_MITIGATED
            mitigationState = 'FULLY_MITIGATED';
            isMitigated = true;
            if (!mitigationTimestamp) mitigationTimestamp = c.timestamp;
          } else if (mitigationState === 'UNMITIGATED') {
            mitigationState = 'PARTIALLY_MITIGATED';
            if (!mitigationTimestamp) mitigationTimestamp = c.timestamp;
          }
        }
      } else {
        // Bearish OB: Zone is [lowPrice, highPrice]. Invalidation is body close above highPrice.
        if (c.close > highPrice) {
          return {
            mitigationState: 'INVALIDATED',
            isMitigated: true,
            mitigationPercentage: 100,
            mitigationTimestamp: c.timestamp,
          };
        }

        // Check if price retraced into the zone
        if (c.high >= lowPrice) {
          const penetration = c.high - lowPrice;
          const ratio = Math.min(1.0, Math.max(0, penetration / zoneRange));
          mitigationPercentage = Math.max(mitigationPercentage, Math.round(ratio * 100));

          if (c.high >= meanThresholdPrice) {
            // Penetrated 50% Mean Threshold -> FULLY_MITIGATED
            mitigationState = 'FULLY_MITIGATED';
            isMitigated = true;
            if (!mitigationTimestamp) mitigationTimestamp = c.timestamp;
          } else if (mitigationState === 'UNMITIGATED') {
            mitigationState = 'PARTIALLY_MITIGATED';
            if (!mitigationTimestamp) mitigationTimestamp = c.timestamp;
          }
        }
      }
    }

    return {
      mitigationState,
      isMitigated,
      mitigationPercentage,
      mitigationTimestamp,
    };
  }
}
