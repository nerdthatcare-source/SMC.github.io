/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SMC Dealing Range & Premium / Discount Engine
 *
 * Determines the active institutional dealing range defined by the bounding swing high
 * and swing low. Computes the mathematical 50.0% Equilibrium midpoint, Optimal Trade
 * Entry (OTE 61.8% - 79.0%), and categorizes price into institutional valuation zones.
 *
 * INSTITUTIONAL PRINCIPLES:
 * - Institutional Smart Money accumulates longs in DISCOUNT (< 50% Equilibrium).
 * - Institutional Smart Money distributes shorts in PREMIUM (> 50% Equilibrium).
 * - Equilibrium (50%) is fair value; positions taken at equilibrium lack statistical edge.
 *
 * Pure calculation: TimeframeStructureAnalysis + current price in, ActiveDealingRange out.
 */

import {
  InstrumentSymbol,
  PremiumDiscountZone,
  StructuralTimeframe,
  ValuationZone,
} from '../types/smc';
import { CanonicalSwingPoint } from './canonicalStructureEngine';
import { MarketDataNormalization } from './marketDataNormalization';
import { TimeframeStructureAnalysis } from './smcMarketStructureEngine';

export type DealingSubZone =
  | 'EXTREME_PREMIUM' // > 88.6% of range
  | 'PREMIUM' // 52% - 88.6%
  | 'EQUILIBRIUM_BUFFER' // 48% - 52% (Fair Value Neutral Zone)
  | 'DISCOUNT' // 11.4% - 48%
  | 'DEEP_DISCOUNT'; // < 11.4% of range

export interface ActiveDealingRange {
  readonly symbol: InstrumentSymbol;
  readonly timeframe: StructuralTimeframe;
  readonly calculatedAt: number;
  readonly definingHigh: CanonicalSwingPoint;
  readonly definingLow: CanonicalSwingPoint;
  readonly rangeHigh: number;
  readonly rangeLow: number;
  readonly rangeDelta: number;
  readonly rangeDeltaPips: number;
  readonly equilibriumPrice: number; // Exactly (rangeHigh + rangeLow) / 2
  readonly currentPrice: number;
  readonly currentPercentage: number; // 0.0% (at low) to 100.0% (at high)
  readonly zone: ValuationZone;
  readonly subZone: DealingSubZone;
  readonly optimalTradeEntryUpper: number; // 79.0% fib level
  readonly optimalTradeEntryLower: number; // 61.8% fib level
  readonly inOteZone: boolean;
  readonly canonicalZoneModel: PremiumDiscountZone;
}

export class SmcDealingRangeEngine {
  /**
   * Pure calculation: Extracts the active dealing range and evaluates valuation zones.
   */
  public static computeDealingRange(
    analysis: TimeframeStructureAnalysis,
    currentPrice: number,
  ): ActiveDealingRange | null {
    const { symbol, timeframe, swings } = analysis;

    if (swings.length < 2) {
      return null;
    }

    const swingHighs = swings.filter((s) => s.type === 'SWING_HIGH');
    const swingLows = swings.filter((s) => s.type === 'SWING_LOW');

    if (swingHighs.length === 0 || swingLows.length === 0) {
      return null;
    }

    // Defining high: The most prominent recent swing high bounding the current range
    // Look for the highest high among the last 3 swing highs
    const recentHighs = swingHighs.slice(-3);
    const definingHigh = recentHighs.reduce((max, cur) => (cur.price > max.price ? cur : max), recentHighs[0]);

    // Defining low: The lowest low among the last 3 swing lows
    const recentLows = swingLows.slice(-3);
    const definingLow = recentLows.reduce((min, cur) => (cur.price < min.price ? cur : min), recentLows[0]);

    if (definingHigh.price <= definingLow.price) {
      return null;
    }

    const rangeHigh = definingHigh.price;
    const rangeLow = definingLow.price;
    const rangeDelta = rangeHigh - rangeLow;
    const rangeDeltaPips = MarketDataNormalization.priceDeltaToPips(rangeDelta, symbol);

    // Mathematical 50% midpoint
    const equilibriumPrice = MarketDataNormalization.roundToPrecision(
      (rangeHigh + rangeLow) / 2,
      symbol,
    );

    // Percentage of price within the dealing range: 0% = rangeLow, 100% = rangeHigh
    const rawRatio = (currentPrice - rangeLow) / rangeDelta;
    const currentPercentage = Math.round(Math.max(0, Math.min(100, rawRatio * 100)) * 10) / 10;

    // Valuation Zone
    let zone: ValuationZone;
    if (currentPercentage < 25) {
      zone = 'DEEP_DISCOUNT';
    } else if (currentPercentage < 48) {
      zone = 'DISCOUNT';
    } else if (currentPercentage <= 52) {
      zone = 'EQUILIBRIUM';
    } else if (currentPercentage <= 75) {
      zone = 'PREMIUM';
    } else {
      zone = 'DEEP_PREMIUM';
    }

    // Sub-zone
    let subZone: DealingSubZone;
    if (currentPercentage > 88.6) {
      subZone = 'EXTREME_PREMIUM';
    } else if (currentPercentage > 52) {
      subZone = 'PREMIUM';
    } else if (currentPercentage >= 48) {
      subZone = 'EQUILIBRIUM_BUFFER';
    } else if (currentPercentage >= 11.4) {
      subZone = 'DISCOUNT';
    } else {
      subZone = 'DEEP_DISCOUNT';
    }

    // Optimal Trade Entry (OTE):
    // In bullish trend: OTE is 61.8% to 79.0% retracement down from rangeHigh into discount!
    // i.e., price between rangeHigh - 0.79 * rangeDelta and rangeHigh - 0.618 * rangeDelta
    // which equals rangeLow + 0.21 * rangeDelta to rangeLow + 0.382 * rangeDelta.
    // If bearish trend: OTE is 61.8% to 79.0% retracement up from rangeLow into premium!
    let oteUpper: number;
    let oteLower: number;

    if (analysis.trendBias === 'BULLISH') {
      oteUpper = MarketDataNormalization.roundToPrecision(rangeLow + 0.382 * rangeDelta, symbol);
      oteLower = MarketDataNormalization.roundToPrecision(rangeLow + 0.21 * rangeDelta, symbol);
    } else {
      // Bearish or neutral: OTE retracement upward into premium
      oteUpper = MarketDataNormalization.roundToPrecision(rangeLow + 0.79 * rangeDelta, symbol);
      oteLower = MarketDataNormalization.roundToPrecision(rangeLow + 0.618 * rangeDelta, symbol);
    }

    const inOteZone = currentPrice >= oteLower && currentPrice <= oteUpper;

    const canonicalZoneModel: PremiumDiscountZone = {
      symbol,
      timeframe,
      rangeHigh,
      rangeLow,
      equilibriumPrice,
      premiumThreshold: equilibriumPrice,
      discountThreshold: equilibriumPrice,
      optimalTradeEntryUpper: oteUpper,
      optimalTradeEntryLower: oteLower,
      currentZone: zone,
    };

    return {
      symbol,
      timeframe,
      calculatedAt: Date.now(),
      definingHigh,
      definingLow,
      rangeHigh,
      rangeLow,
      rangeDelta,
      rangeDeltaPips,
      equilibriumPrice,
      currentPrice,
      currentPercentage,
      zone,
      subZone,
      optimalTradeEntryUpper: oteUpper,
      optimalTradeEntryLower: oteLower,
      inOteZone,
      canonicalZoneModel,
    };
  }
}
