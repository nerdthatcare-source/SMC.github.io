/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Structural Take Profit Engine Contracts & Types
 *
 * Defines contracts for multi-tier take-profit targets (TP1, TP2, TP3)
 * anchored directly to opposing liquidity pools and structural swing points.
 */

import { InstrumentSymbol, StructuralTimeframe } from '../types/smc';

export type TakeProfitTargetType =
  | 'INTERNAL_LIQUIDITY_POOL'
  | 'EXTERNAL_SWING_HIGH'
  | 'EXTERNAL_SWING_LOW'
  | 'EQUAL_HIGHS_POOL'
  | 'EQUAL_LOWS_POOL'
  | 'HTF_DEALING_RANGE_EXTREME'
  | 'STRUCTURAL_EXTENSION';

export interface StructuralTargetLevel {
  readonly tier: 'TP1' | 'TP2' | 'TP3';
  readonly price: number;
  readonly targetType: TakeProfitTargetType;
  readonly timeframe: StructuralTimeframe;
  readonly structuralRefId: string;
  readonly rMultiple: number; // Reward to risk multiple at this target
  readonly description: string;
}

export interface TakeProfitCalculationRequest {
  readonly symbol: InstrumentSymbol;
  readonly direction: 'LONG' | 'SHORT';
  readonly entryPrice: number;
  readonly stopLossPrice: number;
  readonly candidateTargets: readonly {
    readonly id: string;
    readonly price: number;
    readonly type: TakeProfitTargetType;
    readonly timeframe: StructuralTimeframe;
    readonly description: string;
  }[];
}

export interface TakeProfitCalculationResult {
  readonly symbol: InstrumentSymbol;
  readonly direction: 'LONG' | 'SHORT';
  readonly entryPrice: number;
  readonly stopLossPrice: number;
  readonly tp1: StructuralTargetLevel;
  readonly tp2: StructuralTargetLevel;
  readonly tp3: StructuralTargetLevel;
  readonly targets: readonly StructuralTargetLevel[];
  readonly rationale: string;
}
