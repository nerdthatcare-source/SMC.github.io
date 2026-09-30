/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Canonical Structure Engine
 *
 * Deterministic fractal swing point detection and classification.
 *
 * HARD INVARIANTS:
 * - 1H and 15M use 3/3 lookback (3 left bars, 3 right bars).
 * - 5M uses 2/2 lookback (2 left bars, 2 right bars).
 * - 1M is STRICTLY FORBIDDEN from structural calculation (throws invariant error).
 * - Swings are classified as HH, HL, LH, LL.
 * - Vulnerability is classified: INTACT_LIQUIDITY vs BROKEN_SWEPT.
 * - Pure calculation: Candles in, canonical swing points out.
 */

import {
  Candle,
  InstrumentSymbol,
  StructuralTimeframe,
  SwingPoint,
  SwingPointType,
  SwingStrength,
} from '../types/smc';
import { assertStructuralTimeframe } from './canonicalDataContracts';

export type SwingClassification = 'HH' | 'LH' | 'HL' | 'LL';

export type SwingVulnerability = 'INTACT_LIQUIDITY' | 'BROKEN_SWEPT';

export interface CanonicalSwingPoint extends SwingPoint {
  readonly classification: SwingClassification;
  readonly vulnerability: SwingVulnerability;
  readonly leftBarsLookback: number;
  readonly rightBarsLookback: number;
  readonly breakerCandleIndex?: number;
}

export interface SwingDetectionOptions {
  readonly lookbackLeft?: number;
  readonly lookbackRight?: number;
}

export class CanonicalStructureEngine {
  /**
   * Lookback parameters enforced per timeframe:
   * 1H: 3 / 3
   * 15M: 3 / 3
   * 5M: 2 / 2
   */
  public static getLookbackForTimeframe(timeframe: StructuralTimeframe): {
    readonly leftBars: number;
    readonly rightBars: number;
  } {
    assertStructuralTimeframe(timeframe);

    switch (timeframe) {
      case '1H':
      case '15M':
        return { leftBars: 3, rightBars: 3 };
      case '5M':
        return { leftBars: 2, rightBars: 2 };
    }
  }

  /**
   * Deterministically detects fractal swing points across a chronological series of candles.
   * Pure function: no I/O, no side effects.
   */
  public static detectCanonicalSwings(
    candles: readonly Candle[],
    timeframe: StructuralTimeframe,
    options?: SwingDetectionOptions,
  ): readonly CanonicalSwingPoint[] {
    assertStructuralTimeframe(timeframe);

    if (!candles || candles.length === 0) {
      return [];
    }

    const defaultLookback = this.getLookbackForTimeframe(timeframe);
    const leftBars = options?.lookbackLeft ?? defaultLookback.leftBars;
    const rightBars = options?.lookbackRight ?? defaultLookback.rightBars;

    const minCandlesRequired = leftBars + rightBars + 1;
    if (candles.length < minCandlesRequired) {
      return [];
    }

    const rawSwings: {
      type: SwingPointType;
      candleIndex: number;
      candle: Candle;
      price: number;
    }[] = [];

    // Scan candles from leftBars to (candles.length - 1 - rightBars)
    // Only completed confirmed swings (meaning rightBars have concluded)
    for (let i = leftBars; i < candles.length - rightBars; i++) {
      const current = candles[i];

      // Check Swing High
      let isSwingHigh = true;
      for (let l = 1; l <= leftBars; l++) {
        if (candles[i - l].high >= current.high) {
          isSwingHigh = false;
          break;
        }
      }
      if (isSwingHigh) {
        for (let r = 1; r <= rightBars; r++) {
          if (candles[i + r].high > current.high) {
            isSwingHigh = false;
            break;
          }
        }
      }

      if (isSwingHigh) {
        rawSwings.push({
          type: 'SWING_HIGH',
          candleIndex: i,
          candle: current,
          price: current.high,
        });
      }

      // Check Swing Low
      let isSwingLow = true;
      for (let l = 1; l <= leftBars; l++) {
        if (candles[i - l].low <= current.low) {
          isSwingLow = false;
          break;
        }
      }
      if (isSwingLow) {
        for (let r = 1; r <= rightBars; r++) {
          if (candles[i + r].low < current.low) {
            isSwingLow = false;
            break;
          }
        }
      }

      if (isSwingLow) {
        rawSwings.push({
          type: 'SWING_LOW',
          candleIndex: i,
          candle: current,
          price: current.low,
        });
      }
    }

    // Sort by candle index ascending
    rawSwings.sort((a, b) => a.candleIndex - b.candleIndex);

    // Track sequential HH, HL, LH, LL and vulnerability
    let prevSwingHigh: CanonicalSwingPoint | null = null;
    let prevSwingLow: CanonicalSwingPoint | null = null;

    const result: CanonicalSwingPoint[] = [];

    for (const raw of rawSwings) {
      let classification: SwingClassification;

      if (raw.type === 'SWING_HIGH') {
        if (!prevSwingHigh) {
          classification = 'HH'; // Initial baseline high
        } else if (raw.price > prevSwingHigh.price) {
          classification = 'HH';
        } else {
          classification = 'LH';
        }
      } else {
        if (!prevSwingLow) {
          classification = 'LL'; // Initial baseline low
        } else if (raw.price >= prevSwingLow.price) {
          classification = 'HL';
        } else {
          classification = 'LL';
        }
      }

      // Check vulnerability: Has subsequent price breached this swing level?
      let isBroken = false;
      let brokenAtTimestamp: number | undefined;
      let breakerCandleIndex: number | undefined;

      // Start check right after confirmation (raw.candleIndex + rightBars)
      for (let k = raw.candleIndex + 1; k < candles.length; k++) {
        const futureCandle = candles[k];
        if (raw.type === 'SWING_HIGH' && futureCandle.high > raw.price) {
          isBroken = true;
          brokenAtTimestamp = futureCandle.timestamp;
          breakerCandleIndex = k;
          break;
        } else if (raw.type === 'SWING_LOW' && futureCandle.low < raw.price) {
          isBroken = true;
          brokenAtTimestamp = futureCandle.timestamp;
          breakerCandleIndex = k;
          break;
        }
      }

      const vulnerability: SwingVulnerability = isBroken
        ? 'BROKEN_SWEPT'
        : 'INTACT_LIQUIDITY';

      // Default intermediate strength prior to structure break analysis
      const strength: SwingStrength = isBroken ? 'WEAK' : 'STRONG';

      const swingId = `sw_${raw.candle.symbol}_${timeframe}_${raw.candle.timestamp}_${raw.type}`;

      const swingPoint: CanonicalSwingPoint = {
        id: swingId,
        symbol: raw.candle.symbol as InstrumentSymbol,
        timeframe,
        type: raw.type,
        price: raw.price,
        timestamp: raw.candle.timestamp,
        candleIndex: raw.candleIndex,
        strength,
        classification,
        vulnerability,
        isBroken,
        brokenAtTimestamp,
        breakerCandleIndex,
        leftBarsLookback: leftBars,
        rightBarsLookback: rightBars,
      };

      if (raw.type === 'SWING_HIGH') {
        prevSwingHigh = swingPoint;
      } else {
        prevSwingLow = swingPoint;
      }

      result.push(swingPoint);
    }

    return result;
  }
}
