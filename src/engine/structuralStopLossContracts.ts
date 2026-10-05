/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Structural Stop Loss Engine Contracts & Types
 *
 * Defines contracts for calculating invalidation levels and structural
 * stop-loss prices placed beyond swings and order blocks plus a sensible
 * asset-class buffer across all 43 catalog instruments.
 */

import { InstrumentSymbol, StructuralTimeframe } from '../types/smc';

export type InvalidationAnchorType =
  | 'SWING_EXTREME'
  | 'ORDER_BLOCK_DISTAL_EDGE'
  | 'COMBINED_STRUCTURAL_MINIMUM';

export interface InvalidationAnchor {
  readonly id: string;
  readonly type: InvalidationAnchorType;
  readonly timeframe: StructuralTimeframe;
  readonly price: number;
  readonly description: string;
}

export interface StopLossCalculationRequest {
  readonly symbol: InstrumentSymbol;
  readonly direction: 'LONG' | 'SHORT';
  readonly entryPrice: number;
  readonly anchor: InvalidationAnchor;
  readonly manualBufferPips?: number;
}

export interface StopLossCalculationResult {
  readonly symbol: InstrumentSymbol;
  readonly direction: 'LONG' | 'SHORT';
  readonly entryPrice: number;
  readonly stopLossPrice: number;
  readonly rawAnchorLevel: number;
  readonly anchorType: InvalidationAnchorType;
  readonly anchorDescription: string;
  readonly structuralBufferPrice: number;
  readonly structuralBufferPips: number;
  readonly riskPerUnit: number;
  readonly rationale: string;
}
