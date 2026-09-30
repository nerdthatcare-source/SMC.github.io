/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SMC Point of Interest (POI) Intelligence & Ranking Engine
 *
 * Combines Order Blocks, FVGs, and Liquidity Pools into a prioritized, ranked
 * hierarchy of institutional reaction zones.
 *
 * KEY INSTITUTIONAL CAPABILITIES:
 * 1. Confluence Cluster Detection:
 *    - Identifies physical price overlap between an Order Block and a Fair Value Gap (OB + FVG Nesting).
 *    - Flags POIs situated inside Fibonacci Optimal Trade Entry (OTE 61.8% - 79%).
 *    - Connects POIs formed immediately after a liquidity sweep.
 * 2. Institutional Conviction Grading:
 *    - A_PLUS (Score >= 85): Prime setup zone. HTF trend aligned, favorable valuation (Discount/Premium),
 *      unmitigated, high displacement or multi-factor confluence cluster.
 *    - A (Score 70 - 84): Strong structural conviction, unmitigated, aligned with directional bias.
 *    - B (Score 50 - 69): Tradeable internal structure or partially mitigated zone.
 *    - C (Score < 50): Counter-trend or low-conviction secondary level.
 * 3. Multi-Timeframe Ranking:
 *    - Ranks POIs within each timeframe (1H, 15M, 5M) and across the entire analytical stack.
 *
 * Pure calculation: No I/O.
 */

import {
  DirectionalBias,
  InstrumentSymbol,
  StructuralTimeframe,
} from '../types/smc';
import { assertStructuralTimeframe } from './canonicalDataContracts';
import { MarketDataNormalization } from './marketDataNormalization';
import { ActiveDealingRange } from './smcDealingRangeEngine';
import { SmcFairValueGap } from './smcFvgEngine';
import { SmcLiquidityPool } from './smcLiquidityEngine';
import { SmcOrderBlock } from './smcOrderBlockEngine';
import { EvaluatedPoiContext, SmcPoiContextEngine } from './smcPoiContextEngine';

export type ConvictionGrade = 'A_PLUS' | 'A' | 'B' | 'C';

export interface ConfluenceCluster {
  readonly id: string;
  readonly symbol: InstrumentSymbol;
  readonly timeframe: StructuralTimeframe;
  readonly direction: 'BULLISH' | 'BEARISH';
  readonly topPrice: number;
  readonly bottomPrice: number;
  readonly centerPrice: number;
  readonly clusterHeightPips: number;
  readonly constituentPoiIds: readonly string[];
  readonly hasOrderBlock: boolean;
  readonly hasFvg: boolean;
  readonly hasLiquidityPool: boolean;
  readonly inOte: boolean;
  readonly convictionGrade: ConvictionGrade;
  readonly score: number;
  readonly description: string;
}

export interface RankedPoiItem {
  readonly rank: number;
  readonly grade: ConvictionGrade;
  readonly score: number; // 0 - 100
  readonly poiContext: EvaluatedPoiContext;
  readonly isClusterParticipant: boolean;
  readonly clusterId?: string;
}

export interface RankedPoiReport {
  readonly symbol: InstrumentSymbol;
  readonly timeframe: StructuralTimeframe;
  readonly calculatedAt: number;
  readonly totalPoisEvaluated: number;
  readonly rankedPois: readonly RankedPoiItem[];
  readonly clusters: readonly ConfluenceCluster[];
  readonly topBullishPoi: RankedPoiItem | null;
  readonly topBearishPoi: RankedPoiItem | null;
  readonly aPlusCount: number;
  readonly aCount: number;
  readonly bCount: number;
  readonly cCount: number;
}

export class SmcPoiIntelligenceEngine {
  /**
   * Pure calculation: Synthesizes Order Blocks, FVGs, and Liquidity Pools into a ranked POI hierarchy.
   */
  public static rankPointsOfInterest(input: {
    symbol: InstrumentSymbol;
    timeframe: StructuralTimeframe;
    currentPrice: number;
    htfTrendBias: DirectionalBias;
    dealingRange: ActiveDealingRange | null;
    orderBlocks: readonly SmcOrderBlock[];
    fairValueGaps: readonly SmcFairValueGap[];
    liquidityPools: readonly SmcLiquidityPool[];
  }): RankedPoiReport {
    const { symbol, timeframe, currentPrice } = input;
    assertStructuralTimeframe(timeframe);

    // 1. Evaluate context for every individual POI
    const contexts = SmcPoiContextEngine.evaluateAllPois(input);

    if (contexts.length === 0) {
      return {
        symbol,
        timeframe,
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
      };
    }

    // 2. Detect Confluence Clusters (overlapping OB + FVG in the same direction)
    const clusters = this.detectConfluenceClusters(contexts, symbol, timeframe);

    // 3. Score and grade every POI with cluster bonuses
    const rankedPois: RankedPoiItem[] = contexts.map((ctx) => {
      // Find if this POI participates in any cluster
      const cluster = clusters.find((c) => c.constituentPoiIds.includes(ctx.id));
      let finalScore = ctx.contextualScore;

      if (cluster) {
        finalScore += 10; // Cluster confluence bonus
      }

      // Cap between 0 and 100
      finalScore = Math.max(0, Math.min(100, Math.round(finalScore)));

      // Assign institutional conviction grade
      let grade: ConvictionGrade = 'C';
      if (finalScore >= 85) grade = 'A_PLUS';
      else if (finalScore >= 70) grade = 'A';
      else if (finalScore >= 50) grade = 'B';

      return {
        rank: 0, // Assigned after sorting
        grade,
        score: finalScore,
        poiContext: ctx,
        isClusterParticipant: !!cluster,
        clusterId: cluster?.id,
      };
    });

    // 4. Sort ranked POIs descending by conviction score, then proximity to market
    rankedPois.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.poiContext.distancePips - b.poiContext.distancePips;
    });

    // Assign sequential 1-based ranks
    const finalRankedPois = rankedPois.map((p, idx) => ({
      ...p,
      rank: idx + 1,
    }));

    const topBullishPoi = finalRankedPois.find((p) => p.poiContext.direction === 'BULLISH') || null;
    const topBearishPoi = finalRankedPois.find((p) => p.poiContext.direction === 'BEARISH') || null;

    return {
      symbol,
      timeframe,
      calculatedAt: Date.now(),
      totalPoisEvaluated: contexts.length,
      rankedPois: finalRankedPois,
      clusters,
      topBullishPoi,
      topBearishPoi,
      aPlusCount: finalRankedPois.filter((p) => p.grade === 'A_PLUS').length,
      aCount: finalRankedPois.filter((p) => p.grade === 'A').length,
      bCount: finalRankedPois.filter((p) => p.grade === 'B').length,
      cCount: finalRankedPois.filter((p) => p.grade === 'C').length,
    };
  }

  /**
   * Detects physical price overlap clusters between different POI types in the same direction.
   */
  private static detectConfluenceClusters(
    contexts: readonly EvaluatedPoiContext[],
    symbol: InstrumentSymbol,
    timeframe: StructuralTimeframe,
  ): readonly ConfluenceCluster[] {
    const clusters: ConfluenceCluster[] = [];

    // Group POIs by direction (Bullish vs Bearish)
    const bullishPois = contexts.filter((c) => c.direction === 'BULLISH');
    const bearishPois = contexts.filter((c) => c.direction === 'BEARISH');

    const scanGroups = [bullishPois, bearishPois];

    for (const group of scanGroups) {
      if (group.length < 2) continue;

      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const a = group[i];
          const b = group[j];

          // Check for price overlap: max(a.low, b.low) <= min(a.high, b.high)
          const overlapLow = Math.max(a.lowPrice, b.lowPrice);
          const overlapHigh = Math.min(a.highPrice, b.highPrice);

          if (overlapLow <= overlapHigh) {
            // Overlap confirmed!
            const kinds = new Set([a.kind, b.kind]);
            const hasOrderBlock = kinds.has('ORDER_BLOCK');
            const hasFvg = kinds.has('FAIR_VALUE_GAP');
            const hasLiquidityPool = kinds.has('LIQUIDITY_POOL');
            const inOte = a.inOteZone || b.inOteZone;

            const clusterHeight = overlapHigh - overlapLow;
            const clusterHeightPips = MarketDataNormalization.priceDeltaToPips(clusterHeight, symbol);
            const centerPrice = MarketDataNormalization.roundToPrecision(
              (overlapHigh + overlapLow) / 2,
              symbol,
            );

            let clusterScore = Math.round((a.contextualScore + b.contextualScore) / 2) + 10;
            if (hasOrderBlock && hasFvg) clusterScore += 10; // Nested OB + FVG
            if (inOte) clusterScore += 5;
            clusterScore = Math.min(100, clusterScore);

            let grade: ConvictionGrade = 'B';
            if (clusterScore >= 85) grade = 'A_PLUS';
            else if (clusterScore >= 70) grade = 'A';

            const description = `${a.direction} Confluence Cluster: ${Array.from(kinds).join(' + ')}${
              inOte ? ' inside OTE' : ''
            }`;

            clusters.push({
              id: `CLUSTER_${symbol}_${a.id}_${b.id}`,
              symbol,
              timeframe,
              direction: a.direction,
              topPrice: overlapHigh,
              bottomPrice: overlapLow,
              centerPrice,
              clusterHeightPips,
              constituentPoiIds: [a.id, b.id],
              hasOrderBlock,
              hasFvg,
              hasLiquidityPool,
              inOte,
              convictionGrade: grade,
              score: clusterScore,
              description,
            });
          }
        }
      }
    }

    return clusters;
  }
}
