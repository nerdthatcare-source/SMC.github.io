/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SMC Fair Value Gap (FVG) Imbalance Engine
 *
 * Detects, validates, and tracks institutional 3-candle Fair Value Gaps:
 * 1. Bullish FVG (BISI - Buyside Imbalance Sellside Inefficiency):
 *    Strict condition: low[3] > high[1] (with candle 2 being an expansive bullish displacement).
 *    Imbalance range: bottomPrice = high[1], topPrice = low[3].
 * 2. Bearish FVG (SIBI - Sellside Imbalance Buyside Inefficiency):
 *    Strict condition: high[3] < low[1] (with candle 2 being an expansive bearish displacement).
 *    Imbalance range: topPrice = high[3], bottomPrice = low[1].
 * 3. 50% Consequent Encroachment (CE):
 *    The exact 50% midpoint: (topPrice + bottomPrice) / 2.
 *    Acts as the primary institutional target and defense line for algorithmic rebalancing.
 * 4. Lifecycle State Machine:
 *    UNMITIGATED -> PARTIALLY_MITIGATED -> FULLY_MITIGATED -> INVALIDATED
 *    - UNMITIGATED: Clean imbalance, 0% mitigation.
 *    - PARTIALLY_MITIGATED: Price retraced into the gap but did not touch 50% CE.
 *    - FULLY_MITIGATED: Price tapped or pierced 50% CE (fair value rebalanced).
 *    - INVALIDATED: Candle body closed completely through the opposing boundary.
 *      Flips polarity to become an Inversion FVG (IFVG).
 *
 * Pure calculation: No I/O, consumes canonical candles.
 */

import {
  Candle,
  FairValueGapType,
  FairValueGapZone,
  InstrumentSymbol,
  StructuralTimeframe,
} from '../types/smc';
import { assertStructuralTimeframe } from './canonicalDataContracts';
import { MarketDataNormalization } from './marketDataNormalization';

export type FvgMitigationState =
  | 'UNMITIGATED'
  | 'PARTIALLY_MITIGATED'
  | 'FULLY_MITIGATED'
  | 'INVALIDATED';

export interface SmcFairValueGap extends FairValueGapZone {
  readonly mitigationState: FvgMitigationState;
  readonly gapSize: number;
  readonly gapSizePips: number;
  readonly candle1Index: number;
  readonly candle2Index: number;
  readonly candle3Index: number;
  readonly mitigationTimestamp?: number;
  readonly invalidationTimestamp?: number;
  readonly qualityScore: number; // 0 - 100
}

export interface FvgAnalysisReport {
  readonly symbol: InstrumentSymbol;
  readonly timeframe: StructuralTimeframe;
  readonly calculatedAt: number;
  readonly totalGapsDetected: number;
  readonly allGaps: readonly SmcFairValueGap[];
  readonly unmitigatedBisiGaps: readonly SmcFairValueGap[];
  readonly unmitigatedSibiGaps: readonly SmcFairValueGap[];
  readonly activeInversionGaps: readonly SmcFairValueGap[];
  readonly nearestBullishFvg: SmcFairValueGap | null;
  readonly nearestBearishFvg: SmcFairValueGap | null;
}

export class SmcFvgEngine {
  /**
   * Pure calculation: Scans candles for 3-bar Fair Value Gaps and tracks their complete lifecycle.
   */
  public static detectFairValueGaps(
    candles: readonly Candle[],
    timeframe: StructuralTimeframe,
  ): FvgAnalysisReport {
    assertStructuralTimeframe(timeframe);

    if (!candles || candles.length < 3) {
      return {
        symbol: candles?.[0]?.symbol ?? 'EUR_USD',
        timeframe,
        calculatedAt: Date.now(),
        totalGapsDetected: 0,
        allGaps: [],
        unmitigatedBisiGaps: [],
        unmitigatedSibiGaps: [],
        activeInversionGaps: [],
        nearestBullishFvg: null,
        nearestBearishFvg: null,
      };
    }

    const symbol = candles[0].symbol;
    const latestCandle = candles[candles.length - 1];
    const calculatedAt = latestCandle.timestamp;
    const currentPrice = latestCandle.close;

    const detectedGaps: SmcFairValueGap[] = [];

    // Scan through all 3-candle triplets [i - 2, i - 1, i]
    for (let i = 2; i < candles.length; i++) {
      const c1 = candles[i - 2];
      const c2 = candles[i - 1];
      const c3 = candles[i];

      // Check Bullish FVG (BISI): c3.low > c1.high
      if (c3.low > c1.high && c2.close > c2.open) {
        const bottomPrice = c1.high;
        const topPrice = c3.low;
        const gapSize = topPrice - bottomPrice;

        // Filter out microscopic zero/sub-pip noise
        if (gapSize > 0.00001) {
          const cePrice = MarketDataNormalization.roundToPrecision(
            (topPrice + bottomPrice) / 2,
            symbol,
          );
          const gapSizePips = MarketDataNormalization.priceDeltaToPips(gapSize, symbol);

          // Evaluate mitigation lifecycle using subsequent candles from i + 1 onward
          const subsequentCandles = candles.slice(i + 1);
          const {
            mitigationState,
            mitigationRatio,
            isMitigated,
            mitigationTimestamp,
            isInversionFVG,
            invalidationTimestamp,
          } = this.evaluateBisiMitigation(subsequentCandles, bottomPrice, topPrice, cePrice);

          const id = `FVG_BISI_${symbol}_${c2.timestamp}`;

          // Quality score calculation
          let qualityScore = 60;
          if (gapSizePips >= 5) qualityScore += 15;
          if (mitigationState === 'UNMITIGATED') qualityScore += 20;
          else if (mitigationState === 'PARTIALLY_MITIGATED') qualityScore -= 10;
          else if (mitigationState === 'FULLY_MITIGATED') qualityScore -= 30;
          else if (mitigationState === 'INVALIDATED') qualityScore = isInversionFVG ? 40 : 0;

          detectedGaps.push({
            id,
            symbol,
            timeframe,
            type: 'BISI',
            topPrice,
            bottomPrice,
            consequentEncroachmentPrice: cePrice,
            candle1Timestamp: c1.timestamp,
            candle2Timestamp: c2.timestamp,
            candle3Timestamp: c3.timestamp,
            candle1Index: i - 2,
            candle2Index: i - 1,
            candle3Index: i,
            gapSize,
            gapSizePips,
            isMitigated,
            mitigationRatio,
            mitigationState,
            mitigationTimestamp,
            isInversionFVG,
            invalidationTimestamp,
            qualityScore: Math.max(0, Math.min(100, qualityScore)),
          });
        }
      }

      // Check Bearish FVG (SIBI): c3.high < c1.low
      if (c3.high < c1.low && c2.close < c2.open) {
        const topPrice = c3.high;
        const bottomPrice = c1.low;
        const gapSize = bottomPrice - topPrice;

        if (gapSize > 0.00001) {
          const cePrice = MarketDataNormalization.roundToPrecision(
            (topPrice + bottomPrice) / 2,
            symbol,
          );
          const gapSizePips = MarketDataNormalization.priceDeltaToPips(gapSize, symbol);

          // Evaluate mitigation lifecycle
          const subsequentCandles = candles.slice(i + 1);
          const {
            mitigationState,
            mitigationRatio,
            isMitigated,
            mitigationTimestamp,
            isInversionFVG,
            invalidationTimestamp,
          } = this.evaluateSibiMitigation(subsequentCandles, topPrice, bottomPrice, cePrice);

          const id = `FVG_SIBI_${symbol}_${c2.timestamp}`;

          let qualityScore = 60;
          if (gapSizePips >= 5) qualityScore += 15;
          if (mitigationState === 'UNMITIGATED') qualityScore += 20;
          else if (mitigationState === 'PARTIALLY_MITIGATED') qualityScore -= 10;
          else if (mitigationState === 'FULLY_MITIGATED') qualityScore -= 30;
          else if (mitigationState === 'INVALIDATED') qualityScore = isInversionFVG ? 40 : 0;

          detectedGaps.push({
            id,
            symbol,
            timeframe,
            type: 'SIBI',
            topPrice,
            bottomPrice,
            consequentEncroachmentPrice: cePrice,
            candle1Timestamp: c1.timestamp,
            candle2Timestamp: c2.timestamp,
            candle3Timestamp: c3.timestamp,
            candle1Index: i - 2,
            candle2Index: i - 1,
            candle3Index: i,
            gapSize,
            gapSizePips,
            isMitigated,
            mitigationRatio,
            mitigationState,
            mitigationTimestamp,
            isInversionFVG,
            invalidationTimestamp,
            qualityScore: Math.max(0, Math.min(100, qualityScore)),
          });
        }
      }
    }

    // Sort chronologically (newest first)
    detectedGaps.sort((a, b) => b.candle2Timestamp - a.candle2Timestamp);

    const unmitigatedBisiGaps = detectedGaps.filter(
      (g) => g.type === 'BISI' && (g.mitigationState === 'UNMITIGATED' || g.mitigationState === 'PARTIALLY_MITIGATED'),
    );

    const unmitigatedSibiGaps = detectedGaps.filter(
      (g) => g.type === 'SIBI' && (g.mitigationState === 'UNMITIGATED' || g.mitigationState === 'PARTIALLY_MITIGATED'),
    );

    const activeInversionGaps = detectedGaps.filter((g) => g.isInversionFVG);

    // Nearest bullish FVG below current price (acting as resting discount support)
    const intactBullish = unmitigatedBisiGaps
      .filter((g) => g.topPrice <= currentPrice)
      .sort((a, b) => b.topPrice - a.topPrice);
    const nearestBullishFvg = intactBullish.length > 0 ? intactBullish[0] : null;

    // Nearest bearish FVG above current price (acting as resting premium resistance)
    const intactBearish = unmitigatedSibiGaps
      .filter((g) => g.topPrice >= currentPrice)
      .sort((a, b) => a.topPrice - b.topPrice);
    const nearestBearishFvg = intactBearish.length > 0 ? intactBearish[0] : null;

    return {
      symbol,
      timeframe,
      calculatedAt,
      totalGapsDetected: detectedGaps.length,
      allGaps: detectedGaps,
      unmitigatedBisiGaps,
      unmitigatedSibiGaps,
      activeInversionGaps,
      nearestBullishFvg,
      nearestBearishFvg,
    };
  }

  /**
   * Tracks lifecycle for a Bullish FVG (BISI):
   * Gap spans bottomPrice (c1.high) to topPrice (c3.low).
   */
  private static evaluateBisiMitigation(
    candles: readonly Candle[],
    bottomPrice: number,
    topPrice: number,
    cePrice: number,
  ): {
    mitigationState: FvgMitigationState;
    mitigationRatio: number;
    isMitigated: boolean;
    mitigationTimestamp?: number;
    isInversionFVG: boolean;
    invalidationTimestamp?: number;
  } {
    if (candles.length === 0) {
      return {
        mitigationState: 'UNMITIGATED',
        mitigationRatio: 0,
        isMitigated: false,
        isInversionFVG: false,
      };
    }

    const gapHeight = Math.max(0.00001, topPrice - bottomPrice);
    let mitigationState: FvgMitigationState = 'UNMITIGATED';
    let maxPenetration = 0;
    let mitigationTimestamp: number | undefined;
    let isInversionFVG = false;
    let invalidationTimestamp: number | undefined;

    for (const c of candles) {
      // Invalidation: candle body closed below bottomPrice
      if (c.close < bottomPrice) {
        mitigationState = 'INVALIDATED';
        isInversionFVG = true; // Inverted into bearish resistance
        invalidationTimestamp = c.timestamp;
        if (!mitigationTimestamp) mitigationTimestamp = c.timestamp;
        maxPenetration = gapHeight;
        break;
      }

      // Check retracement into the gap
      if (c.low <= topPrice) {
        const penetration = topPrice - c.low;
        if (penetration > maxPenetration) {
          maxPenetration = Math.min(gapHeight, penetration);
        }

        if (c.low <= cePrice) {
          // Reached or pierced 50% Consequent Encroachment
          mitigationState = 'FULLY_MITIGATED';
          if (!mitigationTimestamp) mitigationTimestamp = c.timestamp;
        } else if (mitigationState === 'UNMITIGATED') {
          mitigationState = 'PARTIALLY_MITIGATED';
          if (!mitigationTimestamp) mitigationTimestamp = c.timestamp;
        }
      }
    }

    const mitigationRatio = Math.round((maxPenetration / gapHeight) * 100) / 100;
    const isMitigated = mitigationState === 'FULLY_MITIGATED' || mitigationState === 'INVALIDATED';

    return {
      mitigationState,
      mitigationRatio,
      isMitigated,
      mitigationTimestamp,
      isInversionFVG,
      invalidationTimestamp,
    };
  }

  /**
   * Tracks lifecycle for a Bearish FVG (SIBI):
   * Gap spans topPrice (c3.high) to bottomPrice (c1.low).
   */
  private static evaluateSibiMitigation(
    candles: readonly Candle[],
    topPrice: number,
    bottomPrice: number,
    cePrice: number,
  ): {
    mitigationState: FvgMitigationState;
    mitigationRatio: number;
    isMitigated: boolean;
    mitigationTimestamp?: number;
    isInversionFVG: boolean;
    invalidationTimestamp?: number;
  } {
    if (candles.length === 0) {
      return {
        mitigationState: 'UNMITIGATED',
        mitigationRatio: 0,
        isMitigated: false,
        isInversionFVG: false,
      };
    }

    const gapHeight = Math.max(0.00001, bottomPrice - topPrice);
    let mitigationState: FvgMitigationState = 'UNMITIGATED';
    let maxPenetration = 0;
    let mitigationTimestamp: number | undefined;
    let isInversionFVG = false;
    let invalidationTimestamp: number | undefined;

    for (const c of candles) {
      // Invalidation: candle body closed above bottomPrice (the upper boundary of SIBI)
      if (c.close > bottomPrice) {
        mitigationState = 'INVALIDATED';
        isInversionFVG = true; // Inverted into bullish support
        invalidationTimestamp = c.timestamp;
        if (!mitigationTimestamp) mitigationTimestamp = c.timestamp;
        maxPenetration = gapHeight;
        break;
      }

      // Check retracement into the gap
      if (c.high >= topPrice) {
        const penetration = c.high - topPrice;
        if (penetration > maxPenetration) {
          maxPenetration = Math.min(gapHeight, penetration);
        }

        if (c.high >= cePrice) {
          // Reached or pierced 50% Consequent Encroachment
          mitigationState = 'FULLY_MITIGATED';
          if (!mitigationTimestamp) mitigationTimestamp = c.timestamp;
        } else if (mitigationState === 'UNMITIGATED') {
          mitigationState = 'PARTIALLY_MITIGATED';
          if (!mitigationTimestamp) mitigationTimestamp = c.timestamp;
        }
      }
    }

    const mitigationRatio = Math.round((maxPenetration / gapHeight) * 100) / 100;
    const isMitigated = mitigationState === 'FULLY_MITIGATED' || mitigationState === 'INVALIDATED';

    return {
      mitigationState,
      mitigationRatio,
      isMitigated,
      mitigationTimestamp,
      isInversionFVG,
      invalidationTimestamp,
    };
  }
}
