/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SMC Strong / Weak Structure Engine
 *
 * Classifies structural pivots into:
 * - STRONG PIVOT: The institutional anchor point that engineered the break of structure
 *   or took liquidity. This level is protected by institutional order flow; if violated,
 *   market character shifts (CHoCH).
 *   - Bullish Trend: Strong Low (protects the trend).
 *   - Bearish Trend: Strong High (protects the trend).
 * - WEAK TARGET: The unconfirmed swing point that represents the next resting liquidity pool
 *   expected to be swept or broken to continue trend expansion.
 *   - Bullish Trend: Weak High (buy-side liquidity target).
 *   - Bearish Trend: Weak Low (sell-side liquidity target).
 *
 * Pure calculation on TimeframeStructureAnalysis.
 */

import { DirectionalBias, InstrumentSymbol, StructuralTimeframe } from '../types/smc';
import { CanonicalSwingPoint } from './canonicalStructureEngine';
import { TimeframeStructureAnalysis } from './smcMarketStructureEngine';

export interface StrongWeakStructureReport {
  readonly symbol: InstrumentSymbol;
  readonly timeframe: StructuralTimeframe;
  readonly trendBias: DirectionalBias;
  readonly strongPivot: CanonicalSwingPoint | null;
  readonly weakTarget: CanonicalSwingPoint | null;
  readonly invalidationPrice: number | null; // Price level of the Strong Pivot
  readonly targetPrice: number | null; // Price level of the Weak Target
  readonly isProtected: boolean; // True if Strong Pivot is intact
  readonly rationales: readonly string[];
}

export class SmcStrongWeakStructureEngine {
  /**
   * Pure calculation: Given TimeframeStructureAnalysis, classifies the primary Strong Pivot
   * and Weak Target for the active dealing range.
   */
  public static classifyStrongWeakStructure(
    analysis: TimeframeStructureAnalysis,
  ): StrongWeakStructureReport {
    const { symbol, timeframe, trendBias, swings, structureBreaks } = analysis;
    const rationales: string[] = [];

    if (swings.length === 0) {
      return {
        symbol,
        timeframe,
        trendBias: 'NEUTRAL',
        strongPivot: null,
        weakTarget: null,
        invalidationPrice: null,
        targetPrice: null,
        isProtected: false,
        rationales: ['Insufficient swing points detected to establish strong/weak structure.'],
      };
    }

    let strongPivot: CanonicalSwingPoint | null = null;
    let weakTarget: CanonicalSwingPoint | null = null;

    const swingHighs = swings.filter((s) => s.type === 'SWING_HIGH');
    const swingLows = swings.filter((s) => s.type === 'SWING_LOW');

    if (trendBias === 'BULLISH') {
      // In a bullish trend:
      // Strong Low: The lowest swing low prior to the latest bullish BOS/CHoCH.
      // If no break, the most recent Higher Low (HL) or lowest intact low.
      const latestBullishBreak = [...structureBreaks]
        .reverse()
        .find((b) => b.direction === 'BULLISH');

      if (latestBullishBreak) {
        // Find swing lows preceding the break trigger
        const candidateLows = swingLows.filter(
          (s) => s.candleIndex <= latestBullishBreak.triggerCandleIndex,
        );
        if (candidateLows.length > 0) {
          // The swing low that initiated the leg
          strongPivot = candidateLows[candidateLows.length - 1];
          rationales.push(
            `Strong Low identified at ${strongPivot.price} (${new Date(strongPivot.timestamp).toISOString()}) - origin of bullish ${latestBullishBreak.type}.`,
          );
        }
      }

      if (!strongPivot && swingLows.length > 0) {
        // Fallback: latest intact Higher Low
        const intactLows = swingLows.filter((s) => !s.isBroken);
        strongPivot = intactLows.length > 0 ? intactLows[intactLows.length - 1] : swingLows[swingLows.length - 1];
        rationales.push(`Strong Low designated from most recent intact swing low at ${strongPivot.price}.`);
      }

      // Weak High: The most recent Swing High forming the ceiling of the current leg
      if (swingHighs.length > 0) {
        weakTarget = swingHighs[swingHighs.length - 1];
        rationales.push(
          `Weak High targeted at ${weakTarget.price} - expected to be broken for bullish expansion.`,
        );
      }
    } else if (trendBias === 'BEARISH') {
      // In a bearish trend:
      // Strong High: The swing high that initiated the latest bearish BOS/CHoCH.
      const latestBearishBreak = [...structureBreaks]
        .reverse()
        .find((b) => b.direction === 'BEARISH');

      if (latestBearishBreak) {
        const candidateHighs = swingHighs.filter(
          (s) => s.candleIndex <= latestBearishBreak.triggerCandleIndex,
        );
        if (candidateHighs.length > 0) {
          strongPivot = candidateHighs[candidateHighs.length - 1];
          rationales.push(
            `Strong High identified at ${strongPivot.price} (${new Date(strongPivot.timestamp).toISOString()}) - origin of bearish ${latestBearishBreak.type}.`,
          );
        }
      }

      if (!strongPivot && swingHighs.length > 0) {
        const intactHighs = swingHighs.filter((s) => !s.isBroken);
        strongPivot = intactHighs.length > 0 ? intactHighs[intactHighs.length - 1] : swingHighs[swingHighs.length - 1];
        rationales.push(`Strong High designated from most recent intact swing high at ${strongPivot.price}.`);
      }

      // Weak Low: The most recent Swing Low forming the floor of the current leg
      if (swingLows.length > 0) {
        weakTarget = swingLows[swingLows.length - 1];
        rationales.push(
          `Weak Low targeted at ${weakTarget.price} - expected to be broken for bearish expansion.`,
        );
      }
    } else {
      // NEUTRAL / CONSOLIDATION
      // Take the highest unbroken high and lowest unbroken low of the range
      const intactHighs = swingHighs.filter((s) => !s.isBroken);
      const intactLows = swingLows.filter((s) => !s.isBroken);

      if (intactHighs.length > 0 && intactLows.length > 0) {
        weakTarget = intactHighs[intactHighs.length - 1];
        strongPivot = intactLows[intactLows.length - 1];
        rationales.push(
          `Range consolidation: Highs (${weakTarget.price}) and Lows (${strongPivot.price}) form dual liquidity extremes.`,
        );
      }
    }

    const invalidationPrice = strongPivot ? strongPivot.price : null;
    const targetPrice = weakTarget ? weakTarget.price : null;
    const isProtected = strongPivot ? !strongPivot.isBroken : false;

    return {
      symbol,
      timeframe,
      trendBias,
      strongPivot,
      weakTarget,
      invalidationPrice,
      targetPrice,
      isProtected,
      rationales,
    };
  }
}
