/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SMC Market Structure Engine
 *
 * Detects Break of Structure (BOS) and Change of Character (CHoCH) events.
 *
 * SMC RULES ENFORCED:
 * 1. Confirmation strictly requires a full candle BODY CLOSE beyond the swing level.
 *    Wicks that pierce without closing are classified as liquidity sweeps, NOT structure breaks.
 * 2. Break of Structure (BOS): Candle closes beyond swing in the SAME direction as prevailing trend (continuation).
 * 3. Change of Character (CHoCH): Candle closes beyond swing in the OPPOSITE direction (reversal warning).
 * 4. Tagging with scope: SWING (major external structural pivots) or INTERNAL (sub-swings).
 * 5. Returns a comprehensive TimeframeStructureAnalysis report.
 */

import {
  Candle,
  DirectionalBias,
  InstrumentSymbol,
  MarketRegimeType,
  StructuralTimeframe,
  StructureBreak,
  StructureBreakType,
} from '../types/smc';
import { assertStructuralTimeframe } from './canonicalDataContracts';
import {
  CanonicalStructureEngine,
  CanonicalSwingPoint,
} from './canonicalStructureEngine';

export type StructureBreakScope = 'SWING' | 'INTERNAL';

export interface StructureBreakEvent extends StructureBreak {
  readonly scope: StructureBreakScope;
  readonly brokenSwingPrice: number;
  readonly closePrice: number;
  readonly triggerCandleIndex: number;
  readonly triggerCandleTimeIso: string;
}

export interface ActiveTrendLeg {
  readonly direction: 'BULLISH' | 'BEARISH';
  readonly startSwing: CanonicalSwingPoint;
  readonly currentExtreme: CanonicalSwingPoint;
  readonly priceRange: number;
}

export interface TimeframeStructureAnalysis {
  readonly symbol: InstrumentSymbol;
  readonly timeframe: StructuralTimeframe;
  readonly analyzedAt: number;
  readonly trendBias: DirectionalBias;
  readonly marketRegime: MarketRegimeType;
  readonly swings: readonly CanonicalSwingPoint[];
  readonly structureBreaks: readonly StructureBreakEvent[];
  readonly latestBreak: StructureBreakEvent | null;
  readonly activeTrendLeg: ActiveTrendLeg | null;
  readonly intactSwingHighs: readonly CanonicalSwingPoint[];
  readonly intactSwingLows: readonly CanonicalSwingPoint[];
}

export class SmcMarketStructureEngine {
  /**
   * Pure calculation: Analyzes canonical candles and detects validated BOS/CHoCH events.
   * Throws if 1M timeframe is passed (structural quarantine).
   */
  public static analyzeTimeframeStructure(
    candles: readonly Candle[],
    timeframe: StructuralTimeframe,
  ): TimeframeStructureAnalysis {
    assertStructuralTimeframe(timeframe);

    if (!candles || candles.length === 0) {
      return {
        symbol: 'EUR_USD',
        timeframe,
        analyzedAt: Date.now(),
        trendBias: 'NEUTRAL',
        marketRegime: 'CONSOLIDATION_RANGE',
        swings: [],
        structureBreaks: [],
        latestBreak: null,
        activeTrendLeg: null,
        intactSwingHighs: [],
        intactSwingLows: [],
      };
    }

    const symbol = candles[0].symbol;

    // 1. Detect deterministic canonical swings
    const swings = CanonicalStructureEngine.detectCanonicalSwings(
      candles,
      timeframe,
    );

    if (swings.length === 0) {
      return {
        symbol,
        timeframe,
        analyzedAt: Date.now(),
        trendBias: 'NEUTRAL',
        marketRegime: 'CONSOLIDATION_RANGE',
        swings: [],
        structureBreaks: [],
        latestBreak: null,
        activeTrendLeg: null,
        intactSwingHighs: [],
        intactSwingLows: [],
      };
    }

    // 2. Track sequential breaks by scanning chronologically
    const structureBreaks: StructureBreakEvent[] = [];
    let currentTrend: DirectionalBias = 'NEUTRAL';

    // Build map of candle index -> candle
    const candleCount = candles.length;

    // Track active swing highs and lows that can be broken
    // A swing point is available to be broken from (swing.candleIndex + rightBars + 1)
    const confirmedHighs: CanonicalSwingPoint[] = [];
    const confirmedLows: CanonicalSwingPoint[] = [];
    const brokenSwingIds = new Set<string>();

    for (let cIdx = 0; cIdx < candleCount; cIdx++) {
      const candle = candles[cIdx];

      // Add swings that became confirmed by this candle
      for (const sw of swings) {
        if (sw.candleIndex + sw.rightBarsLookback === cIdx) {
          if (sw.type === 'SWING_HIGH') confirmedHighs.push(sw);
          else confirmedLows.push(sw);
        }
      }

      // Check candle body close against all unbroken confirmed swing highs
      for (const highSwing of confirmedHighs) {
        if (brokenSwingIds.has(highSwing.id)) continue;

        // SMC REQUIREMENT: Full candle body CLOSE above swing high
        if (candle.close > highSwing.price) {
          brokenSwingIds.add(highSwing.id);

          // Determine if BOS (continuation of bullish) or CHOCH (reversal from bearish/neutral)
          const isContinuation = currentTrend === 'BULLISH';
          const breakType: StructureBreakType = isContinuation ? 'BOS' : 'CHOCH';
          const scope: StructureBreakScope =
            highSwing.classification === 'HH' ? 'SWING' : 'INTERNAL';

          const breakEvent: StructureBreakEvent = {
            id: `sb_${symbol}_${timeframe}_${candle.timestamp}_BULLISH_${breakType}_${highSwing.id}`,
            symbol,
            timeframe,
            type: breakType,
            direction: 'BULLISH',
            breakPrice: candle.close,
            brokenSwingPointId: highSwing.id,
            brokenSwingPrice: highSwing.price,
            closePrice: candle.close,
            triggerCandleTimestamp: candle.timestamp,
            triggerCandleIndex: cIdx,
            triggerCandleTimeIso: candle.isoTimestamp,
            isConfirmedByCandleClose: true,
            scope,
          };

          structureBreaks.push(breakEvent);
          currentTrend = 'BULLISH';
        }
      }

      // Check candle body close against all unbroken confirmed swing lows
      for (const lowSwing of confirmedLows) {
        if (brokenSwingIds.has(lowSwing.id)) continue;

        // SMC REQUIREMENT: Full candle body CLOSE below swing low
        if (candle.close < lowSwing.price) {
          brokenSwingIds.add(lowSwing.id);

          const isContinuation = currentTrend === 'BEARISH';
          const breakType: StructureBreakType = isContinuation ? 'BOS' : 'CHOCH';
          const scope: StructureBreakScope =
            lowSwing.classification === 'LL' ? 'SWING' : 'INTERNAL';

          const breakEvent: StructureBreakEvent = {
            id: `sb_${symbol}_${timeframe}_${candle.timestamp}_BEARISH_${breakType}_${lowSwing.id}`,
            symbol,
            timeframe,
            type: breakType,
            direction: 'BEARISH',
            breakPrice: candle.close,
            brokenSwingPointId: lowSwing.id,
            brokenSwingPrice: lowSwing.price,
            closePrice: candle.close,
            triggerCandleTimestamp: candle.timestamp,
            triggerCandleIndex: cIdx,
            triggerCandleTimeIso: candle.isoTimestamp,
            isConfirmedByCandleClose: true,
            scope,
          };

          structureBreaks.push(breakEvent);
          currentTrend = 'BEARISH';
        }
      }
    }

    // 3. Determine Market Regime
    let marketRegime: MarketRegimeType = 'CONSOLIDATION_RANGE';
    const recentBreaks = structureBreaks.slice(-3);
    const bosCount = recentBreaks.filter((b) => b.type === 'BOS').length;
    const chochCount = recentBreaks.filter((b) => b.type === 'CHOCH').length;

    if (bosCount >= 2) {
      marketRegime = 'TRENDING_EXPANSION';
    } else if (chochCount >= 1) {
      marketRegime = currentTrend === 'BULLISH' ? 'ACCUMULATION' : 'DISTRIBUTION';
    } else {
      marketRegime = 'CONSOLIDATION_RANGE';
    }

    const latestBreak =
      structureBreaks.length > 0
        ? structureBreaks[structureBreaks.length - 1]
        : null;

    // 4. Identify Active Trend Leg
    let activeTrendLeg: ActiveTrendLeg | null = null;
    const swingHighs = swings.filter((s) => s.type === 'SWING_HIGH');
    const swingLows = swings.filter((s) => s.type === 'SWING_LOW');

    if (currentTrend === 'BULLISH' && swingLows.length > 0 && swingHighs.length > 0) {
      const lastLow = swingLows[swingLows.length - 1];
      const lastHigh = swingHighs[swingHighs.length - 1];
      activeTrendLeg = {
        direction: 'BULLISH',
        startSwing: lastLow,
        currentExtreme: lastHigh,
        priceRange: Math.abs(lastHigh.price - lastLow.price),
      };
    } else if (currentTrend === 'BEARISH' && swingHighs.length > 0 && swingLows.length > 0) {
      const lastHigh = swingHighs[swingHighs.length - 1];
      const lastLow = swingLows[swingLows.length - 1];
      activeTrendLeg = {
        direction: 'BEARISH',
        startSwing: lastHigh,
        currentExtreme: lastLow,
        priceRange: Math.abs(lastHigh.price - lastLow.price),
      };
    }

    // Unbroken intact swings
    const intactSwingHighs = swings.filter(
      (s) => s.type === 'SWING_HIGH' && !brokenSwingIds.has(s.id),
    );
    const intactSwingLows = swings.filter(
      (s) => s.type === 'SWING_LOW' && !brokenSwingIds.has(s.id),
    );

    return {
      symbol,
      timeframe,
      analyzedAt: Date.now(),
      trendBias: currentTrend,
      marketRegime,
      swings,
      structureBreaks,
      latestBreak,
      activeTrendLeg,
      intactSwingHighs,
      intactSwingLows,
    };
  }
}
