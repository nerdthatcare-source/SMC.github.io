/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SMC Point of Interest (POI) Context Engine
 *
 * Evaluates the institutional context of Order Blocks, FVGs, and Liquidity Pools:
 * 1. Higher-Timeframe (HTF) Bias Alignment:
 *    - Does this POI align with the prevailing 1H/15M structural trend?
 *    - Bullish Trend: Bullish OBs and BISI FVGs receive maximum alignment conviction.
 *    - Bearish Trend: Bearish OBs and SIBI FVGs receive maximum alignment conviction.
 *    - Counter-trend setups are explicitly tagged and penalized.
 * 2. Dealing Range & Premium / Discount Valuation:
 *    - Consumes ActiveDealingRange from smcDealingRangeEngine.
 *    - Long POIs located in DISCOUNT, DEEP_DISCOUNT, or OTE (61.8% - 79.0%) earn high conviction.
 *    - Short POIs located in PREMIUM, DEEP_PREMIUM, or OTE earn high conviction.
 *    - POIs at Equilibrium buffer (48% - 52%) are flagged for reduced edge.
 * 3. Mitigation & Freshness Factor:
 *    - Unmitigated zones retain full institutional capital footprint.
 * 4. Proximity & Zone Bounds:
 *    - Pip distance to current market price, upper/lower boundaries, and trigger price.
 *
 * Pure calculation: No I/O, consumes Phase 2 structure & Phase 3 liquidity/OB/FVG models.
 */

import {
  DirectionalBias,
  InstrumentSymbol,
  StructuralTimeframe,
  ValuationZone,
} from '../types/smc';
import { assertStructuralTimeframe } from './canonicalDataContracts';
import { MarketDataNormalization } from './marketDataNormalization';
import { ActiveDealingRange, DealingSubZone } from './smcDealingRangeEngine';
import { SmcFairValueGap } from './smcFvgEngine';
import { SmcLiquidityPool } from './smcLiquidityEngine';
import { SmcOrderBlock } from './smcOrderBlockEngine';

export type PoiKind = 'ORDER_BLOCK' | 'FAIR_VALUE_GAP' | 'LIQUIDITY_POOL';

export type PoiDirection = 'BULLISH' | 'BEARISH';

export type PoiHtfAlignment = 'STRONGLY_ALIGNED' | 'NEUTRAL' | 'COUNTER_TREND';

export interface EvaluatedPoiContext {
  readonly id: string;
  readonly kind: PoiKind;
  readonly symbol: InstrumentSymbol;
  readonly timeframe: StructuralTimeframe;
  readonly direction: PoiDirection;
  readonly highPrice: number;
  readonly lowPrice: number;
  readonly triggerPrice: number; // e.g. Mean Threshold or Consequent Encroachment
  readonly currentPrice: number;
  readonly distancePips: number;
  readonly isPriceInsideZone: boolean;
  readonly htfAlignment: PoiHtfAlignment;
  readonly htfTrendBias: DirectionalBias;
  readonly valuationZone: ValuationZone;
  readonly dealingSubZone: DealingSubZone;
  readonly inOteZone: boolean;
  readonly isDiscountPremiumFavorable: boolean;
  readonly isFresh: boolean;
  readonly rawQualityScore: number;
  readonly contextualScore: number; // 0 - 100 context-weighted conviction
  readonly contextRationales: readonly string[];
  readonly underlyingModel: SmcOrderBlock | SmcFairValueGap | SmcLiquidityPool;
}

export interface PoiContextEvaluationInput {
  readonly symbol: InstrumentSymbol;
  readonly timeframe: StructuralTimeframe;
  readonly currentPrice: number;
  readonly htfTrendBias: DirectionalBias;
  readonly dealingRange: ActiveDealingRange | null;
  readonly orderBlocks: readonly SmcOrderBlock[];
  readonly fairValueGaps: readonly SmcFairValueGap[];
  readonly liquidityPools: readonly SmcLiquidityPool[];
}

export class SmcPoiContextEngine {
  /**
   * Pure calculation: Evaluates context for all supplied Order Blocks, FVGs, and Liquidity Pools.
   */
  public static evaluateAllPois(input: PoiContextEvaluationInput): readonly EvaluatedPoiContext[] {
    const {
      symbol,
      timeframe,
      currentPrice,
      htfTrendBias,
      dealingRange,
      orderBlocks,
      fairValueGaps,
      liquidityPools,
    } = input;
    assertStructuralTimeframe(timeframe);

    const results: EvaluatedPoiContext[] = [];

    // 1. Evaluate Order Blocks
    for (const ob of orderBlocks) {
      if (ob.mitigationState === 'INVALIDATED') continue;
      results.push(this.evaluateOrderBlockContext(ob, currentPrice, htfTrendBias, dealingRange));
    }

    // 2. Evaluate Fair Value Gaps
    for (const fvg of fairValueGaps) {
      if (fvg.mitigationState === 'INVALIDATED' && !fvg.isInversionFVG) continue;
      results.push(this.evaluateFvgContext(fvg, currentPrice, htfTrendBias, dealingRange));
    }

    // 3. Evaluate Untouched/Approaching Liquidity Pools (resting liquidity targets)
    for (const pool of liquidityPools) {
      if (pool.isSwept) continue;
      results.push(this.evaluateLiquidityPoolContext(pool, currentPrice, htfTrendBias, dealingRange));
    }

    return results;
  }

  /**
   * Evaluates context for a single Order Block.
   */
  public static evaluateOrderBlockContext(
    ob: SmcOrderBlock,
    currentPrice: number,
    htfTrendBias: DirectionalBias,
    dealingRange: ActiveDealingRange | null,
  ): EvaluatedPoiContext {
    const isBullish = ob.type === 'BULLISH_OB';
    const direction: PoiDirection = isBullish ? 'BULLISH' : 'BEARISH';
    const triggerPrice = ob.meanThresholdPrice;

    const isPriceInsideZone = currentPrice >= ob.lowPrice && currentPrice <= ob.highPrice;
    const distanceDelta = Math.abs(currentPrice - triggerPrice);
    const distancePips = MarketDataNormalization.priceDeltaToPips(distanceDelta, ob.symbol);

    // HTF Alignment
    let htfAlignment: PoiHtfAlignment = 'NEUTRAL';
    if (htfTrendBias === 'BULLISH') {
      htfAlignment = isBullish ? 'STRONGLY_ALIGNED' : 'COUNTER_TREND';
    } else if (htfTrendBias === 'BEARISH') {
      htfAlignment = !isBullish ? 'STRONGLY_ALIGNED' : 'COUNTER_TREND';
    }

    // Valuation Zone
    const valuation = this.resolveValuation(triggerPrice, dealingRange);
    const isDiscountPremiumFavorable = isBullish
      ? valuation.zone === 'DISCOUNT' || valuation.zone === 'DEEP_DISCOUNT'
      : valuation.zone === 'PREMIUM' || valuation.zone === 'DEEP_PREMIUM';

    const rationales: string[] = [];
    let contextualScore = ob.qualityScore;

    if (htfAlignment === 'STRONGLY_ALIGNED') {
      contextualScore += 15;
      rationales.push(`Aligned with ${htfTrendBias} higher-timeframe trend.`);
    } else if (htfAlignment === 'COUNTER_TREND') {
      contextualScore -= 20;
      rationales.push(`Counter-trend against ${htfTrendBias} HTF bias (higher risk).`);
    }

    if (isDiscountPremiumFavorable) {
      contextualScore += 15;
      rationales.push(`Favorable valuation in ${valuation.subZone}.`);
    } else {
      contextualScore -= 10;
      rationales.push(`Unfavorable valuation (${isBullish ? 'Long in Premium' : 'Short in Discount'}).`);
    }

    if (valuation.inOte) {
      contextualScore += 10;
      rationales.push('Confluent inside Optimal Trade Entry (OTE 61.8% - 79%) zone.');
    }

    if (ob.scope === 'SWING') {
      contextualScore += 10;
      rationales.push('Displacement confirmed a major SWING structure break.');
    }

    contextualScore = Math.max(0, Math.min(100, contextualScore));

    return {
      id: ob.id,
      kind: 'ORDER_BLOCK',
      symbol: ob.symbol,
      timeframe: ob.timeframe,
      direction,
      highPrice: ob.highPrice,
      lowPrice: ob.lowPrice,
      triggerPrice,
      currentPrice,
      distancePips,
      isPriceInsideZone,
      htfAlignment,
      htfTrendBias,
      valuationZone: valuation.zone,
      dealingSubZone: valuation.subZone,
      inOteZone: valuation.inOte,
      isDiscountPremiumFavorable,
      isFresh: ob.mitigationState === 'UNMITIGATED',
      rawQualityScore: ob.qualityScore,
      contextualScore,
      contextRationales: rationales,
      underlyingModel: ob,
    };
  }

  /**
   * Evaluates context for a single Fair Value Gap.
   */
  public static evaluateFvgContext(
    fvg: SmcFairValueGap,
    currentPrice: number,
    htfTrendBias: DirectionalBias,
    dealingRange: ActiveDealingRange | null,
  ): EvaluatedPoiContext {
    const isBullish = fvg.type === 'BISI' && !fvg.isInversionFVG;
    const direction: PoiDirection = isBullish ? 'BULLISH' : 'BEARISH';
    const highPrice = Math.max(fvg.topPrice, fvg.bottomPrice);
    const lowPrice = Math.min(fvg.topPrice, fvg.bottomPrice);
    const triggerPrice = fvg.consequentEncroachmentPrice;

    const isPriceInsideZone = currentPrice >= lowPrice && currentPrice <= highPrice;
    const distanceDelta = Math.abs(currentPrice - triggerPrice);
    const distancePips = MarketDataNormalization.priceDeltaToPips(distanceDelta, fvg.symbol);

    let htfAlignment: PoiHtfAlignment = 'NEUTRAL';
    if (htfTrendBias === 'BULLISH') {
      htfAlignment = isBullish ? 'STRONGLY_ALIGNED' : 'COUNTER_TREND';
    } else if (htfTrendBias === 'BEARISH') {
      htfAlignment = !isBullish ? 'STRONGLY_ALIGNED' : 'COUNTER_TREND';
    }

    const valuation = this.resolveValuation(triggerPrice, dealingRange);
    const isDiscountPremiumFavorable = isBullish
      ? valuation.zone === 'DISCOUNT' || valuation.zone === 'DEEP_DISCOUNT'
      : valuation.zone === 'PREMIUM' || valuation.zone === 'DEEP_PREMIUM';

    const rationales: string[] = [];
    let contextualScore = fvg.qualityScore;

    if (htfAlignment === 'STRONGLY_ALIGNED') {
      contextualScore += 15;
      rationales.push(`Aligned with ${htfTrendBias} higher-timeframe trend.`);
    } else if (htfAlignment === 'COUNTER_TREND') {
      contextualScore -= 20;
      rationales.push(`Counter-trend FVG against ${htfTrendBias} HTF bias.`);
    }

    if (isDiscountPremiumFavorable) {
      contextualScore += 15;
      rationales.push(`Favorable valuation in ${valuation.subZone}.`);
    }

    if (valuation.inOte) {
      contextualScore += 10;
      rationales.push('Confluent inside Optimal Trade Entry (OTE 61.8% - 79%) zone.');
    }

    if (fvg.isInversionFVG) {
      rationales.push('Breached imbalance now active as Inversion FVG (IFVG).');
    }

    contextualScore = Math.max(0, Math.min(100, contextualScore));

    return {
      id: fvg.id,
      kind: 'FAIR_VALUE_GAP',
      symbol: fvg.symbol,
      timeframe: fvg.timeframe,
      direction,
      highPrice,
      lowPrice,
      triggerPrice,
      currentPrice,
      distancePips,
      isPriceInsideZone,
      htfAlignment,
      htfTrendBias,
      valuationZone: valuation.zone,
      dealingSubZone: valuation.subZone,
      inOteZone: valuation.inOte,
      isDiscountPremiumFavorable,
      isFresh: fvg.mitigationState === 'UNMITIGATED',
      rawQualityScore: fvg.qualityScore,
      contextualScore,
      contextRationales: rationales,
      underlyingModel: fvg,
    };
  }

  /**
   * Evaluates context for a resting Liquidity Pool.
   */
  public static evaluateLiquidityPoolContext(
    pool: SmcLiquidityPool,
    currentPrice: number,
    htfTrendBias: DirectionalBias,
    dealingRange: ActiveDealingRange | null,
  ): EvaluatedPoiContext {
    // Buy-Side Liquidity is resting above price -> bullish magnet / short target
    // Sell-Side Liquidity is resting below price -> bearish magnet / long target
    const isBuySide = pool.side === 'BUY_SIDE';
    const direction: PoiDirection = isBuySide ? 'BULLISH' : 'BEARISH';
    const highPrice = pool.price + pool.priceTolerance;
    const lowPrice = pool.price - pool.priceTolerance;
    const triggerPrice = pool.price;

    const isPriceInsideZone = currentPrice >= lowPrice && currentPrice <= highPrice;
    const distanceDelta = Math.abs(currentPrice - triggerPrice);
    const distancePips = MarketDataNormalization.priceDeltaToPips(distanceDelta, pool.symbol);

    let htfAlignment: PoiHtfAlignment = 'NEUTRAL';
    if (htfTrendBias === 'BULLISH') {
      htfAlignment = isBuySide ? 'STRONGLY_ALIGNED' : 'COUNTER_TREND';
    } else if (htfTrendBias === 'BEARISH') {
      htfAlignment = !isBuySide ? 'STRONGLY_ALIGNED' : 'COUNTER_TREND';
    }

    const valuation = this.resolveValuation(triggerPrice, dealingRange);
    const isDiscountPremiumFavorable = isBuySide
      ? valuation.zone === 'PREMIUM' || valuation.zone === 'DEEP_PREMIUM' // Targets are in premium
      : valuation.zone === 'DISCOUNT' || valuation.zone === 'DEEP_DISCOUNT';

    const rationales: string[] = [
      `${pool.originType} (${pool.touchCount} touch${pool.touchCount > 1 ? 'es' : ''}) resting stop cluster.`,
    ];

    let contextualScore = pool.estimatedVolumeWeight;
    if (htfAlignment === 'STRONGLY_ALIGNED') {
      contextualScore += 10;
      rationales.push(`Natural liquidity target for ${htfTrendBias} trend.`);
    }

    contextualScore = Math.max(0, Math.min(100, contextualScore));

    return {
      id: pool.id,
      kind: 'LIQUIDITY_POOL',
      symbol: pool.symbol,
      timeframe: pool.timeframe,
      direction,
      highPrice,
      lowPrice,
      triggerPrice,
      currentPrice,
      distancePips,
      isPriceInsideZone,
      htfAlignment,
      htfTrendBias,
      valuationZone: valuation.zone,
      dealingSubZone: valuation.subZone,
      inOteZone: valuation.inOte,
      isDiscountPremiumFavorable,
      isFresh: !pool.isSwept,
      rawQualityScore: pool.estimatedVolumeWeight,
      contextualScore,
      contextRationales: rationales,
      underlyingModel: pool,
    };
  }

  /**
   * Helper to resolve valuation zone and OTE status from dealing range.
   */
  private static resolveValuation(
    price: number,
    dealingRange: ActiveDealingRange | null,
  ): {
    zone: ValuationZone;
    subZone: DealingSubZone;
    inOte: boolean;
  } {
    if (!dealingRange || dealingRange.rangeDelta <= 0) {
      return {
        zone: 'EQUILIBRIUM',
        subZone: 'EQUILIBRIUM_BUFFER',
        inOte: false,
      };
    }

    const pct = ((price - dealingRange.rangeLow) / dealingRange.rangeDelta) * 100;

    let zone: ValuationZone = 'EQUILIBRIUM';
    let subZone: DealingSubZone = 'EQUILIBRIUM_BUFFER';

    if (pct < 11.4) {
      zone = 'DEEP_DISCOUNT';
      subZone = 'DEEP_DISCOUNT';
    } else if (pct < 48.0) {
      zone = 'DISCOUNT';
      subZone = 'DISCOUNT';
    } else if (pct <= 52.0) {
      zone = 'EQUILIBRIUM';
      subZone = 'EQUILIBRIUM_BUFFER';
    } else if (pct <= 88.6) {
      zone = 'PREMIUM';
      subZone = 'PREMIUM';
    } else {
      zone = 'DEEP_PREMIUM';
      subZone = 'EXTREME_PREMIUM';
    }

    // Check OTE: 61.8% to 79.0% retracement
    const inOte =
      (price >= dealingRange.optimalTradeEntryLower && price <= dealingRange.optimalTradeEntryUpper) ||
      (pct >= 61.8 && pct <= 79.0);

    return { zone, subZone, inOte };
  }
}
