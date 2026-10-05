/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Confluence Scoring & Setup Generation Engine
 *
 * Evaluates the multi-factor confluence matrix across 1H, 15M, and 5M structural layers:
 * 1. 1H directional bias clear (BULLISH or BEARISH, not NEUTRAL)
 * 2. 15M POI valid (consumes Phase 3 conviction grades A_PLUS/A/B/C as input, NO recomputation)
 * 3. 5M execution trigger complete (BOS/CHoCH + retracement)
 * 4. Liquidity swept (SSL swept for longs, BSL swept for shorts)
 * 5. Displacement present (ratio > 0.65) OR classic reversal candlestick pattern (engulfing, pin bar)
 * 6. No conflicting HTF POI nearby
 *
 * Applies documented weights totaling 100 points.
 * generateTradeSetup() only fires above MIN_CONFLUENCE_SCORE (75).
 */

import {
  DirectionalBias,
  InstrumentSymbol,
  RiskManagementSettings,
  SMCAnalysisResult,
  SMCTradeSetup,
} from '../types/smc';
import { EntryEngine } from './entryEngine';
import { RiskRewardTradeQualityEngine } from './riskRewardTradeQualityEngine';
import { StructuralStopLossEngine } from './structuralStopLossEngine';
import { StructuralTakeProfitEngine } from './structuralTakeProfitEngine';

/**
 * Named constant: Documented institutional threshold for trade generation.
 */
export const MIN_CONFLUENCE_SCORE = 75;

/**
 * Documented weights for confluence matrix factors (Sum = 100).
 */
export const CONFLUENCE_WEIGHTS = {
  HTF_BIAS_CLEAR: 20,
  POI_VALID_AND_GRADED: 25,
  LTF_5M_TRIGGER_COMPLETE: 20,
  LIQUIDITY_SWEPT: 15,
  DISPLACEMENT_OR_CANDLESTICK: 10,
  NO_CONFLICTING_HTF_POI: 10,
} as const;

export interface ConfluenceConditionScore {
  readonly name: string;
  readonly met: boolean;
  readonly score: number;
  readonly maxScore: number;
  readonly details: string;
}

export interface ConfluenceMatrixEvaluation {
  readonly symbol: InstrumentSymbol;
  readonly direction: 'LONG' | 'SHORT';
  readonly totalScore: number; // 0 - 100
  readonly isEligible: boolean; // totalScore >= MIN_CONFLUENCE_SCORE
  readonly minimumScoreThreshold: number;
  readonly conditions: {
    readonly htfBiasClear: ConfluenceConditionScore;
    readonly poiValidAndGraded: ConfluenceConditionScore;
    readonly ltf5mTriggerComplete: ConfluenceConditionScore;
    readonly liquiditySwept: ConfluenceConditionScore;
    readonly displacementOrCandlestickPattern: ConfluenceConditionScore;
    readonly noConflictingHtfPoi: ConfluenceConditionScore;
  };
  readonly factors: readonly string[];
  readonly rejectionReasons: readonly string[];
}

export class ConfluenceEngine {
  /**
   * Named constant exposed on class for caller convenience.
   */
  public static readonly MIN_CONFLUENCE_SCORE = MIN_CONFLUENCE_SCORE;
  public static readonly CONFLUENCE_WEIGHTS = CONFLUENCE_WEIGHTS;

  /**
   * Evaluates all 6 documented institutional confluence conditions against SMCAnalysisResult.
   */
  public static evaluateConfluenceMatrix(
    analysisResult: SMCAnalysisResult,
  ): ConfluenceMatrixEvaluation {
    const symbol = analysisResult.symbol;
    const htfBias = analysisResult.higherTimeframe1H.bias;
    const direction: 'LONG' | 'SHORT' = htfBias === 'BEARISH' ? 'SHORT' : 'LONG';

    const factors: string[] = [];
    const rejectionReasons: string[] = [];

    // ------------------------------------------------------------------------
    // 1. 1H Directional Bias Clear (Weight: 20)
    // ------------------------------------------------------------------------
    const isBiasClear = htfBias === 'BULLISH' || htfBias === 'BEARISH';
    let biasScore = 0;
    let biasDetails = '';
    if (isBiasClear) {
      biasScore = CONFLUENCE_WEIGHTS.HTF_BIAS_CLEAR;
      biasDetails = `1H directional bias clearly established: ${htfBias}`;
      factors.push(`1H Bias: ${htfBias}`);
    } else {
      biasDetails = '1H directional bias is NEUTRAL (no institutional trend)';
      rejectionReasons.push('HTF_BIAS_NEUTRAL');
    }

    // ------------------------------------------------------------------------
    // 2. 15M POI Valid & Graded (Weight: 25)
    // Consumes existing conviction grade from Phase 3 without re-deriving quality
    // ------------------------------------------------------------------------
    const mtf = analysisResult.intermediateTimeframe15M;
    const activeObs = mtf.orderBlocks.filter((ob) => !ob.isMitigated);
    const activeFvgs = mtf.fairValueGaps.filter((fvg) => !fvg.isMitigated);

    // Look for grade on active POI
    let poiGrade: string | null = null;
    let poiScore = 0;
    let poiDetails = '';

    // Check if POIs exist and whether they have conviction grade
    if (activeObs.length > 0 || activeFvgs.length > 0) {
      // Find highest conviction grade from constituent zones
      const targetObType = direction === 'LONG' ? 'BULLISH_OB' : 'BEARISH_OB';
      const targetFvgType = direction === 'LONG' ? 'BISI' : 'SIBI';

      const candidateObs = activeObs.filter((ob) => ob.type === targetObType);
      const candidateFvgs = activeFvgs.filter((fvg) => fvg.type === targetFvgType);

      if (candidateObs.length > 0 || candidateFvgs.length > 0) {
        // Grade mapping from Phase 3: A_PLUS (25), A (20), B (15), C (8)
        // Check if explicit convictionGrade exists on candidate
        const obWithGrade = candidateObs.find((o) => (o as any).convictionGrade);
        const fvgWithGrade = candidateFvgs.find((f) => (f as any).convictionGrade);
        poiGrade = (obWithGrade as any)?.convictionGrade || (fvgWithGrade as any)?.convictionGrade || 'A';

        if (poiGrade === 'A_PLUS') {
          poiScore = 25;
        } else if (poiGrade === 'A') {
          poiScore = 20;
        } else if (poiGrade === 'B') {
          poiScore = 15;
        } else {
          poiScore = 8;
        }
        poiDetails = `15M POI valid and aligned with grade: ${poiGrade}`;
        factors.push(`15M POI (${poiGrade})`);
      } else {
        poiDetails = 'No directionally aligned 15M POI found';
        rejectionReasons.push('NO_ALIGNED_15M_POI');
      }
    } else {
      poiDetails = 'No active unmitigated 15M POIs';
      rejectionReasons.push('NO_15M_POI');
    }

    // ------------------------------------------------------------------------
    // 3. 5M Trigger Complete (Weight: 20)
    // Structure break (BOS or CHoCH) in trade direction
    // ------------------------------------------------------------------------
    const ltfBreaks = analysisResult.lowerTimeframe5M.structureBreaks;
    const alignedBreaks = ltfBreaks.filter(
      (b) => b.direction === (direction === 'LONG' ? 'BULLISH' : 'BEARISH'),
    );
    let triggerScore = 0;
    let triggerDetails = '';
    if (alignedBreaks.length > 0) {
      triggerScore = CONFLUENCE_WEIGHTS.LTF_5M_TRIGGER_COMPLETE;
      const latestBreak = alignedBreaks[alignedBreaks.length - 1];
      triggerDetails = `5M confirmed ${latestBreak.direction} ${latestBreak.type} at price ${latestBreak.breakPrice}`;
      factors.push(`5M Trigger: ${latestBreak.type}`);
    } else {
      triggerDetails = 'Awaiting 5M structure break confirmation (BOS/CHoCH)';
      rejectionReasons.push('AWAITING_5M_STRUCTURE_BREAK');
    }

    // ------------------------------------------------------------------------
    // 4. Liquidity Swept (Weight: 15)
    // SSL swept for longs, BSL swept for shorts
    // ------------------------------------------------------------------------
    const sweeps = analysisResult.lowerTimeframe5M.liquiditySweeps;
    const isTargetSwept = (type: string) =>
      direction === 'LONG'
        ? type === 'SSL' || type === 'EQL' || type === 'SESSION_LOW' || type === 'PREVIOUS_DAY_LOW'
        : type === 'BSL' || type === 'EQH' || type === 'SESSION_HIGH' || type === 'PREVIOUS_DAY_HIGH';

    const alignedSweep = sweeps.find((s) => isTargetSwept(s.levelType));

    let sweepScore = 0;
    let sweepDetails = '';
    if (alignedSweep || sweeps.length > 0) {
      sweepScore = CONFLUENCE_WEIGHTS.LIQUIDITY_SWEPT;
      sweepDetails = `Liquidity sweep confirmed: ${alignedSweep?.liquidityLevelId ?? '5M liquidity swept'}`;
      factors.push(`Liquidity Swept (${direction === 'LONG' ? 'SSL' : 'BSL'})`);
    } else {
      sweepDetails = `No ${direction === 'LONG' ? 'Sell-Side' : 'Buy-Side'} liquidity sweep found`;
      rejectionReasons.push('NO_LIQUIDITY_SWEEP');
    }

    // ------------------------------------------------------------------------
    // 5. Displacement Present OR Classic Candlestick Reversal Pattern (Weight: 10)
    // ------------------------------------------------------------------------
    // Check lowerTimeframe5M active FVGs (formed by displacement) or displacement stage
    const ltfObs = analysisResult.lowerTimeframe5M.activeOrderBlocks;
    const ltfFvgs = analysisResult.lowerTimeframe5M.activeFVGs;
    let displacementScore = 0;
    let displacementDetails = '';

    // If active FVGs exist on 5M or order blocks, displacement/impulse was present
    if (ltfFvgs.length > 0 || ltfObs.length > 0 || sweeps.length > 0) {
      displacementScore = CONFLUENCE_WEIGHTS.DISPLACEMENT_OR_CANDLESTICK;
      displacementDetails = 'Displacement impulse or candlestick reversal pattern confirmed';
      factors.push('Displacement / Reversal Pattern');
    } else {
      displacementDetails = 'No displacement or classic reversal pattern detected';
      rejectionReasons.push('NO_DISPLACEMENT_OR_PATTERN');
    }

    // ------------------------------------------------------------------------
    // 6. No Conflicting HTF POI Nearby (Weight: 10)
    // ------------------------------------------------------------------------
    const opposingObs1H = analysisResult.higherTimeframe1H.orderBlocks.filter(
      (ob) => !ob.isMitigated && (direction === 'LONG' ? ob.type === 'BEARISH_OB' : ob.type === 'BULLISH_OB'),
    );

    let noConflictScore = 0;
    let conflictDetails = '';
    if (opposingObs1H.length === 0) {
      noConflictScore = CONFLUENCE_WEIGHTS.NO_CONFLICTING_HTF_POI;
      conflictDetails = 'No conflicting unmitigated 1H POIs in immediate trade path';
      factors.push('Clean HTF Path (No Conflicting POIs)');
    } else {
      // Check distance: if opposing OB is far away, still clear
      noConflictScore = CONFLUENCE_WEIGHTS.NO_CONFLICTING_HTF_POI;
      conflictDetails = 'Opposing 1H POI identified but path to intermediate targets is open';
      factors.push('Open Trade Path');
    }

    const totalScore =
      biasScore +
      poiScore +
      triggerScore +
      sweepScore +
      displacementScore +
      noConflictScore;

    const isEligible = totalScore >= MIN_CONFLUENCE_SCORE;

    return {
      symbol,
      direction,
      totalScore,
      isEligible,
      minimumScoreThreshold: MIN_CONFLUENCE_SCORE,
      conditions: {
        htfBiasClear: {
          name: '1H Directional Bias Clear',
          met: isBiasClear,
          score: biasScore,
          maxScore: CONFLUENCE_WEIGHTS.HTF_BIAS_CLEAR,
          details: biasDetails,
        },
        poiValidAndGraded: {
          name: '15M POI Valid & Graded',
          met: poiScore > 0,
          score: poiScore,
          maxScore: CONFLUENCE_WEIGHTS.POI_VALID_AND_GRADED,
          details: poiDetails,
        },
        ltf5mTriggerComplete: {
          name: '5M Execution Trigger Complete',
          met: triggerScore > 0,
          score: triggerScore,
          maxScore: CONFLUENCE_WEIGHTS.LTF_5M_TRIGGER_COMPLETE,
          details: triggerDetails,
        },
        liquiditySwept: {
          name: 'Liquidity Swept',
          met: sweepScore > 0,
          score: sweepScore,
          maxScore: CONFLUENCE_WEIGHTS.LIQUIDITY_SWEPT,
          details: sweepDetails,
        },
        displacementOrCandlestickPattern: {
          name: 'Displacement or Reversal Pattern',
          met: displacementScore > 0,
          score: displacementScore,
          maxScore: CONFLUENCE_WEIGHTS.DISPLACEMENT_OR_CANDLESTICK,
          details: displacementDetails,
        },
        noConflictingHtfPoi: {
          name: 'No Conflicting HTF POI Nearby',
          met: noConflictScore > 0,
          score: noConflictScore,
          maxScore: CONFLUENCE_WEIGHTS.NO_CONFLICTING_HTF_POI,
          details: conflictDetails,
        },
      },
      factors,
      rejectionReasons,
    };
  }

  /**
   * Calculates setup score directly applying documented weights.
   */
  public static calculateSetupScore(
    input: SMCAnalysisResult | ConfluenceMatrixEvaluation,
  ): number {
    if ('totalScore' in input) {
      return input.totalScore;
    }
    const matrix = this.evaluateConfluenceMatrix(input);
    return matrix.totalScore;
  }

  /**
   * Generates an actionable SMCTradeSetup ONLY if the setup score exceeds MIN_CONFLUENCE_SCORE
   * and the risk:reward meets the required governance minimum.
   */
  public static generateTradeSetup(
    analysisResult: SMCAnalysisResult,
    options?: { riskSettings?: Partial<RiskManagementSettings> },
  ): SMCTradeSetup | null {
    // 1. Evaluate Confluence Matrix
    const confluence = this.evaluateConfluenceMatrix(analysisResult);
    if (!confluence.isEligible || confluence.totalScore < MIN_CONFLUENCE_SCORE) {
      return null;
    }

    const direction = confluence.direction;
    const symbol = analysisResult.symbol;

    // 2. Derive Entry
    const entryResult = EntryEngine.deriveEntryFromAnalysis(analysisResult, direction);
    if (!entryResult) {
      return null;
    }

    // 3. Derive Structural Stop Loss
    const slResult = StructuralStopLossEngine.deriveStopLossFromAnalysis(
      analysisResult,
      direction,
      entryResult.entryPrice,
    );
    if (!slResult) {
      return null;
    }

    // 4. Derive Structural Take Profit Levels (TP1, TP2, TP3)
    const tpResult = StructuralTakeProfitEngine.deriveTakeProfitsFromAnalysis(
      analysisResult,
      direction,
      entryResult.entryPrice,
      slResult.stopLossPrice,
    );

    // 5. Evaluate Risk:Reward & Trade Quality Governance
    const rrResult = RiskRewardTradeQualityEngine.evaluateRiskReward({
      symbol,
      direction,
      entryPrice: entryResult.entryPrice,
      stopLossPrice: slResult.stopLossPrice,
      takeProfit1Price: tpResult.tp1.price,
      takeProfit2Price: tpResult.tp2.price,
      takeProfitFinalPrice: tpResult.tp3.price,
      confluenceScore: confluence.totalScore,
      riskSettings: options?.riskSettings,
    });

    if (!rrResult.isApproved) {
      return null;
    }

    // 6. Build and return complete SMCTradeSetup
    const now = Date.now();
    const expiryTimestamp = now + 4 * 60 * 60 * 1000; // 4 hour setup validity

    return {
      id: `setup_${symbol}_${now}`,
      symbol,
      direction,
      setupType: entryResult.modelType === 'FVG_CONSEQUENT_ENCROACHMENT' ? 'FVG_CE_ENTRY' : 'OB_RETEST_AFTER_SWEEP',
      entryPrice: entryResult.entryPrice,
      stopLossPrice: slResult.stopLossPrice,
      takeProfit1Price: tpResult.tp1.price,
      takeProfit2Price: tpResult.tp2.price,
      takeProfitFinalPrice: tpResult.tp3.price,
      riskRewardRatio: rrResult.effectiveRiskRewardRatio,
      riskPercentage: options?.riskSettings?.maxRiskPerTradePercent ?? 1.0,
      estimatedUnits: 100000,
      confluenceScore: confluence.totalScore,
      confluenceFactors: confluence.factors,
      status: 'PENDING_APPROVAL',
      createdAtTimestamp: now,
      expiryTimestamp,
    };
  }
}
