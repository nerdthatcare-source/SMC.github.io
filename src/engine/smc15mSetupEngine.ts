/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SMC 15M Setup Engine
 *
 * Intermediate-Timeframe (MTF) Setup Identification:
 * 1. Consumes 15M canonical candles via Phase 1 getCandles().
 * 2. Determines whether price is currently at a key POI from Phase 3 smcPoiIntelligenceEngine.
 * 3. Consumes existing conviction grades (A_PLUS, A, B, C) — strictly NO recomputation of POI quality.
 * 4. Ensures the POI is aligned with HTF 1H DirectionalBias.
 * 5. Classifies location using Phase 2 premium/discount dealing ranges (DISCOUNT for longs, PREMIUM for shorts).
 *
 * HARD INVARIANTS:
 * - Does not recompute swings, structure breaks, or POI scores.
 * - 1M data is strictly isolated.
 */

import {
  Candle,
  DirectionalBias,
  FairValueGapZone,
  InstrumentSymbol,
  LiquidityLevel,
  OrderBlockZone,
  StructuralTimeframe,
  StructureBreak,
  SwingPoint,
  ValuationZone,
} from '../types/smc';
import { assertStructuralTimeframe } from './canonicalDataContracts';
import { CanonicalMarketDataEngine } from './canonicalMarketDataEngine';
import { Smc1hStructuralAnalysis } from './smc1hStructuralEngine';
import { ActiveDealingRange, SmcDealingRangeEngine } from './smcDealingRangeEngine';
import { FvgAnalysisReport, SmcFvgEngine } from './smcFvgEngine';
import { LiquidityAnalysisReport, SmcLiquidityEngine } from './smcLiquidityEngine';
import { OrderBlockAnalysisReport, SmcOrderBlockEngine } from './smcOrderBlockEngine';
import { SmcMarketStructureEngine, TimeframeStructureAnalysis } from './smcMarketStructureEngine';
import {
  ConvictionGrade,
  RankedPoiItem,
  RankedPoiReport,
  SmcPoiIntelligenceEngine,
} from './smcPoiIntelligenceEngine';

export interface Smc15mSetupResult {
  readonly symbol: InstrumentSymbol;
  readonly timeframe: '15M';
  readonly evaluatedAt: number;
  readonly currentPrice: number;
  readonly htf1hBias: DirectionalBias;
  readonly isAtKeyPoi: boolean;
  readonly activeSetupPoi: RankedPoiItem | null;
  readonly poiConvictionGrade: ConvictionGrade | null;
  readonly isPoiHtfAligned: boolean;
  readonly locationClassification: ValuationZone;
  readonly isLocationAligned: boolean;
  readonly inOteZone: boolean;
  readonly isSetupValid: boolean;
  readonly setupReason: string;
  readonly dealingRange: ActiveDealingRange | null;
  readonly structureAnalysis: TimeframeStructureAnalysis;
  readonly rankedPoiReport: RankedPoiReport;
  readonly orderBlockReport: OrderBlockAnalysisReport;
  readonly fvgReport: FvgAnalysisReport;
  readonly liquidityReport: LiquidityAnalysisReport;
  readonly swingPoints: readonly SwingPoint[];
  readonly structureBreaks: readonly StructureBreak[];
  readonly activeOrderBlocks: readonly OrderBlockZone[];
  readonly activeFVGs: readonly FairValueGapZone[];
  readonly liquidityLevels: readonly LiquidityLevel[];
}

export class Smc15mSetupEngine {
  /**
   * Pure evaluation on 15M candles and 1H structural analysis context.
   */
  public static evaluate15mSetup(
    candles15M: readonly Candle[],
    htfAnalysis: Smc1hStructuralAnalysis,
    symbolOverride?: InstrumentSymbol,
  ): Smc15mSetupResult {
    assertStructuralTimeframe('15M');

    const symbol = symbolOverride ?? (candles15M[0]?.symbol || htfAnalysis.symbol || 'EUR_USD');
    const htf1hBias = htfAnalysis.directionalBias;

    if (!candles15M || candles15M.length === 0) {
      const emptyStruct = SmcMarketStructureEngine.analyzeTimeframeStructure([], '15M');
      return {
        symbol,
        timeframe: '15M',
        evaluatedAt: Date.now(),
        currentPrice: 0,
        htf1hBias,
        isAtKeyPoi: false,
        activeSetupPoi: null,
        poiConvictionGrade: null,
        isPoiHtfAligned: false,
        locationClassification: 'EQUILIBRIUM',
        isLocationAligned: false,
        inOteZone: false,
        isSetupValid: false,
        setupReason: 'NO_15M_CANDLES_AVAILABLE',
        dealingRange: null,
        structureAnalysis: emptyStruct,
        rankedPoiReport: {
          symbol,
          timeframe: '15M',
          calculatedAt: Date.now(),
          totalPoisEvaluated: 0,
          rankedPois: [],
          clusters: [],
          topBullishPoi: null,
          topBearishPoi: null,
          aPlusCount: 0,
          aCount: 0,
          bCount: 0,
          cCount: 0,
        },
        orderBlockReport: {
          symbol,
          timeframe: '15M',
          calculatedAt: Date.now(),
          orderBlocks: [],
          unmitigatedBullishBlocks: [],
          unmitigatedBearishBlocks: [],
          swingBlocks: [],
          internalBlocks: [],
        },
        fvgReport: {
          symbol,
          timeframe: '15M',
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
          symbol,
          timeframe: '15M',
          calculatedAt: Date.now(),
          atr: 0.001,
          clusterTolerancePrice: 0.00015,
          externalPools: [],
          internalPools: [],
          allPools: [],
          nearestBuySidePool: null,
          nearestSellSidePool: null,
        },
        swingPoints: [],
        structureBreaks: [],
        activeOrderBlocks: [],
        activeFVGs: [],
        liquidityLevels: [],
      };
    }

    const latestCandle = candles15M[candles15M.length - 1];
    const currentPrice = latestCandle.close;

    // 1. Compute Phase 2 structure on 15M
    const structureAnalysis = SmcMarketStructureEngine.analyzeTimeframeStructure(
      candles15M,
      '15M',
    );

    // 2. Compute 15M dealing range (fallback to 1H dealing range if 15M has insufficient swings)
    const dealingRange15M = SmcDealingRangeEngine.computeDealingRange(
      structureAnalysis,
      currentPrice,
    );
    const activeDealingRange = dealingRange15M ?? htfAnalysis.dealingRange;

    // 3. Compute 15M Order Blocks
    const orderBlockReport = SmcOrderBlockEngine.detectOrderBlocks(
      candles15M,
      structureAnalysis,
    );

    // 4. Compute 15M FVGs
    const fvgReport = SmcFvgEngine.detectFairValueGaps(candles15M, '15M');

    // 5. Compute 15M Liquidity Levels
    const liquidityReport = SmcLiquidityEngine.detectLiquidityPools({
      symbol,
      timeframe: '15M',
      candles: candles15M,
      structureAnalysis,
    });

    // 6. Rank POIs using Phase 3 smcPoiIntelligenceEngine (using existing conviction grades)
    const rankedPoiReport = SmcPoiIntelligenceEngine.rankPointsOfInterest({
      symbol,
      timeframe: '15M',
      currentPrice,
      htfTrendBias: htf1hBias,
      dealingRange: activeDealingRange,
      orderBlocks: orderBlockReport.orderBlocks,
      fairValueGaps: fvgReport.allGaps,
      liquidityPools: liquidityReport.allPools,
    });

    // 7. Classify location using Phase 2 premium / discount zones
    const locationClassification: ValuationZone =
      activeDealingRange?.zone ?? 'EQUILIBRIUM';
    const inOteZone: boolean = activeDealingRange?.inOteZone ?? false;

    // Location alignment check:
    // Bullish bias requires DISCOUNT or DEEP_DISCOUNT or OTE
    // Bearish bias requires PREMIUM or DEEP_PREMIUM or OTE
    let isLocationAligned = false;
    if (htf1hBias === 'BULLISH') {
      isLocationAligned =
        locationClassification === 'DISCOUNT' ||
        locationClassification === 'DEEP_DISCOUNT' ||
        inOteZone;
    } else if (htf1hBias === 'BEARISH') {
      isLocationAligned =
        locationClassification === 'PREMIUM' ||
        locationClassification === 'DEEP_PREMIUM' ||
        inOteZone;
    } else {
      isLocationAligned = false;
    }

    // 8. Determine whether price is at a key POI aligned with 1H bias
    // Check all ranked POIs where price is inside zone, ordered by rank/grade
    let activeSetupPoi: RankedPoiItem | null = null;
    let isAtKeyPoi = false;
    let isPoiHtfAligned = false;

    // Filter candidate POIs where price is inside zone or within 0.1% buffer
    for (const item of rankedPoiReport.rankedPois) {
      const ctx = item.poiContext;
      const isInside =
        ctx.isPriceInsideZone ||
        (currentPrice >= Math.min(ctx.lowPrice, ctx.highPrice) &&
          currentPrice <= Math.max(ctx.lowPrice, ctx.highPrice));

      if (isInside) {
        // Check alignment with 1H bias
        const expectedDirection = htf1hBias === 'BULLISH' ? 'BULLISH' : 'BEARISH';
        const directionMatches = ctx.direction === expectedDirection;

        // Accept A_PLUS, A, or B grade POIs aligned with bias
        if (directionMatches && (item.grade === 'A_PLUS' || item.grade === 'A' || item.grade === 'B')) {
          activeSetupPoi = item;
          isAtKeyPoi = true;
          isPoiHtfAligned = true;
          break; // Highest ranking matching POI found
        } else if (directionMatches && !activeSetupPoi) {
          // Keep as candidate if no better grade is found
          activeSetupPoi = item;
          isAtKeyPoi = true;
          isPoiHtfAligned = true;
        } else if (!activeSetupPoi) {
          // Counter-trend or unaligned POI
          activeSetupPoi = item;
          isAtKeyPoi = true;
          isPoiHtfAligned = false;
        }
      }
    }

    // If price is not strictly inside an active POI, also check if price recently touched or approached
    // the top aligned POI (within 3 pips)
    if (!activeSetupPoi && (htf1hBias === 'BULLISH' || htf1hBias === 'BEARISH')) {
      const topTargetPoi =
        htf1hBias === 'BULLISH'
          ? rankedPoiReport.topBullishPoi
          : rankedPoiReport.topBearishPoi;

      if (topTargetPoi && topTargetPoi.poiContext.distancePips <= 3.5) {
        activeSetupPoi = topTargetPoi;
        isAtKeyPoi = true;
        isPoiHtfAligned = true;
      }
    }

    const poiConvictionGrade: ConvictionGrade | null = activeSetupPoi?.grade ?? null;

    // 9. Overall 15M setup validity
    const isSetupValid =
      isAtKeyPoi &&
      isPoiHtfAligned &&
      isLocationAligned &&
      (poiConvictionGrade === 'A_PLUS' || poiConvictionGrade === 'A' || poiConvictionGrade === 'B');

    let setupReason = 'AWAITING_15M_POI_OR_LOCATION_ALIGNMENT';
    if (isSetupValid) {
      setupReason = `VALID_15M_SETUP: Price at ${poiConvictionGrade} POI (${activeSetupPoi?.poiContext.kind}) in ${locationClassification} aligned with 1H ${htf1hBias} bias`;
    } else if (!isAtKeyPoi) {
      setupReason = `PRICE_OUTSIDE_15M_POI: Current price ${currentPrice} not inside any active POI`;
    } else if (!isPoiHtfAligned) {
      setupReason = `POI_BIAS_MISMATCH: 15M POI direction does not align with 1H ${htf1hBias} bias`;
    } else if (!isLocationAligned) {
      setupReason = `UNFAVORABLE_LOCATION: 1H ${htf1hBias} bias requires ${htf1hBias === 'BULLISH' ? 'DISCOUNT' : 'PREMIUM'}, but price is in ${locationClassification}`;
    }

    const swingPoints: readonly SwingPoint[] = structureAnalysis.swings;
    const structureBreaks: readonly StructureBreak[] = structureAnalysis.structureBreaks;
    const activeOrderBlocks: OrderBlockZone[] = orderBlockReport.orderBlocks.map((ob) => ob);
    const activeFVGs: FairValueGapZone[] = fvgReport.allGaps.map((fvg) => fvg);
    const liquidityLevels: LiquidityLevel[] = liquidityReport.allPools.map(
      (p) => p.canonicalLevelModel,
    );

    return {
      symbol,
      timeframe: '15M',
      evaluatedAt: latestCandle.timestamp,
      currentPrice,
      htf1hBias,
      isAtKeyPoi,
      activeSetupPoi,
      poiConvictionGrade,
      isPoiHtfAligned,
      locationClassification,
      isLocationAligned,
      inOteZone,
      isSetupValid,
      setupReason,
      dealingRange: activeDealingRange,
      structureAnalysis,
      rankedPoiReport,
      orderBlockReport,
      fvgReport,
      liquidityReport,
      swingPoints,
      structureBreaks,
      activeOrderBlocks,
      activeFVGs,
      liquidityLevels,
    };
  }

  /**
   * Facade method reading 15M candles from Phase 1 CanonicalMarketDataEngine.
   */
  public static evaluateFromMarketData(
    marketDataEngine: CanonicalMarketDataEngine,
    htfAnalysis: Smc1hStructuralAnalysis,
    symbol: InstrumentSymbol,
  ): Smc15mSetupResult {
    const candles15M = marketDataEngine.getCandles(symbol, '15M');
    return this.evaluate15mSetup(candles15M, htfAnalysis, symbol);
  }
}
