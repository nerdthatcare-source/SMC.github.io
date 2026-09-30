/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SMC Multi-Timeframe Orchestration Engine
 *
 * Coordinates the institutional 3-tier hierarchy:
 * 1. 1H Structural Engine (HTF Directional Bias & Dealing Range)
 * 2. 15M Setup Engine (MTF Key POI & Premium/Discount Location)
 * 3. 5M Execution Engine (LTF 4-Stage Confirmation: Sweep -> Displacement -> BOS/CHoCH -> Retracement)
 *
 * CRITICAL MULTI-TIMEFRAME INTEGRITY AUDIT:
 * - Cross-checks that 1H bias, 15M location, and 5M trigger reference the exact same underlying move.
 * - Detects and rejects counter-bias signals (no silent override).
 * - Cross-checks Phase 1's CandleIntegrityEngine sync score. If sync score is degraded (< 70),
 *   the entire pipeline FAILS CLOSED (all setups blocked).
 */

import {
  Candle,
  DirectionalBias,
  InstrumentSymbol,
} from '../types/smc';
import { assertStructuralTimeframe } from './canonicalDataContracts';
import {
  CandleIntegrityEngine,
  MultiTimeframeIntegrityReport,
} from './candleIntegrityEngine';
import { CanonicalMarketDataEngine } from './canonicalMarketDataEngine';
import { Smc15mSetupEngine, Smc15mSetupResult } from './smc15mSetupEngine';
import { Smc1hStructuralAnalysis, Smc1hStructuralEngine } from './smc1hStructuralEngine';
import { Smc5mExecutionEngine, Smc5mExecutionResult } from './smc5mExecutionEngine';

export type MtfAlignmentStatus =
  | 'ALIGNMENT_CONFIRMED'
  | 'ALIGNMENT_PARTIAL'
  | 'ALIGNMENT_CONTRADICTION'
  | 'FAIL_CLOSED_INTEGRITY';

export interface MultiTimeframeAlignmentCheck {
  readonly passed: boolean;
  readonly failClosed: boolean;
  readonly syncScore: number;
  readonly biasAgreement: boolean;
  readonly locationAgreement: boolean;
  readonly triggerAgreement: boolean;
  readonly rationales: readonly string[];
}

export interface MultiTimeframeOrchestrationResult {
  readonly symbol: InstrumentSymbol;
  readonly orchestratedAt: number;
  readonly status: MtfAlignmentStatus;
  readonly overallBias: DirectionalBias;
  readonly isExecutionReady: boolean;
  readonly htf1h: Smc1hStructuralAnalysis;
  readonly mtf15m: Smc15mSetupResult;
  readonly ltf5m: Smc5mExecutionResult;
  readonly candleIntegrity: MultiTimeframeIntegrityReport;
  readonly alignmentCheck: MultiTimeframeAlignmentCheck;
  readonly orchestrationSummary: string;
}

export class SmcMultiTimeframeEngine {
  /** Minimum acceptable sync score from Phase 1 CandleIntegrityEngine */
  public static readonly MIN_ACCEPTABLE_SYNC_SCORE = 70;

  /**
   * Orchestrates the 1H -> 15M -> 5M pipeline with full integrity cross-checks.
   */
  public static orchestrateMultiTimeframeAnalysis(input: {
    symbol: InstrumentSymbol;
    candles1H: readonly Candle[];
    candles15M: readonly Candle[];
    candles5M: readonly Candle[];
    candles1M?: readonly Candle[];
    runContext?: string;
  }): MultiTimeframeOrchestrationResult {
    const { symbol, candles1H, candles15M, candles5M, candles1M, runContext } = input;
    const orchestratedAt = Date.now();

    // 1. Audit cross-timeframe candle integrity (Phase 1)
    const candleIntegrity = CandleIntegrityEngine.auditMultiTimeframeSync(
      symbol,
      candles1H,
      candles15M,
      candles5M,
      candles1M,
    );

    // 2. Step 1: Run 1H Structural Engine
    const htf1h = Smc1hStructuralEngine.analyze1hCandles(candles1H, symbol);

    // 3. Step 2: Run 15M Setup Engine (using 1H structural bias)
    const mtf15m = Smc15mSetupEngine.evaluate15mSetup(candles15M, htf1h, symbol);

    // 4. Step 3: Run 5M Execution Engine (using 1H bias + 15M setup context)
    const ltf5m = Smc5mExecutionEngine.evaluate5mExecution({
      candles5M,
      htf1hAnalysis: htf1h,
      setup15mResult: mtf15m,
      symbolOverride: symbol,
      runContext,
    });

    // 5. Multi-Timeframe Integrity & Contradiction Cross-Check
    const rationales: string[] = [];
    let failClosed = false;
    let biasAgreement = false;
    let locationAgreement = false;
    let triggerAgreement = false;

    // Check A: Data Integrity Gate (Fail closed if sync score < 70)
    if (candleIntegrity.syncScore < this.MIN_ACCEPTABLE_SYNC_SCORE) {
      failClosed = true;
      rationales.push(
        `FAIL_CLOSED: Candle integrity sync score ${candleIntegrity.syncScore}% below minimum required ${this.MIN_ACCEPTABLE_SYNC_SCORE}%. Structural desynchronization detected.`,
      );
    } else {
      rationales.push(
        `DATA_INTEGRITY_PASSED: Candle integrity sync score ${candleIntegrity.syncScore}% meets threshold.`,
      );
    }

    // Check B: 1H Bias Confirmation
    if (htf1h.directionalBias !== 'NEUTRAL') {
      biasAgreement = true;
      rationales.push(
        `HTF_BIAS_ESTABLISHED: 1H DirectionalBias is ${htf1h.directionalBias} (${htf1h.marketRegime}).`,
      );
    } else {
      rationales.push(
        `HTF_BIAS_NEUTRAL: 1H structure does not exhibit a clear directional expansion or break.`,
      );
    }

    // Check C: 15M Location Agreement
    if (mtf15m.isLocationAligned) {
      locationAgreement = true;
      rationales.push(
        `LOCATION_ALIGNED: 15M price in ${mtf15m.locationClassification} aligns with 1H ${htf1h.directionalBias} bias.`,
      );
    } else {
      rationales.push(
        `LOCATION_MISALIGNED: 15M price in ${mtf15m.locationClassification} does not favor 1H ${htf1h.directionalBias} bias.`,
      );
    }

    // Check D: 5M Contradiction Check (CRITICAL)
    if (ltf5m.contradictsHtfBias) {
      rationales.push(
        `CONTRADICTION_REJECTED: 5M signal contradicts 1H ${htf1h.directionalBias} bias (${ltf5m.rejectionReason}). Setup blocked.`,
      );
    } else if (ltf5m.isTriggerConfirmed) {
      triggerAgreement = true;
      rationales.push(
        `TRIGGER_CONFIRMED: 5M 4-stage confirmation sequence complete in direction of 1H ${htf1h.directionalBias} bias.`,
      );
    } else {
      rationales.push(
        `TRIGGER_PENDING: 5M confirmation state is ${ltf5m.triggerState} (${ltf5m.rejectionReason ?? 'in progress'}).`,
      );
    }

    const alignmentPassed =
      !failClosed &&
      !ltf5m.contradictsHtfBias &&
      biasAgreement &&
      locationAgreement;

    const alignmentCheck: MultiTimeframeAlignmentCheck = {
      passed: alignmentPassed,
      failClosed,
      syncScore: candleIntegrity.syncScore,
      biasAgreement,
      locationAgreement,
      triggerAgreement,
      rationales,
    };

    // Determine status
    let status: MtfAlignmentStatus = 'ALIGNMENT_PARTIAL';
    if (failClosed) {
      status = 'FAIL_CLOSED_INTEGRITY';
    } else if (ltf5m.contradictsHtfBias) {
      status = 'ALIGNMENT_CONTRADICTION';
    } else if (alignmentPassed && triggerAgreement) {
      status = 'ALIGNMENT_CONFIRMED';
    } else {
      status = 'ALIGNMENT_PARTIAL';
    }

    const isExecutionReady =
      status === 'ALIGNMENT_CONFIRMED' &&
      ltf5m.isTriggerConfirmed &&
      !ltf5m.contradictsHtfBias &&
      !failClosed;

    let orchestrationSummary = '';
    if (status === 'FAIL_CLOSED_INTEGRITY') {
      orchestrationSummary = `FAIL-CLOSED: Cross-timeframe data desync (Sync score: ${candleIntegrity.syncScore}%). All setups quarantined.`;
    } else if (status === 'ALIGNMENT_CONTRADICTION') {
      orchestrationSummary = `REJECTED: 5M lower-timeframe trigger directly contradicts 1H HTF ${htf1h.directionalBias} bias.`;
    } else if (status === 'ALIGNMENT_CONFIRMED') {
      orchestrationSummary = `ACTIVE SETUP TRIGGERED: 1H ${htf1h.directionalBias} + 15M ${mtf15m.locationClassification} POI + 5M Confirmed Trigger.`;
    } else {
      orchestrationSummary = `MONITORING: 1H Bias is ${htf1h.directionalBias}; 15M Location ${mtf15m.locationClassification}; 5M is ${ltf5m.triggerState}.`;
    }

    return {
      symbol,
      orchestratedAt,
      status,
      overallBias: htf1h.directionalBias,
      isExecutionReady,
      htf1h,
      mtf15m,
      ltf5m,
      candleIntegrity,
      alignmentCheck,
      orchestrationSummary,
    };
  }

  /**
   * Facade method orchestrating directly from CanonicalMarketDataEngine.
   */
  public static orchestrateFromMarketData(
    marketDataEngine: CanonicalMarketDataEngine,
    symbol: InstrumentSymbol,
    runContext?: string,
  ): MultiTimeframeOrchestrationResult {
    const candles1H = marketDataEngine.getCandles(symbol, '1H');
    const candles15M = marketDataEngine.getCandles(symbol, '15M');
    const candles5M = marketDataEngine.getCandles(symbol, '5M');
    const candles1M = marketDataEngine.getCandles(symbol, '1M');

    return this.orchestrateMultiTimeframeAnalysis({
      symbol,
      candles1H,
      candles15M,
      candles5M,
      candles1M,
      runContext,
    });
  }
}
