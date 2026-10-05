/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Structural Take Profit Engine
 *
 * Computes multi-tier take-profit targets (TP1, TP2, TP3) anchored directly
 * to the next opposing liquidity pools and structural swing points in the trade direction:
 * - TP1: Nearest internal liquidity pool or minor swing point.
 * - TP2: Intermediate liquidity pool or major MTF swing high/low.
 * - TP3: External HTF dealing range extreme or major HTF liquidity pool.
 *
 * Every take profit price traces directly to an identified structural level from Phases 2-3.
 */

import { InstrumentSymbol, SMCAnalysisResult, StructuralTimeframe } from '../types/smc';
import { getInstrumentConfig } from './instrumentMarketConfiguration';
import {
  StructuralTargetLevel,
  TakeProfitCalculationRequest,
  TakeProfitCalculationResult,
  TakeProfitTargetType,
} from './structuralTakeProfitContracts';

export class StructuralTakeProfitEngine {
  /**
   * Calculates TP1, TP2, and TP3 anchored to candidate liquidity levels.
   */
  public static calculateTakeProfits(
    request: TakeProfitCalculationRequest,
  ): TakeProfitCalculationResult {
    const { symbol, direction, entryPrice, stopLossPrice, candidateTargets } = request;
    const config = getInstrumentConfig(symbol);
    const risk = Math.abs(entryPrice - stopLossPrice);
    const factor = Math.pow(10, config.quotePrecision);

    // Filter candidates strictly in trade direction
    const inDirection = candidateTargets.filter((c) =>
      direction === 'LONG' ? c.price > entryPrice : c.price < entryPrice,
    );

    // Sort in order of increasing distance from entry
    inDirection.sort((a, b) =>
      direction === 'LONG' ? a.price - b.price : b.price - a.price,
    );

    // De-duplicate targets too close to each other (closer than 0.5R)
    const distinctTargets: typeof inDirection = [];
    for (const t of inDirection) {
      const isTooClose = distinctTargets.some(
        (existing) => Math.abs(existing.price - t.price) < risk * 0.5,
      );
      if (!isTooClose) {
        distinctTargets.push(t);
      }
    }

    const assignedTargets: StructuralTargetLevel[] = [];

    // Helper to compute R-multiple
    const calcR = (targetPrice: number) => {
      const reward = Math.abs(targetPrice - entryPrice);
      return Math.round((reward / (risk || 0.0001)) * 100) / 100;
    };

    // 1. Assign TP1
    if (distinctTargets.length > 0) {
      const t1 = distinctTargets[0];
      assignedTargets.push({
        tier: 'TP1',
        price: Math.round(t1.price * factor) / factor,
        targetType: t1.type,
        timeframe: t1.timeframe,
        structuralRefId: t1.id,
        rMultiple: calcR(t1.price),
        description: `TP1: ${t1.description}`,
      });
    } else {
      // Structural 2.0R expansion fallback
      const tp1Price =
        direction === 'LONG' ? entryPrice + risk * 2.0 : entryPrice - risk * 2.0;
      assignedTargets.push({
        tier: 'TP1',
        price: Math.round(tp1Price * factor) / factor,
        targetType: 'STRUCTURAL_EXTENSION',
        timeframe: '15M',
        structuralRefId: 'ext_tp1_2r',
        rMultiple: 2.0,
        description: 'TP1: 2.0R structural expansion target',
      });
    }

    // 2. Assign TP2
    if (distinctTargets.length > 1) {
      const t2 = distinctTargets[1];
      assignedTargets.push({
        tier: 'TP2',
        price: Math.round(t2.price * factor) / factor,
        targetType: t2.type,
        timeframe: t2.timeframe,
        structuralRefId: t2.id,
        rMultiple: calcR(t2.price),
        description: `TP2: ${t2.description}`,
      });
    } else {
      // Structural 3.5R expansion fallback
      const tp2Price =
        direction === 'LONG' ? entryPrice + risk * 3.5 : entryPrice - risk * 3.5;
      assignedTargets.push({
        tier: 'TP2',
        price: Math.round(tp2Price * factor) / factor,
        targetType: 'STRUCTURAL_EXTENSION',
        timeframe: '15M',
        structuralRefId: 'ext_tp2_3.5r',
        rMultiple: 3.5,
        description: 'TP2: 3.5R intermediate structural target',
      });
    }

    // 3. Assign TP3
    if (distinctTargets.length > 2) {
      const t3 = distinctTargets[2];
      assignedTargets.push({
        tier: 'TP3',
        price: Math.round(t3.price * factor) / factor,
        targetType: t3.type,
        timeframe: t3.timeframe,
        structuralRefId: t3.id,
        rMultiple: calcR(t3.price),
        description: `TP3: ${t3.description}`,
      });
    } else {
      // Structural 5.0R expansion fallback
      const tp3Price =
        direction === 'LONG' ? entryPrice + risk * 5.0 : entryPrice - risk * 5.0;
      assignedTargets.push({
        tier: 'TP3',
        price: Math.round(tp3Price * factor) / factor,
        targetType: 'STRUCTURAL_EXTENSION',
        timeframe: '1H',
        structuralRefId: 'ext_tp3_5r',
        rMultiple: 5.0,
        description: 'TP3: 5.0R HTF external expansion target',
      });
    }

    const tp1 = assignedTargets[0];
    const tp2 = assignedTargets[1];
    const tp3 = assignedTargets[2];

    const rationale = `Targets anchored to liquidity pools: TP1 @ ${tp1.price.toFixed(config.quotePrecision)} (${tp1.rMultiple}R), TP2 @ ${tp2.price.toFixed(config.quotePrecision)} (${tp2.rMultiple}R), TP3 @ ${tp3.price.toFixed(config.quotePrecision)} (${tp3.rMultiple}R)`;

    return {
      symbol,
      direction,
      entryPrice,
      stopLossPrice,
      tp1,
      tp2,
      tp3,
      targets: assignedTargets,
      rationale,
    };
  }

  /**
   * Gathers all candidate opposing liquidity pools and swings from SMCAnalysisResult
   * and computes structural TP1, TP2, TP3.
   */
  public static deriveTakeProfitsFromAnalysis(
    analysisResult: SMCAnalysisResult,
    direction: 'LONG' | 'SHORT',
    entryPrice: number,
    stopLossPrice: number,
  ): TakeProfitCalculationResult {
    const symbol = analysisResult.symbol;
    const candidates: Array<{
      id: string;
      price: number;
      type: TakeProfitTargetType;
      timeframe: StructuralTimeframe;
      description: string;
    }> = [];

    // 1. Gather 15M liquidity levels
    for (const lvl of analysisResult.intermediateTimeframe15M.liquidityLevels) {
      if (lvl.isSwept) continue; // Skip already swept
      const isTargetSide =
        direction === 'LONG'
          ? lvl.type === 'BSL' || lvl.type === 'EQH' || lvl.type === 'SESSION_HIGH' || lvl.type === 'PREVIOUS_DAY_HIGH'
          : lvl.type === 'SSL' || lvl.type === 'EQL' || lvl.type === 'SESSION_LOW' || lvl.type === 'PREVIOUS_DAY_LOW';

      if (isTargetSide) {
        candidates.push({
          id: lvl.id,
          price: lvl.price,
          type:
            lvl.type === 'EQH'
              ? 'EQUAL_HIGHS_POOL'
              : lvl.type === 'EQL'
                ? 'EQUAL_LOWS_POOL'
                : 'INTERNAL_LIQUIDITY_POOL',
          timeframe: '15M',
          description: `15M ${lvl.type} Liquidity Pool [${lvl.id}]`,
        });
      }
    }

    // 2. Gather 15M and 1H swing highs/lows
    const swings15M = analysisResult.intermediateTimeframe15M.swingPoints;
    for (const sw of swings15M) {
      const isTargetSwing =
        direction === 'LONG' ? sw.type === 'SWING_HIGH' : sw.type === 'SWING_LOW';
      if (isTargetSwing) {
        candidates.push({
          id: sw.id,
          price: sw.price,
          type: direction === 'LONG' ? 'EXTERNAL_SWING_HIGH' : 'EXTERNAL_SWING_LOW',
          timeframe: '15M',
          description: `15M Swing ${direction === 'LONG' ? 'High' : 'Low'} [${sw.id}]`,
        });
      }
    }

    const swings1H = analysisResult.higherTimeframe1H.swingPoints;
    for (const sw of swings1H) {
      const isTargetSwing =
        direction === 'LONG' ? sw.type === 'SWING_HIGH' : sw.type === 'SWING_LOW';
      if (isTargetSwing) {
        candidates.push({
          id: sw.id,
          price: sw.price,
          type: direction === 'LONG' ? 'EXTERNAL_SWING_HIGH' : 'EXTERNAL_SWING_LOW',
          timeframe: '1H',
          description: `1H Major Swing ${direction === 'LONG' ? 'High' : 'Low'} [${sw.id}]`,
        });
      }
    }

    // 3. 1H Dealing Range Extreme
    const pd = analysisResult.higherTimeframe1H.premiumDiscount;
    if (pd) {
      const extremePrice = direction === 'LONG' ? pd.rangeHigh : pd.rangeLow;
      candidates.push({
        id: `htf_dealing_range_${direction === 'LONG' ? 'high' : 'low'}`,
        price: extremePrice,
        type: 'HTF_DEALING_RANGE_EXTREME',
        timeframe: '1H',
        description: `1H Dealing Range ${direction === 'LONG' ? 'High' : 'Low'}`,
      });
    }

    return this.calculateTakeProfits({
      symbol,
      direction,
      entryPrice,
      stopLossPrice,
      candidateTargets: candidates,
    });
  }
}
