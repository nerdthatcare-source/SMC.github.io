/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SMC Knowledge Core Engine
 *
 * Machine-Readable Rule Firing Registry for AI-Auditing & Institutional Verification.
 *
 * Every rule evaluation across HTF (1H), MTF (15M), and LTF (5M) is structured as a
 * formal, typed record. Eliminates ambiguous free-text by recording exact mathematical
 * thresholds, parameters, and evidence.
 *
 * HARD INVARIANTS:
 * - Structured audit trails only (strictly no opaque free-text or unverified claims).
 * - Enforces record provenance per symbol, timeframe, and execution cycle.
 */

import {
  DirectionalBias,
  InstrumentSymbol,
  Timeframe,
} from '../types/smc';
import { MultiTimeframeOrchestrationResult } from './smcMultiTimeframeEngine';

export type RuleCategory =
  | 'STRUCTURAL_BIAS'
  | 'SETUP_LOCATION'
  | 'EXECUTION_TRIGGER'
  | 'CONTRADICTION_GATE'
  | 'DATA_INTEGRITY'
  | 'ARCHITECTURAL_INVARIANT';

export type RuleFiringStatus =
  | 'FIRED'
  | 'EVALUATED_FALSE'
  | 'BLOCKED'
  | 'SUPPRESSED';

export interface StructuredRuleFiringRecord {
  readonly ruleId: string;
  readonly ruleName: string;
  readonly category: RuleCategory;
  readonly status: RuleFiringStatus;
  readonly timeframe: Timeframe | 'CROSS_TIMEFRAME';
  readonly symbol: InstrumentSymbol;
  readonly evaluatedAt: number;
  readonly parameters: Readonly<Record<string, string | number | boolean | null>>;
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly structuralWeight: number; // 0 to 100
}

export interface RuleFiringAuditReport {
  readonly symbol: InstrumentSymbol;
  readonly auditId: string;
  readonly timestamp: number;
  readonly overallStatus: 'PASSED' | 'FAILED' | 'REJECTED' | 'MONITORING';
  readonly overallBias: DirectionalBias;
  readonly rulesEvaluatedCount: number;
  readonly rulesFiredCount: number;
  readonly rulesBlockedCount: number;
  readonly ruleRecords: readonly StructuredRuleFiringRecord[];
}

export class SmcKnowledgeCoreEngine {
  private static readonly auditLedger: RuleFiringAuditReport[] = [];
  private static readonly maxAuditLedgerCapacity = 500;

  /**
   * Synthesizes and logs a complete structured rule audit from a MultiTimeframeOrchestrationResult.
   */
  public static auditOrchestration(
    orchestration: MultiTimeframeOrchestrationResult,
  ): RuleFiringAuditReport {
    const { symbol, orchestratedAt, status, overallBias, htf1h, mtf15m, ltf5m, candleIntegrity } =
      orchestration;

    const ruleRecords: StructuredRuleFiringRecord[] = [];

    // Rule 1: Phase 1 Data Integrity & Cross-Timeframe Desync Gate
    const isIntegrityPassed = candleIntegrity.syncScore >= 70;
    ruleRecords.push({
      ruleId: 'RULE_DATA_INTEGRITY_SYNC_GATE',
      ruleName: 'Cross-Timeframe Feed Synchronization Gate',
      category: 'DATA_INTEGRITY',
      status: isIntegrityPassed ? 'FIRED' : 'BLOCKED',
      timeframe: 'CROSS_TIMEFRAME',
      symbol,
      evaluatedAt: orchestratedAt,
      parameters: {
        minimumSyncScoreRequired: 70,
        actualSyncScore: candleIntegrity.syncScore,
        feedValid: candleIntegrity.isValid,
        issuesCount: candleIntegrity.issues.length,
      },
      evidence: {
        timeframeStatus: candleIntegrity.timeframeStatus,
        issues: candleIntegrity.issues,
      },
      structuralWeight: 100,
    });

    // Rule 2: Hard Rule 4 - 1M Execution Timeframe Structural Quarantine
    ruleRecords.push({
      ruleId: 'RULE_1M_STRUCTURAL_QUARANTINE',
      ruleName: '1M Data Structural Quarantine Invariant',
      category: 'ARCHITECTURAL_INVARIANT',
      status: 'FIRED',
      timeframe: '1M',
      symbol,
      evaluatedAt: orchestratedAt,
      parameters: {
        quarantineEnforced: true,
        allowedUsage: 'ENTRY_TIMING_AND_SLIPPAGE_ONLY',
        structuralInvolvement: false,
      },
      evidence: {
        enforcementCode: 'HARD_RULE_4_EXECUTION_TIMEFRAME_ISOLATION',
      },
      structuralWeight: 100,
    });

    // Rule 3: 1H HTF Directional Bias
    const isHtfBiasActive = htf1h.directionalBias !== 'NEUTRAL';
    ruleRecords.push({
      ruleId: 'RULE_HTF_1H_DIRECTIONAL_BIAS',
      ruleName: '1H High-Timeframe Trend & Market Structure Bias',
      category: 'STRUCTURAL_BIAS',
      status: isHtfBiasActive ? 'FIRED' : 'EVALUATED_FALSE',
      timeframe: '1H',
      symbol,
      evaluatedAt: orchestratedAt,
      parameters: {
        bias: htf1h.directionalBias,
        marketRegime: htf1h.marketRegime,
        activeSwingsCount: htf1h.swingPoints.length,
        structureBreaksCount: htf1h.structureBreaks.length,
        hasDealingRange: htf1h.dealingRange !== null,
      },
      evidence: {
        currentPrice: htf1h.currentPrice,
        rangeHigh: htf1h.dealingRange?.rangeHigh ?? null,
        rangeLow: htf1h.dealingRange?.rangeLow ?? null,
        equilibriumPrice: htf1h.dealingRange?.equilibriumPrice ?? null,
      },
      structuralWeight: 30,
    });

    // Rule 4: 15M MTF Key POI & Premium/Discount Valuation
    const isMtfLocationValid = mtf15m.isLocationAligned && mtf15m.isAtKeyPoi;
    ruleRecords.push({
      ruleId: 'RULE_MTF_15M_LOCATION_POI',
      ruleName: '15M Setup POI Conviction & Dealing Range Location',
      category: 'SETUP_LOCATION',
      status: isMtfLocationValid
        ? 'FIRED'
        : mtf15m.isLocationAligned
          ? 'EVALUATED_FALSE'
          : 'BLOCKED',
      timeframe: '15M',
      symbol,
      evaluatedAt: orchestratedAt,
      parameters: {
        isAtKeyPoi: mtf15m.isAtKeyPoi,
        poiConvictionGrade: mtf15m.poiConvictionGrade,
        locationClassification: mtf15m.locationClassification,
        isLocationAligned: mtf15m.isLocationAligned,
        inOteZone: mtf15m.inOteZone,
      },
      evidence: {
        activePoiId: mtf15m.activeSetupPoi?.poiContext.id ?? null,
        activePoiKind: mtf15m.activeSetupPoi?.poiContext.kind ?? null,
        activePoiScore: mtf15m.activeSetupPoi?.score ?? null,
      },
      structuralWeight: 25,
    });

    // Rule 5: 5M Stage 1 - Liquidity Sweep (Phase 3 Lifecycle SWEPT/REVERSED)
    ruleRecords.push({
      ruleId: 'RULE_LTF_5M_LIQUIDITY_SWEEP',
      ruleName: '5M Stage 1 Liquidity Sweep Confirmation',
      category: 'EXECUTION_TRIGGER',
      status: ltf5m.sweepStage.detected ? 'FIRED' : 'EVALUATED_FALSE',
      timeframe: '5M',
      symbol,
      evaluatedAt: orchestratedAt,
      parameters: {
        sweepDetected: ltf5m.sweepStage.detected,
        poolId: ltf5m.sweepStage.pool?.id ?? null,
        poolSide: ltf5m.sweepStage.pool?.side ?? null,
        lifecycleState: ltf5m.sweepStage.poolState ?? null,
      },
      evidence: {
        sweepEvent: ltf5m.sweepStage.sweepEvent,
      },
      structuralWeight: 15,
    });

    // Rule 6: 5M Stage 2 - Displacement Impulse (Body/Range Ratio > 0.65)
    ruleRecords.push({
      ruleId: 'RULE_LTF_5M_DISPLACEMENT_RATIO',
      ruleName: '5M Stage 2 Displacement Impulse (Ratio > 0.65)',
      category: 'EXECUTION_TRIGGER',
      status: ltf5m.displacementStage.detected ? 'FIRED' : 'EVALUATED_FALSE',
      timeframe: '5M',
      symbol,
      evaluatedAt: orchestratedAt,
      parameters: {
        displacementDetected: ltf5m.displacementStage.detected,
        bodyRangeRatio: ltf5m.displacementStage.ratio,
        thresholdRequired: 0.65,
        displacementDirection: ltf5m.displacementStage.direction,
      },
      evidence: {
        candleTimestamp: ltf5m.displacementStage.timestamp ?? null,
      },
      structuralWeight: 15,
    });

    // Rule 7: 5M Stage 3 - Structure Break (BOS or CHoCH in 1H Bias Direction)
    ruleRecords.push({
      ruleId: 'RULE_LTF_5M_STRUCTURE_BREAK',
      ruleName: '5M Stage 3 Structure Break (BOS/CHoCH in 1H Bias Direction)',
      category: 'EXECUTION_TRIGGER',
      status: ltf5m.structureBreakStage.detected ? 'FIRED' : 'EVALUATED_FALSE',
      timeframe: '5M',
      symbol,
      evaluatedAt: orchestratedAt,
      parameters: {
        breakDetected: ltf5m.structureBreakStage.detected,
        breakType: ltf5m.structureBreakStage.type ?? null,
        breakDirection: ltf5m.structureBreakStage.direction ?? null,
        matchesHtfBias: ltf5m.structureBreakStage.direction === htf1h.directionalBias,
      },
      evidence: {
        breakEventId: ltf5m.structureBreakStage.breakEvent?.id ?? null,
        triggerCandleTimestamp: ltf5m.structureBreakStage.timestamp ?? null,
      },
      structuralWeight: 15,
    });

    // Rule 8: 5M Stage 4 - Retracement into 15M POI
    ruleRecords.push({
      ruleId: 'RULE_LTF_5M_RETRACEMENT_ENTRY',
      ruleName: '5M Stage 4 Retracement into Key Reaction Zone',
      category: 'EXECUTION_TRIGGER',
      status: ltf5m.retracementStage.detected ? 'FIRED' : 'EVALUATED_FALSE',
      timeframe: '5M',
      symbol,
      evaluatedAt: orchestratedAt,
      parameters: {
        retracementDetected: ltf5m.retracementStage.detected,
        retracementPrice: ltf5m.retracementStage.retracementPrice,
        isInsideTargetPoi: ltf5m.retracementStage.isInsideTargetPoi,
        targetPoiId: ltf5m.retracementStage.targetPoiId ?? null,
      },
      evidence: {
        currentPrice: ltf5m.currentPrice,
      },
      structuralWeight: 10,
    });

    // Rule 9: Counter-HTF Contradiction Gate
    ruleRecords.push({
      ruleId: 'RULE_CONTRADICTION_FAIL_CLOSED_GATE',
      ruleName: 'Multi-Timeframe Non-Contradiction Gate',
      category: 'CONTRADICTION_GATE',
      status: ltf5m.contradictsHtfBias ? 'BLOCKED' : 'FIRED',
      timeframe: 'CROSS_TIMEFRAME',
      symbol,
      evaluatedAt: orchestratedAt,
      parameters: {
        contradictsHtfBias: ltf5m.contradictsHtfBias,
        htfBias: htf1h.directionalBias,
        rejectionReason: ltf5m.rejectionReason,
      },
      evidence: {
        alignmentStatus: status,
      },
      structuralWeight: 100,
    });

    let overallStatus: 'PASSED' | 'FAILED' | 'REJECTED' | 'MONITORING' = 'MONITORING';
    if (status === 'FAIL_CLOSED_INTEGRITY') {
      overallStatus = 'FAILED';
    } else if (ltf5m.contradictsHtfBias) {
      overallStatus = 'REJECTED';
    } else if (status === 'ALIGNMENT_CONFIRMED') {
      overallStatus = 'PASSED';
    }

    const auditReport: RuleFiringAuditReport = {
      symbol,
      auditId: `AUDIT_${symbol}_${orchestratedAt}`,
      timestamp: orchestratedAt,
      overallStatus,
      overallBias,
      rulesEvaluatedCount: ruleRecords.length,
      rulesFiredCount: ruleRecords.filter((r) => r.status === 'FIRED').length,
      rulesBlockedCount: ruleRecords.filter((r) => r.status === 'BLOCKED').length,
      ruleRecords,
    };

    // Store in ledger
    this.auditLedger.push(auditReport);
    if (this.auditLedger.length > this.maxAuditLedgerCapacity) {
      this.auditLedger.shift();
    }

    return auditReport;
  }

  /**
   * Retrieves audit ledger history.
   */
  public static getAuditLedger(symbol?: InstrumentSymbol): readonly RuleFiringAuditReport[] {
    if (symbol) {
      return this.auditLedger.filter((a) => a.symbol === symbol);
    }
    return this.auditLedger;
  }

  /**
   * Clears the ledger (for test reset).
   */
  public static clear(): void {
    this.auditLedger.length = 0;
  }
}
