/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SMC 1H Structural Engine
 *
 * High-Timeframe (HTF) Foundation:
 * 1. Consumes 1H canonical candles via Phase 1 getCandles().
 * 2. Consumes Phase 2 structure output (BOS/CHoCH, Swings, Dealing Range) to determine DirectionalBias.
 * 3. Surfaces active 1H displacement Order Blocks and Fair Value Gaps from Phase 3 as key POIs.
 *
 * HARD SMC INVARIANTS:
 * - 1H is the master structural bias provider (HTF).
 * - Structural calculations are strictly executed on 1H; 1M data is quarantined.
 * - Does not recompute swings or structure breaks; consumes Phase 2 & Phase 3 pure engines.
 */

import {
  Candle,
  DirectionalBias,
  FairValueGapZone,
  InstrumentSymbol,
  MarketRegimeType,
  OrderBlockZone,
  PremiumDiscountZone,
  SwingPoint,
  StructureBreak,
} from '../types/smc';
import { assertStructuralTimeframe } from './canonicalDataContracts';
import { CanonicalMarketDataEngine } from './canonicalMarketDataEngine';
import { ActiveDealingRange, SmcDealingRangeEngine } from './smcDealingRangeEngine';
import { FvgAnalysisReport, SmcFairValueGap, SmcFvgEngine } from './smcFvgEngine';
import { LiquidityAnalysisReport, SmcLiquidityEngine, SmcLiquidityPool } from './smcLiquidityEngine';
import { OrderBlockAnalysisReport, SmcOrderBlock, SmcOrderBlockEngine } from './smcOrderBlockEngine';
import { SmcMarketStructureEngine, TimeframeStructureAnalysis } from './smcMarketStructureEngine';

export interface Smc1hKeyPoi {
  readonly id: string;
  readonly type: 'ORDER_BLOCK' | 'FAIR_VALUE_GAP';
  readonly direction: 'BULLISH' | 'BEARISH';
  readonly topPrice: number;
  readonly bottomPrice: number;
  readonly triggerPrice: number; // 50% Mean Threshold or Consequent Encroachment
  readonly isMitigated: boolean;
  readonly qualityScore: number;
  readonly model: SmcOrderBlock | SmcFairValueGap;
}

export interface Smc1hStructuralAnalysis {
  readonly symbol: InstrumentSymbol;
  readonly timeframe: '1H';
  readonly evaluatedAt: number;
  readonly directionalBias: DirectionalBias;
  readonly marketRegime: MarketRegimeType;
  readonly currentPrice: number;
  readonly structureAnalysis: TimeframeStructureAnalysis;
  readonly dealingRange: ActiveDealingRange | null;
  readonly premiumDiscount: PremiumDiscountZone | null;
  readonly orderBlockReport: OrderBlockAnalysisReport;
  readonly fvgReport: FvgAnalysisReport;
  readonly liquidityReport: LiquidityAnalysisReport;
  readonly activeOrderBlocks: readonly SmcOrderBlock[];
  readonly activeFairValueGaps: readonly SmcFairValueGap[];
  readonly keyPois: readonly Smc1hKeyPoi[];
  readonly swingPoints: readonly SwingPoint[];
  readonly structureBreaks: readonly StructureBreak[];
  readonly activeLiquidityPools: readonly SmcLiquidityPool[];
}

export class Smc1hStructuralEngine {
  /**
   * Pure execution on 1H candle array.
   */
  public static analyze1hCandles(
    candles1H: readonly Candle[],
    symbolOverride?: InstrumentSymbol,
  ): Smc1hStructuralAnalysis {
    assertStructuralTimeframe('1H');

    if (!candles1H || candles1H.length === 0) {
      const sym = symbolOverride ?? 'EUR_USD';
      const emptyStruct = SmcMarketStructureEngine.analyzeTimeframeStructure([], '1H');
      return {
        symbol: sym,
        timeframe: '1H',
        evaluatedAt: Date.now(),
        directionalBias: 'NEUTRAL',
        marketRegime: 'CONSOLIDATION_RANGE',
        currentPrice: 0,
        structureAnalysis: emptyStruct,
        dealingRange: null,
        premiumDiscount: null,
        orderBlockReport: {
          symbol: sym,
          timeframe: '1H',
          calculatedAt: Date.now(),
          orderBlocks: [],
          unmitigatedBullishBlocks: [],
          unmitigatedBearishBlocks: [],
          swingBlocks: [],
          internalBlocks: [],
        },
        fvgReport: {
          symbol: sym,
          timeframe: '1H',
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
          symbol: sym,
          timeframe: '1H',
          calculatedAt: Date.now(),
          atr: 0.001,
          clusterTolerancePrice: 0.00015,
          externalPools: [],
          internalPools: [],
          allPools: [],
          nearestBuySidePool: null,
          nearestSellSidePool: null,
        },
        activeOrderBlocks: [],
        activeFairValueGaps: [],
        keyPois: [],
        swingPoints: [],
        structureBreaks: [],
        activeLiquidityPools: [],
      };
    }

    const symbol = symbolOverride ?? candles1H[0].symbol;
    const latestCandle = candles1H[candles1H.length - 1];
    const currentPrice = latestCandle.close;

    // 1. Consume Phase 2 structure analysis
    const structureAnalysis = SmcMarketStructureEngine.analyzeTimeframeStructure(
      candles1H,
      '1H',
    );

    // 2. Compute 1H active dealing range and premium/discount matrix
    const dealingRange = SmcDealingRangeEngine.computeDealingRange(
      structureAnalysis,
      currentPrice,
    );

    // 3. Determine directional bias from Phase 2 structure
    const directionalBias: DirectionalBias = structureAnalysis.trendBias;
    const marketRegime: MarketRegimeType = structureAnalysis.marketRegime;

    // 4. Consume Phase 3 Order Blocks on 1H
    const orderBlockReport = SmcOrderBlockEngine.detectOrderBlocks(
      candles1H,
      structureAnalysis,
    );

    // 5. Consume Phase 3 Fair Value Gaps on 1H
    const fvgReport = SmcFvgEngine.detectFairValueGaps(candles1H, '1H');

    // 6. Consume Phase 3 Liquidity Levels on 1H
    const liquidityReport = SmcLiquidityEngine.detectLiquidityPools({
      symbol,
      timeframe: '1H',
      candles: candles1H,
      structureAnalysis,
    });

    // 7. Surface active uninvalidated Order Blocks & FVGs as key POIs
    const activeOrderBlocks = orderBlockReport.orderBlocks.filter(
      (ob) => ob.mitigationState !== 'INVALIDATED',
    );

    const activeFairValueGaps = fvgReport.allGaps.filter(
      (fvg) => fvg.mitigationState !== 'INVALIDATED',
    );

    const keyPois: Smc1hKeyPoi[] = [];

    // Add active Order Blocks
    for (const ob of activeOrderBlocks) {
      const direction = ob.type === 'BULLISH_OB' ? 'BULLISH' : 'BEARISH';
      keyPois.push({
        id: ob.id,
        type: 'ORDER_BLOCK',
        direction,
        topPrice: ob.highPrice,
        bottomPrice: ob.lowPrice,
        triggerPrice: ob.meanThresholdPrice,
        isMitigated: ob.isMitigated,
        qualityScore: ob.qualityScore,
        model: ob,
      });
    }

    // Add active FVGs
    for (const fvg of activeFairValueGaps) {
      const direction = fvg.type === 'BISI' ? 'BULLISH' : 'BEARISH';
      keyPois.push({
        id: fvg.id,
        type: 'FAIR_VALUE_GAP',
        direction,
        topPrice: fvg.topPrice,
        bottomPrice: fvg.bottomPrice,
        triggerPrice: fvg.consequentEncroachmentPrice,
        isMitigated: fvg.isMitigated,
        qualityScore: fvg.qualityScore,
        model: fvg,
      });
    }

    // Sort key POIs by quality score descending
    keyPois.sort((a, b) => b.qualityScore - a.qualityScore);

    // Convert canonical swings & structure breaks
    const swingPoints: readonly SwingPoint[] = structureAnalysis.swings;
    const structureBreaks: readonly StructureBreak[] = structureAnalysis.structureBreaks;

    return {
      symbol,
      timeframe: '1H',
      evaluatedAt: latestCandle.timestamp,
      directionalBias,
      marketRegime,
      currentPrice,
      structureAnalysis,
      dealingRange,
      premiumDiscount: dealingRange?.canonicalZoneModel ?? null,
      orderBlockReport,
      fvgReport,
      liquidityReport,
      activeOrderBlocks,
      activeFairValueGaps,
      keyPois,
      swingPoints,
      structureBreaks,
      activeLiquidityPools: liquidityReport.allPools,
    };
  }

  /**
   * Facade method reading directly from Phase 1 CanonicalMarketDataEngine.
   */
  public static analyzeFromMarketData(
    marketDataEngine: CanonicalMarketDataEngine,
    symbol: InstrumentSymbol,
  ): Smc1hStructuralAnalysis {
    const candles1H = marketDataEngine.getCandles(symbol, '1H');
    return this.analyze1hCandles(candles1H, symbol);
  }
}
