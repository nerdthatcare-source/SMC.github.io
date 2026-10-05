/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Risk-to-Reward & Trade Quality Engine (REPAIRED)
 *
 * Computes actual risk-to-reward metrics from precise structural entry,
 * stop-loss, and multi-tier take-profit levels.
 * Grades institutional trade quality and enforces strict fail-closed rejection
 * of any setup below the required minRiskRewardRatio in RiskManagementSettings.
 */

import { InstrumentSymbol, RiskManagementSettings } from '../types/smc';
import { getInstrumentConfig } from './instrumentMarketConfiguration';
import {
  RiskRewardEvaluationRequest,
  RiskRewardEvaluationResult,
  TradeQualityGrade,
} from './riskRewardTradeQualityContracts';

export class RiskRewardTradeQualityEngine {
  /**
   * Institutional default minimum risk-to-reward ratio (2.5R).
   */
  public static readonly DEFAULT_MIN_RISK_REWARD_RATIO = 2.5;

  /**
   * Evaluates risk, rewards, R:R ratios, and assigns quality grades.
   */
  public static evaluateRiskReward(
    request: RiskRewardEvaluationRequest,
  ): RiskRewardEvaluationResult {
    const {
      symbol,
      direction,
      entryPrice,
      stopLossPrice,
      takeProfit1Price,
      takeProfit2Price,
      takeProfitFinalPrice,
      confluenceScore = 75,
      riskSettings,
    } = request;

    const minRatio =
      riskSettings?.minRiskRewardRatio ?? this.DEFAULT_MIN_RISK_REWARD_RATIO;
    const config = getInstrumentConfig(symbol);
    const factor = Math.pow(10, config.quotePrecision);

    // 1. Calculate risk per unit
    let riskPerUnit: number;
    if (direction === 'LONG') {
      riskPerUnit = entryPrice - stopLossPrice;
    } else {
      riskPerUnit = stopLossPrice - entryPrice;
    }

    if (riskPerUnit <= 0) {
      return {
        symbol,
        direction,
        entryPrice,
        stopLossPrice,
        takeProfit1Price,
        takeProfitFinalPrice: takeProfitFinalPrice ?? takeProfit1Price,
        riskPerUnit: 0,
        rewardTp1: 0,
        rewardFinal: 0,
        riskRewardRatioTp1: 0,
        effectiveRiskRewardRatio: 0,
        minimumRequiredRatio: minRatio,
        tradeQualityGrade: 'REJECTED_BELOW_MIN_RR',
        isApproved: false,
        rejectionReason: `INVALID_RISK: Stop loss (${stopLossPrice}) is on the wrong side of entry (${entryPrice}) for ${direction}`,
        summary: 'Invalid risk geometry: Stop loss is invalid relative to entry price.',
      };
    }

    // 2. Calculate rewards
    let rewardTp1: number;
    if (direction === 'LONG') {
      rewardTp1 = takeProfit1Price - entryPrice;
    } else {
      rewardTp1 = entryPrice - takeProfit1Price;
    }

    let rewardTp2: number | undefined;
    if (takeProfit2Price !== undefined) {
      rewardTp2 =
        direction === 'LONG'
          ? takeProfit2Price - entryPrice
          : entryPrice - takeProfit2Price;
    }

    const finalTarget = takeProfitFinalPrice ?? takeProfit2Price ?? takeProfit1Price;
    let rewardFinal: number;
    if (direction === 'LONG') {
      rewardFinal = finalTarget - entryPrice;
    } else {
      rewardFinal = entryPrice - finalTarget;
    }

    const rrTp1 = Math.round((rewardTp1 / riskPerUnit) * 100) / 100;
    const rrTp2 = rewardTp2 !== undefined ? Math.round((rewardTp2 / riskPerUnit) * 100) / 100 : undefined;
    const rrFinal = Math.round((rewardFinal / riskPerUnit) * 100) / 100;

    // The effective ratio evaluated against minRatio:
    // If multiple TP targets exist, evaluate against primary target (TP1 or composite)
    const effectiveRiskRewardRatio = rrFinal >= rrTp1 ? rrFinal : rrTp1;

    // 3. Governance check: Reject anything below minimum R:R
    if (effectiveRiskRewardRatio < minRatio) {
      return {
        symbol,
        direction,
        entryPrice,
        stopLossPrice,
        takeProfit1Price,
        takeProfit2Price,
        takeProfitFinalPrice: finalTarget,
        riskPerUnit: Math.round(riskPerUnit * factor) / factor,
        rewardTp1: Math.round(rewardTp1 * factor) / factor,
        rewardTp2: rewardTp2 !== undefined ? Math.round(rewardTp2 * factor) / factor : undefined,
        rewardFinal: Math.round(rewardFinal * factor) / factor,
        riskRewardRatioTp1: rrTp1,
        riskRewardRatioTp2: rrTp2,
        effectiveRiskRewardRatio,
        minimumRequiredRatio: minRatio,
        tradeQualityGrade: 'REJECTED_BELOW_MIN_RR',
        isApproved: false,
        rejectionReason: `BELOW_MIN_RISK_REWARD: Setup R:R (${effectiveRiskRewardRatio.toFixed(2)}R) is below minimum required threshold (${minRatio.toFixed(2)}R)`,
        summary: `Rejected: R:R ratio ${effectiveRiskRewardRatio.toFixed(2)}R does not satisfy institutional minimum ${minRatio.toFixed(2)}R.`,
      };
    }

    // 4. Trade Quality Grading
    let grade: TradeQualityGrade;
    if (effectiveRiskRewardRatio >= 3.5 && confluenceScore >= 80) {
      grade = 'GRADE_A_PLUS';
    } else if (effectiveRiskRewardRatio >= 3.0 && confluenceScore >= 75) {
      grade = 'GRADE_A';
    } else if (effectiveRiskRewardRatio >= 2.5) {
      grade = 'GRADE_B';
    } else {
      grade = 'GRADE_C';
    }

    const summary = `Approved [${grade}]: Risk=${riskPerUnit.toFixed(config.quotePrecision)}, TP1=${rewardTp1.toFixed(config.quotePrecision)} (${rrTp1}R), Final=${rewardFinal.toFixed(config.quotePrecision)} (${rrFinal}R), Score=${confluenceScore}`;

    return {
      symbol,
      direction,
      entryPrice,
      stopLossPrice,
      takeProfit1Price,
      takeProfit2Price,
      takeProfitFinalPrice: finalTarget,
      riskPerUnit: Math.round(riskPerUnit * factor) / factor,
      rewardTp1: Math.round(rewardTp1 * factor) / factor,
      rewardTp2: rewardTp2 !== undefined ? Math.round(rewardTp2 * factor) / factor : undefined,
      rewardFinal: Math.round(rewardFinal * factor) / factor,
      riskRewardRatioTp1: rrTp1,
      riskRewardRatioTp2: rrTp2,
      effectiveRiskRewardRatio,
      minimumRequiredRatio: minRatio,
      tradeQualityGrade: grade,
      isApproved: true,
      rejectionReason: null,
      summary,
    };
  }
}
