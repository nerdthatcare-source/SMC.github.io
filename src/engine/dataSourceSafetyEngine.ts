/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Data Source Safety Engine (Fail-Closed Gatekeeper)
 *
 * If Deriv feed health degrades, socket drops, token is invalid, candle integrity
 * breaches occur, or data staleness (>2x interval) is detected, this engine blocks
 * downstream structural analysis and trade execution.
 *
 * Exposes a queryable "Why Not Trade" registry detailing the exact technical
 * reasons preventing execution. Zero synthetic/fixture fallback data permitted.
 */

import { FeedStatus, InstrumentSymbol, Timeframe } from '../types/smc';
import {
  CandleIntegrityEngine,
  MultiTimeframeIntegrityReport,
} from './candleIntegrityEngine';

export type SafetyBlockReasonCode =
  | 'NO_ACTIVE_DATA_SOURCE'
  | 'FEED_DISCONNECTED'
  | 'FEED_ERROR'
  | 'FEED_RATE_LIMITED'
  | 'DEGRADED_LATENCY'
  | 'CANDLE_INTEGRITY_BREACH'
  | 'CROSS_TIMEFRAME_DESYNC'
  | 'UNEXPECTED_DATA_GAP'
  | 'BACKFILL_IN_PROGRESS'
  | 'UNAPPROVED_INSTRUMENT'
  | 'STALE_DATA';

export interface ActiveSafetyBlock {
  readonly id: string;
  readonly symbol: InstrumentSymbol | 'GLOBAL';
  readonly timeframe?: Timeframe | 'ALL';
  readonly code: SafetyBlockReasonCode;
  readonly severity: 'BLOCKING' | 'WARNING';
  readonly title: string;
  readonly explanation: string;
  readonly blockedSince: number;
  readonly resolutionAction: string;
}

export interface SafetyDecision {
  readonly allowed: boolean;
  readonly blocks: readonly ActiveSafetyBlock[];
  readonly evaluatedAt: number;
}

export type SafetyBlockListener = (
  activeBlocks: readonly ActiveSafetyBlock[],
) => void;

export class DataSourceSafetyEngine {
  private readonly activeBlocks: Map<string, ActiveSafetyBlock> = new Map();
  private readonly listeners: Set<SafetyBlockListener> = new Set();

  // ==========================================================================
  // FEED STATUS EVALUATION
  // ==========================================================================

  public evaluateFeedStatus(status: FeedStatus): void {
    const globalKey = 'FEED_STATUS_GLOBAL';

    if (status === 'DISCONNECTED') {
      this.setBlock(globalKey, {
        id: globalKey,
        symbol: 'GLOBAL',
        timeframe: 'ALL',
        code: 'NO_ACTIVE_DATA_SOURCE',
        severity: 'BLOCKING',
        title: 'Deriv Market Feed Disconnected (NO_ACTIVE_DATA_SOURCE)',
        explanation:
          'Live pricing stream from Deriv WebSocket is currently offline. No orders or signals permitted without verified feed.',
        blockedSince: Date.now(),
        resolutionAction:
          'Check network connectivity and verify Deriv WebSocket connection.',
      });
    } else if (status === 'ERROR') {
      this.setBlock(globalKey, {
        id: globalKey,
        symbol: 'GLOBAL',
        timeframe: 'ALL',
        code: 'NO_ACTIVE_DATA_SOURCE',
        severity: 'BLOCKING',
        title: 'Deriv Data Stream / Auth Failure (NO_ACTIVE_DATA_SOURCE)',
        explanation:
          'The canonical data stream encountered an unhandled network error or invalid token authentication failure.',
        blockedSince: Date.now(),
        resolutionAction:
          'Verify DERIV_API_TOKEN environment variable and check Deriv WebSocket connection status.',
      });
    } else if (status === 'RATE_LIMITED') {
      this.setBlock(globalKey, {
        id: globalKey,
        symbol: 'GLOBAL',
        timeframe: 'ALL',
        code: 'FEED_RATE_LIMITED',
        severity: 'BLOCKING',
        title: 'Deriv API Rate Limit Exceeded',
        explanation:
          'Rate limit message received from Deriv. Analysis halted to avoid IP throttling.',
        blockedSince: Date.now(),
        resolutionAction:
          'Wait for rate limit cooldown window before resuming requests.',
      });
    } else {
      // Healthy or degraded latency (warning only)
      this.clearBlock(globalKey);
    }
  }

  // ==========================================================================
  // INTEGRITY REPORT EVALUATION
  // ==========================================================================

  public evaluateIntegrityReport(report: MultiTimeframeIntegrityReport): void {
    const symbolKeyPrefix = `INTEGRITY_${report.symbol}`;

    // Clear existing integrity blocks for this symbol first
    for (const key of Array.from(this.activeBlocks.keys())) {
      if (key.startsWith(symbolKeyPrefix)) {
        this.clearBlock(key);
      }
    }

    if (!report.isValid) {
      for (const issue of report.issues) {
        const blockId = `${symbolKeyPrefix}_${issue.timeframe}_${issue.code}`;

        let code: SafetyBlockReasonCode = 'CANDLE_INTEGRITY_BREACH';
        let title = 'Candle Integrity Invariant Breach';
        let action = 'Verify source Deriv candles and trigger backfill.';

        if (issue.code === 'STALE_DATA') {
          code = 'STALE_DATA';
          title = `Stale Data Detected on ${issue.timeframe}`;
          action = 'Newest candle exceeds 2x interval. Check Deriv live stream or backfill latest bars.';
        } else if (
          issue.code === 'CROSS_TIMEFRAME_BOUNDS_MISMATCH' ||
          issue.code === 'CROSS_TIMEFRAME_COVERAGE_DESYNC'
        ) {
          code = 'CROSS_TIMEFRAME_DESYNC';
          title = 'Multi-Timeframe Desync (1H / 15M / 5M)';
          action = 'Run cross-timeframe backfill recovery to sync 5M children to 15M parent.';
        } else if (issue.code === 'UNEXPECTED_DATA_GAP') {
          code = 'UNEXPECTED_DATA_GAP';
          title = `Unexpected Data Gap in ${issue.timeframe} Feed`;
          action = 'Execute historical gap recovery via ticks_history.';
        }

        this.setBlock(blockId, {
          id: blockId,
          symbol: report.symbol,
          timeframe: issue.timeframe,
          code,
          severity: 'BLOCKING',
          title,
          explanation: issue.message,
          blockedSince: Date.now(),
          resolutionAction: action,
        });
      }
    }
  }

  // ==========================================================================
  // STALENESS DIRECT CHECK
  // ==========================================================================

  public evaluateCandleStaleness(
    symbol: InstrumentSymbol,
    timeframe: Timeframe,
    latestCandleTimestamp: number | null,
    intervalMs: number,
  ): void {
    const blockKey = `STALENESS_${symbol}_${timeframe}`;

    if (!latestCandleTimestamp) {
      this.setBlock(blockKey, {
        id: blockKey,
        symbol,
        timeframe,
        code: 'STALE_DATA',
        severity: 'BLOCKING',
        title: `No Candle Data for ${symbol} on ${timeframe}`,
        explanation: 'Zero candles exist in store for this timeframe.',
        blockedSince: Date.now(),
        resolutionAction: 'Trigger Deriv backfill recovery to bootstrap candle history.',
      });
      return;
    }

    const ageMs = Date.now() - latestCandleTimestamp;
    if (ageMs > 2 * intervalMs) {
      this.setBlock(blockKey, {
        id: blockKey,
        symbol,
        timeframe,
        code: 'STALE_DATA',
        severity: 'BLOCKING',
        title: `STALE_DATA: ${symbol} ${timeframe} Feed Halted`,
        explanation: `Newest candle is ${Math.round(ageMs / 1000)}s old, exceeding 2x timeframe interval (${Math.round(2 * intervalMs / 1000)}s).`,
        blockedSince: Date.now(),
        resolutionAction: 'Reconnect Deriv WebSocket or execute gap backfill.',
      });
    } else {
      this.clearBlock(blockKey);
    }
  }

  // ==========================================================================
  // RECOVERY LOCKS
  // ==========================================================================

  public setBackfillLock(symbol: InstrumentSymbol | 'GLOBAL', inProgress: boolean): void {
    const key = `BACKFILL_${symbol}`;
    if (inProgress) {
      this.setBlock(key, {
        id: key,
        symbol,
        timeframe: 'ALL',
        code: 'BACKFILL_IN_PROGRESS',
        severity: 'BLOCKING',
        title: 'Historical Backfill Recovery in Progress',
        explanation:
          'System is currently recovering historical candle sequences from Deriv ticks_history. Downstream analysis is held to avoid lookahead or incomplete state.',
        blockedSince: Date.now(),
        resolutionAction: 'Wait for backfill recovery batch to complete.',
      });
    } else {
      this.clearBlock(key);
    }
  }

  // ==========================================================================
  // DECISION API
  // ==========================================================================

  public canAnalyze(
    symbol: InstrumentSymbol,
    timeframe?: Timeframe,
  ): SafetyDecision {
    const matchingBlocks = this.getRelevantBlocks(symbol, timeframe);
    const blocking = matchingBlocks.filter((b) => b.severity === 'BLOCKING');

    return {
      allowed: blocking.length === 0,
      blocks: matchingBlocks,
      evaluatedAt: Date.now(),
    };
  }

  public canExecuteTrade(symbol: InstrumentSymbol): SafetyDecision {
    const matchingBlocks = this.getRelevantBlocks(symbol);
    const blocking = matchingBlocks.filter((b) => b.severity === 'BLOCKING');

    return {
      allowed: blocking.length === 0,
      blocks: matchingBlocks,
      evaluatedAt: Date.now(),
    };
  }

  public getWhyNotTradeSummary(
    symbol: InstrumentSymbol,
  ): readonly ActiveSafetyBlock[] {
    return this.getRelevantBlocks(symbol).filter((b) => b.severity === 'BLOCKING');
  }

  public getAllActiveBlocks(): readonly ActiveSafetyBlock[] {
    return Array.from(this.activeBlocks.values());
  }

  // ==========================================================================
  // INTERNAL STATE MANAGEMENT
  // ==========================================================================

  private getRelevantBlocks(
    symbol: InstrumentSymbol,
    timeframe?: Timeframe,
  ): readonly ActiveSafetyBlock[] {
    const result: ActiveSafetyBlock[] = [];

    for (const block of this.activeBlocks.values()) {
      const symbolMatch = block.symbol === 'GLOBAL' || block.symbol === symbol;
      const tfMatch =
        !timeframe ||
        block.timeframe === 'ALL' ||
        !block.timeframe ||
        block.timeframe === timeframe;

      if (symbolMatch && tfMatch) {
        result.push(block);
      }
    }

    return result;
  }

  private setBlock(key: string, block: ActiveSafetyBlock): void {
    this.activeBlocks.set(key, block);
    this.notifyListeners();
  }

  private clearBlock(key: string): void {
    if (this.activeBlocks.has(key)) {
      this.activeBlocks.delete(key);
      this.notifyListeners();
    }
  }

  public subscribeSafetyBlocks(listener: SafetyBlockListener): () => void {
    this.listeners.add(listener);
    listener(this.getAllActiveBlocks());
    return () => this.listeners.delete(listener);
  }

  public onBlocksChanged(listener: SafetyBlockListener): () => void {
    return this.subscribeSafetyBlocks(listener);
  }

  private notifyListeners(): void {
    const blocks = this.getAllActiveBlocks();
    for (const listener of this.listeners) {
      try {
        listener(blocks);
      } catch (err) {
        console.error('Error in safety listener:', err);
      }
    }
  }
}
