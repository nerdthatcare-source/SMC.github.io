/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Risk-to-Reward & Trade Quality Engine Contracts
 *
 * Defines contracts for evaluating actual risk-to-reward metrics,
 * grading setup execution quality, and enforcing minimum R:R governance.
 */

import { InstrumentSymbol, RiskManagementSettings } from '../types/smc';

export type TradeQualityGrade =
  | 'GRADE_A_PLUS'
  | 'GRADE_A'
  | 'GRADE_B'
  | 'GRADE_C'
  | 'REJECTED_BELOW_MIN_RR';

export interface RiskRewardEvaluationRequest {
  readonly symbol: InstrumentSymbol;
  readonly direction: 'LONG' | 'SHORT';
  readonly entryPrice: number;
  readonly stopLossPrice: number;
  readonly takeProfit1Price: number;
  readonly takeProfit2Price?: number;
  readonly takeProfitFinalPrice?: number;
  readonly confluenceScore?: number;
  readonly riskSettings?: Partial<RiskManagementSettings>;
}

export interface RiskRewardEvaluationResult {
  readonly symbol: InstrumentSymbol;
  readonly direction: 'LONG' | 'SHORT';
  readonly entryPrice: number;
  readonly stopLossPrice: number;
  readonly takeProfit1Price: number;
  readonly takeProfit2Price?: number;
  readonly takeProfitFinalPrice: number;
  readonly riskPerUnit: number;
  readonly rewardTp1: number;
  readonly rewardTp2?: number;
  readonly rewardFinal: number;
  readonly riskRewardRatioTp1: number;
  readonly riskRewardRatioTp2?: number;
  readonly effectiveRiskRewardRatio: number;
  readonly minimumRequiredRatio: number;
  readonly tradeQualityGrade: TradeQualityGrade;
  readonly isApproved: boolean;
  readonly rejectionReason: string | null;
  readonly summary: string;
}
