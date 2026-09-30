/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SMC Causality Engine & Institutional Setup Lineage
 *
 * Reconstructs the complete institutional cause-and-effect chain:
 * 1. Cause: Which liquidity sweep triggered institutional absorption?
 * 2. Displacement: Which violent impulse leg responded to the sweep?
 * 3. Footprint Artifacts: Which Order Block and Fair Value Gap were created during the impulse?
 * 4. Structural Confirmation: Which BOS or CHoCH was confirmed by the close?
 * 5. Opposing Target: Which resting liquidity pool is now targeted?
 *
 * This provides full causal explainability for trade setups, preventing "black-box"
 * entries and powering institutional audit lineage.
 *
 * Pure calculation: No I/O.
 */

import {
  Candle,
  InstrumentSymbol,
  LiquiditySweepEvent,
  StructuralTimeframe,
} from '../types/smc';
import { assertStructuralTimeframe } from './canonicalDataContracts';
import { MarketDataNormalization } from './marketDataNormalization';
import { SmcFairValueGap } from './smcFvgEngine';
import { SmcLiquidityPool } from './smcLiquidityEngine';
import {
  StructureBreakEvent,
  TimeframeStructureAnalysis,
} from './smcMarketStructureEngine';
import { SmcOrderBlock } from './smcOrderBlockEngine';

export interface CausalDisplacementLeg {
  readonly startTimestamp: number;
  readonly peakTimestamp: number;
  readonly startPrice: number;
  readonly peakPrice: number;
  readonly deltaPips: number;
  readonly candleCount: number;
  readonly velocityPipsPerCandle: number;
}

export interface CausalChainRecord {
  readonly id: string;
  readonly symbol: InstrumentSymbol;
  readonly timeframe: StructuralTimeframe;
  readonly direction: 'BULLISH' | 'BEARISH';
  readonly establishedAt: number;
  readonly triggerSweep: LiquiditySweepEvent | null;
  readonly displacementLeg: CausalDisplacementLeg;
  readonly confirmedBreak: StructureBreakEvent;
  readonly resultingOrderBlocks: readonly SmcOrderBlock[];
  readonly resultingFvgs: readonly SmcFairValueGap[];
  readonly opposingTargetPool: SmcLiquidityPool | null;
  readonly causalConvictionScore: number; // 0 - 100
  readonly narrative: string; // Institutional causal explanation
}

export interface CausalityAnalysisReport {
  readonly symbol: InstrumentSymbol;
  readonly timeframe: StructuralTimeframe;
  readonly analyzedAt: number;
  readonly causalChains: readonly CausalChainRecord[];
  readonly latestActiveChain: CausalChainRecord | null;
  readonly fullyLinkedChainsCount: number; // Chains possessing both sweep cause AND structural effect
}

export class SmcCausalityEngine {
  /**
   * Pure calculation: Links liquidity sweeps, displacements, order blocks, FVGs, and structure breaks.
   */
  public static reconstructCausalChains(input: {
    symbol: InstrumentSymbol;
    timeframe: StructuralTimeframe;
    candles: readonly Candle[];
    structureAnalysis: TimeframeStructureAnalysis;
    sweepEvents: readonly LiquiditySweepEvent[];
    orderBlocks: readonly SmcOrderBlock[];
    fairValueGaps: readonly SmcFairValueGap[];
    liquidityPools: readonly SmcLiquidityPool[];
  }): CausalityAnalysisReport {
    const {
      symbol,
      timeframe,
      candles,
      structureAnalysis,
      sweepEvents,
      orderBlocks,
      fairValueGaps,
      liquidityPools,
    } = input;
    assertStructuralTimeframe(timeframe);

    const analyzedAt = candles.length > 0 ? candles[candles.length - 1].timestamp : Date.now();

    if (!candles || candles.length === 0 || structureAnalysis.structureBreaks.length === 0) {
      return {
        symbol,
        timeframe,
        analyzedAt,
        causalChains: [],
        latestActiveChain: null,
        fullyLinkedChainsCount: 0,
      };
    }

    const causalChains: CausalChainRecord[] = [];

    // Analyze each confirmed structure break from Phase 2
    for (const sBreak of structureAnalysis.structureBreaks) {
      const isBullish = sBreak.direction === 'BULLISH';
      const triggerIndex = sBreak.triggerCandleIndex;

      if (triggerIndex <= 0 || triggerIndex >= candles.length) continue;

      // 1. Locate the origin of the displacement leg leading into the break
      const maxImpulseLookback = Math.min(10, triggerIndex);
      let startIndex = triggerIndex - 1;

      if (isBullish) {
        let lowestPrice = candles[triggerIndex].low;
        for (let i = triggerIndex; i >= triggerIndex - maxImpulseLookback; i--) {
          if (candles[i].low <= lowestPrice) {
            lowestPrice = candles[i].low;
            startIndex = i;
          }
        }
      } else {
        let highestPrice = candles[triggerIndex].high;
        for (let i = triggerIndex; i >= triggerIndex - maxImpulseLookback; i--) {
          if (candles[i].high >= highestPrice) {
            highestPrice = candles[i].high;
            startIndex = i;
          }
        }
      }

      const startCandle = candles[startIndex];
      const peakCandle = candles[triggerIndex];
      const startPrice = isBullish ? startCandle.low : startCandle.high;
      const peakPrice = isBullish ? peakCandle.high : peakCandle.low;
      const deltaPrice = Math.abs(peakPrice - startPrice);
      const deltaPips = MarketDataNormalization.priceDeltaToPips(deltaPrice, symbol);
      const candleCount = Math.max(1, triggerIndex - startIndex + 1);
      const velocity = Math.round((deltaPips / candleCount) * 10) / 10;

      const displacementLeg: CausalDisplacementLeg = {
        startTimestamp: startCandle.timestamp,
        peakTimestamp: peakCandle.timestamp,
        startPrice,
        peakPrice,
        deltaPips,
        candleCount,
        velocityPipsPerCandle: velocity,
      };

      // 2. Identify trigger liquidity sweep preceding this displacement (within 15 candles before start)
      const sweepWindowStart = startCandle.timestamp - 15 * 60 * 1000 * 15; // approximate buffer
      const candidateSweeps = sweepEvents.filter((sw) => {
        const matchesDirection = isBullish
          ? sw.sweepLowPrice <= startPrice || sw.levelType === 'SSL' || sw.levelType === 'EQL' || sw.levelType === 'PREVIOUS_DAY_LOW'
          : sw.sweepHighPrice >= startPrice || sw.levelType === 'BSL' || sw.levelType === 'EQH' || sw.levelType === 'PREVIOUS_DAY_HIGH';

        return (
          sw.timestamp <= startCandle.timestamp &&
          sw.timestamp >= sweepWindowStart &&
          matchesDirection
        );
      });

      // Sort candidate sweeps so closest to displacement origin comes first
      candidateSweeps.sort((a, b) => b.timestamp - a.timestamp);
      const triggerSweep = candidateSweeps.length > 0 ? candidateSweeps[0] : null;

      // 3. Find resulting Order Blocks created during this displacement
      const resultingOrderBlocks = orderBlocks.filter(
        (ob) =>
          ob.triggerBreakId === sBreak.id ||
          (ob.originCandleTimestamp >= startCandle.timestamp - 60000 &&
            ob.originCandleTimestamp <= peakCandle.timestamp),
      );

      // 4. Find resulting Fair Value Gaps created during this displacement
      const resultingFvgs = fairValueGaps.filter(
        (fvg) =>
          fvg.candle1Timestamp >= startCandle.timestamp &&
          fvg.candle3Timestamp <= peakCandle.timestamp + 60000 &&
          (isBullish ? fvg.type === 'BISI' : fvg.type === 'SIBI'),
      );

      // 5. Identify the opposing target liquidity pool
      const opposingPools = liquidityPools.filter((p) =>
        isBullish
          ? p.side === 'BUY_SIDE' && p.price > peakPrice && !p.isSwept
          : p.side === 'SELL_SIDE' && p.price < peakPrice && !p.isSwept,
      );
      opposingPools.sort((a, b) => (isBullish ? a.price - b.price : b.price - a.price));
      const opposingTargetPool = opposingPools.length > 0 ? opposingPools[0] : null;

      // 6. Calculate causal conviction score
      let convictionScore = 50;
      if (triggerSweep) convictionScore += 25; // Root cause identified
      if (sBreak.scope === 'SWING') convictionScore += 15; // Major swing break
      if (resultingOrderBlocks.length > 0) convictionScore += 10;
      if (resultingFvgs.length > 0) convictionScore += 10;
      if (deltaPips >= 25) convictionScore += 10;
      convictionScore = Math.min(100, convictionScore);

      // 7. Compose canonical narrative
      const causeText = triggerSweep
        ? `Liquidity sweep of ${triggerSweep.levelType} (${triggerSweep.status}) at ${isBullish ? triggerSweep.sweepLowPrice : triggerSweep.sweepHighPrice}`
        : `Strong ${isBullish ? 'bullish' : 'bearish'} institutional momentum from base at ${startPrice}`;

      const displacementText = `triggered an explosive ${deltaPips} pip ${isBullish ? 'bullish' : 'bearish'} displacement (${velocity} pips/bar)`;

      const breakText = `confirming a ${sBreak.scope} ${sBreak.type} at ${sBreak.breakPrice}`;

      const artifactsText = `leaving behind ${resultingOrderBlocks.length} Order Block(s) and ${resultingFvgs.length} FVG(s)`;

      const targetText = opposingTargetPool
        ? `with primary target at ${opposingTargetPool.originType} (${opposingTargetPool.price}).`
        : 'targeting next higher-timeframe liquidity.';

      const narrative = `${causeText} ${displacementText}, ${breakText}, ${artifactsText}, ${targetText}`;

      const chainId = `CHAIN_${symbol}_${sBreak.id}`;

      if (!causalChains.some((c) => c.id === chainId)) {
        causalChains.push({
          id: chainId,
          symbol,
          timeframe,
          direction: sBreak.direction,
          establishedAt: peakCandle.timestamp,
          triggerSweep,
          displacementLeg,
          confirmedBreak: sBreak,
          resultingOrderBlocks,
          resultingFvgs,
          opposingTargetPool,
          causalConvictionScore: convictionScore,
          narrative,
        });
      }
    }

    // Sort chronologically (newest chain first)
    causalChains.sort((a, b) => b.establishedAt - a.establishedAt);

    const latestActiveChain = causalChains.length > 0 ? causalChains[0] : null;
    const fullyLinkedChainsCount = causalChains.filter((c) => c.triggerSweep !== null).length;

    return {
      symbol,
      timeframe,
      analyzedAt,
      causalChains,
      latestActiveChain,
      fullyLinkedChainsCount,
    };
  }
}
