/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Entry Engine Contracts & Types
 *
 * Defines typed specifications for precise structural entries derived
 * directly from Phase 3 POIs (Order Blocks, FVGs, Liquidity Sweeps).
 * Every price generated must trace to a specific structural level from Phases 2-3.
 */

import { InstrumentSymbol, StructuralTimeframe } from '../types/smc';
import { ConvictionGrade } from './smcPoiIntelligenceEngine';

export type EntryModelType =
  | 'FVG_CONSEQUENT_ENCROACHMENT' // 50% CE of Fair Value Gap
  | 'FVG_PROXIMAL_EDGE'           // Leading boundary of Fair Value Gap
  | 'ORDER_BLOCK_PROXIMAL_EDGE'   // Leading edge of Order Block
  | 'ORDER_BLOCK_MEAN_THRESHOLD'  // 50% Mean Threshold of Order Block
  | 'LIQUIDITY_SWEEP_RETEST';     // Retest of swept liquidity price level

export interface JustifyingPoiContract {
  readonly id: string;
  readonly type: 'ORDER_BLOCK' | 'FAIR_VALUE_GAP' | 'LIQUIDITY_POOL';
  readonly timeframe: StructuralTimeframe;
  readonly highPrice: number;
  readonly lowPrice: number;
  readonly convictionGrade?: ConvictionGrade;
  readonly originTimestamp?: number;
}

export interface EntryCalculationRequest {
  readonly symbol: InstrumentSymbol;
  readonly direction: 'LONG' | 'SHORT';
  readonly justifyingPoi: JustifyingPoiContract;
  readonly preferredModel?: EntryModelType;
}

export interface EntryCalculationResult {
  readonly symbol: InstrumentSymbol;
  readonly direction: 'LONG' | 'SHORT';
  readonly entryPrice: number;
  readonly modelType: EntryModelType;
  readonly justifyingPoi: JustifyingPoiContract;
  readonly structuralTraceLevel: number;
  readonly rationale: string;
}
