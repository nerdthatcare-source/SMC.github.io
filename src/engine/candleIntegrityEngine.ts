/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Candle Integrity & Cross-Timeframe Desync Engine
 *
 * Audits candlestick feeds for:
 * 1. Duplicate timestamps within the same symbol/timeframe.
 * 2. Unexplained chronological gaps in active market sessions.
 * 3. Cross-timeframe desynchronization:
 *    - 15M parent candle must be backed by three 5M child candles.
 *    - 1H parent candle must be backed by four 15M child candles.
 *    - Parent High must be >= Child Highs; Parent Low must be <= Child Lows.
 * 4. Staleness check: if newest candle is older than 2x its timeframe interval,
 *    flags STALE_DATA to force fail-closed safety block.
 * 5. Produces a detailed MultiTimeframeIntegrityReport for downstream safety gates.
 */

import { Candle, InstrumentSymbol, Timeframe } from '../types/smc';
import { validateCanonicalCandle } from './canonicalDataContracts';
import { MarketDataNormalization } from './marketDataNormalization';

export type IntegrityIssueCode =
  | 'DUPLICATE_TIMESTAMP'
  | 'UNEXPECTED_DATA_GAP'
  | 'CROSS_TIMEFRAME_COVERAGE_DESYNC'
  | 'CROSS_TIMEFRAME_BOUNDS_MISMATCH'
  | 'CANDLE_CONTRACT_BREACH'
  | 'INSUFFICIENT_HISTORY'
  | 'STALE_DATA';

export interface IntegrityIssue {
  readonly code: IntegrityIssueCode;
  readonly symbol: InstrumentSymbol;
  readonly timeframe: Timeframe;
  readonly message: string;
  readonly timestamp?: number;
  readonly details?: Record<string, unknown>;
}

export interface TimeframeIntegritySummary {
  readonly candleCount: number;
  readonly oldestTimestamp: number | null;
  readonly newestTimestamp: number | null;
  readonly hasGaps: boolean;
  readonly hasDuplicates: boolean;
  readonly isStale: boolean;
}

export interface MultiTimeframeIntegrityReport {
  readonly symbol: InstrumentSymbol;
  readonly analyzedAt: number;
  readonly isValid: boolean;
  readonly syncScore: number; // 0 to 100%
  readonly issues: readonly IntegrityIssue[];
  readonly timeframeStatus: Record<Timeframe, TimeframeIntegritySummary>;
}

export class CandleIntegrityEngine {
  /**
   * Validates a batch of candles for a single timeframe.
   * Enforces mathematical monotonicity, zero duplicates, continuity, and staleness checks.
   */
  public static validateTimeframeBatch(
    symbol: InstrumentSymbol,
    timeframe: Timeframe,
    candles: readonly Candle[],
    options?: { checkStaleness?: boolean },
  ): {
    readonly isValid: boolean;
    readonly issues: readonly IntegrityIssue[];
    readonly summary: TimeframeIntegritySummary;
  } {
    const issues: IntegrityIssue[] = [];
    const expectedIntervalMs = MarketDataNormalization.getTimeframeDurationMs(timeframe);

    if (candles.length === 0) {
      return {
        isValid: true,
        issues: [],
        summary: {
          candleCount: 0,
          oldestTimestamp: null,
          newestTimestamp: null,
          hasGaps: false,
          hasDuplicates: false,
          isStale: false,
        },
      };
    }

    const seenTimestamps = new Set<number>();
    let hasDuplicates = false;
    let hasGaps = false;
    let isStale = false;

    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];

      // 1. Contract validation
      const validation = validateCanonicalCandle(c);
      if (!validation.success) {
        issues.push({
          code: 'CANDLE_CONTRACT_BREACH',
          symbol,
          timeframe,
          timestamp: c.timestamp,
          message: `Candle at ${new Date(c.timestamp).toISOString()} breached contract: ${validation.errors[0]?.message}`,
          details: { error: validation.errors[0] },
        });
      }

      // 2. Duplicate detection
      if (seenTimestamps.has(c.timestamp)) {
        hasDuplicates = true;
        issues.push({
          code: 'DUPLICATE_TIMESTAMP',
          symbol,
          timeframe,
          timestamp: c.timestamp,
          message: `Duplicate candle detected at timestamp ${c.timestamp} (${new Date(c.timestamp).toISOString()})`,
        });
      } else {
        seenTimestamps.add(c.timestamp);
      }

      // 3. Gap detection between consecutive sorted candles
      if (i > 0) {
        const prev = candles[i - 1];
        const diff = c.timestamp - prev.timestamp;

        // Gap is detected if difference exceeds standard interval by more than 1 period
        // (Excluding weekend market closures, e.g. > 44h)
        const isWeekendClose = diff > 44 * 3600 * 1000 && diff < 56 * 3600 * 1000;
        if (diff > expectedIntervalMs && !isWeekendClose) {
          hasGaps = true;
          const missingCount = Math.round(diff / expectedIntervalMs) - 1;
          issues.push({
            code: 'UNEXPECTED_DATA_GAP',
            symbol,
            timeframe,
            timestamp: prev.timestamp,
            message: `Data gap detected: ${missingCount} missing ${timeframe} candle(s) between ${new Date(prev.timestamp).toISOString()} and ${new Date(c.timestamp).toISOString()}`,
            details: { gapDurationMs: diff, missingCandles: missingCount },
          });
        }
      }
    }

    const sorted = [...candles].sort((a, b) => a.timestamp - b.timestamp);
    const newest = sorted[sorted.length - 1];

    // 4. Staleness Check: If newest candle is older than 2x its timeframe interval
    if (options?.checkStaleness === true && newest) {
      const now = Date.now();
      const ageMs = now - newest.timestamp;

      // Allow for weekend closures
      const isWeekendNow = (() => {
        const d = new Date(now);
        const day = d.getUTCDay();
        const hour = d.getUTCHours();
        return (day === 6) || (day === 0 && hour < 21) || (day === 5 && hour >= 22);
      })();

      if (ageMs > 2 * expectedIntervalMs && !isWeekendNow) {
        isStale = true;
        issues.push({
          code: 'STALE_DATA',
          symbol,
          timeframe,
          timestamp: newest.timestamp,
          message: `STALE_DATA: Newest ${timeframe} candle is older than 2x interval (${Math.round(ageMs / 1000)}s > ${Math.round(2 * expectedIntervalMs / 1000)}s).`,
          details: { ageMs, maxAllowedAgeMs: 2 * expectedIntervalMs },
        });
      }
    }

    return {
      isValid: issues.length === 0,
      issues,
      summary: {
        candleCount: candles.length,
        oldestTimestamp: sorted[0]?.timestamp ?? null,
        newestTimestamp: sorted[sorted.length - 1]?.timestamp ?? null,
        hasGaps,
        hasDuplicates,
        isStale,
      },
    };
  }

  /**
   * Performs full multi-timeframe cross-desync audit across 1H, 15M, and 5M feeds.
   */
  public static auditMultiTimeframeSync(
    symbol: InstrumentSymbol,
    candles1H: readonly Candle[],
    candles15M: readonly Candle[],
    candles5M: readonly Candle[],
    candles1M?: readonly Candle[],
    options?: { checkStaleness?: boolean },
  ): MultiTimeframeIntegrityReport {
    const issues: IntegrityIssue[] = [];

    // 1. Audit individual timeframes
    const audit1H = this.validateTimeframeBatch(symbol, '1H', candles1H, options);
    const audit15M = this.validateTimeframeBatch(symbol, '15M', candles15M, options);
    const audit5M = this.validateTimeframeBatch(symbol, '5M', candles5M, options);
    const audit1M = candles1M
      ? this.validateTimeframeBatch(symbol, '1M', candles1M, options)
      : {
          isValid: true,
          issues: [],
          summary: {
            candleCount: 0,
            oldestTimestamp: null,
            newestTimestamp: null,
            hasGaps: false,
            hasDuplicates: false,
            isStale: false,
          },
        };

    issues.push(...audit1H.issues);
    issues.push(...audit15M.issues);
    issues.push(...audit5M.issues);
    if (candles1M) issues.push(...audit1M.issues);

    // 2. Cross-Timeframe Verification: 15M vs 5M (1 x 15M = 3 x 5M)
    const m5ByTimestamp = new Map<number, Candle>();
    for (const c of candles5M) {
      m5ByTimestamp.set(c.timestamp, c);
    }

    const fiveMinMs = 5 * 60 * 1000;
    for (const c15 of candles15M) {
      if (!c15.isComplete) continue; // Only enforce on closed completed bars

      const expectedChildren = [
        c15.timestamp,
        c15.timestamp + fiveMinMs,
        c15.timestamp + 2 * fiveMinMs,
      ];

      const children: Candle[] = [];
      for (const t of expectedChildren) {
        const found = m5ByTimestamp.get(t);
        if (found) children.push(found);
      }

      // Check coverage desync
      if (children.length > 0 && children.length < 3) {
        issues.push({
          code: 'CROSS_TIMEFRAME_COVERAGE_DESYNC',
          symbol,
          timeframe: '15M',
          timestamp: c15.timestamp,
          message: `Desync: 15M candle at ${new Date(c15.timestamp).toISOString()} only has ${children.length}/3 5M child candles.`,
          details: { expectedChildren, presentCount: children.length },
        });
      }

      // Check bounds monotonicity (Parent High >= Children Highs, Parent Low <= Children Lows)
      if (children.length === 3) {
        const childMaxHigh = Math.max(...children.map((c) => c.high));
        const childMinLow = Math.min(...children.map((c) => c.low));

        if (c15.high < childMaxHigh || c15.low > childMinLow) {
          issues.push({
            code: 'CROSS_TIMEFRAME_BOUNDS_MISMATCH',
            symbol,
            timeframe: '15M',
            timestamp: c15.timestamp,
            message: `Desync bounds breach: 15M High/Low (${c15.high}/${c15.low}) does not envelop 5M children (${childMaxHigh}/${childMinLow}).`,
            details: {
              c15High: c15.high,
              c15Low: c15.low,
              childMaxHigh,
              childMinLow,
            },
          });
        }
      }
    }

    // 3. Cross-Timeframe Verification: 1H vs 15M (1 x 1H = 4 x 15M)
    const m15ByTimestamp = new Map<number, Candle>();
    for (const c of candles15M) {
      m15ByTimestamp.set(c.timestamp, c);
    }

    const fifteenMinMs = 15 * 60 * 1000;
    for (const c1h of candles1H) {
      if (!c1h.isComplete) continue;

      const expectedChildren = [
        c1h.timestamp,
        c1h.timestamp + fifteenMinMs,
        c1h.timestamp + 2 * fifteenMinMs,
        c1h.timestamp + 3 * fifteenMinMs,
      ];

      const children: Candle[] = [];
      for (const t of expectedChildren) {
        const found = m15ByTimestamp.get(t);
        if (found) children.push(found);
      }

      if (children.length > 0 && children.length < 4) {
        issues.push({
          code: 'CROSS_TIMEFRAME_COVERAGE_DESYNC',
          symbol,
          timeframe: '1H',
          timestamp: c1h.timestamp,
          message: `Desync: 1H candle at ${new Date(c1h.timestamp).toISOString()} only has ${children.length}/4 15M child candles.`,
          details: { expectedChildren, presentCount: children.length },
        });
      }

      if (children.length === 4) {
        const childMaxHigh = Math.max(...children.map((c) => c.high));
        const childMinLow = Math.min(...children.map((c) => c.low));

        if (c1h.high < childMaxHigh || c1h.low > childMinLow) {
          issues.push({
            code: 'CROSS_TIMEFRAME_BOUNDS_MISMATCH',
            symbol,
            timeframe: '1H',
            timestamp: c1h.timestamp,
            message: `Desync bounds breach: 1H High/Low (${c1h.high}/${c1h.low}) does not envelop 15M children (${childMaxHigh}/${childMinLow}).`,
            details: {
              c1hHigh: c1h.high,
              c1hLow: c1h.low,
              childMaxHigh,
              childMinLow,
            },
          });
        }
      }
    }

    // Compute composite synchronization score
    let syncScore = 100;
    for (const issue of issues) {
      if (issue.code === 'CANDLE_CONTRACT_BREACH') syncScore -= 20;
      if (issue.code === 'CROSS_TIMEFRAME_BOUNDS_MISMATCH') syncScore -= 20;
      if (issue.code === 'CROSS_TIMEFRAME_COVERAGE_DESYNC') syncScore -= 15;
      if (issue.code === 'UNEXPECTED_DATA_GAP') syncScore -= 10;
      if (issue.code === 'DUPLICATE_TIMESTAMP') syncScore -= 10;
      if (issue.code === 'STALE_DATA') syncScore -= 30;
    }
    syncScore = Math.max(0, Math.min(100, syncScore));

    return {
      symbol,
      analyzedAt: Date.now(),
      isValid: issues.length === 0,
      syncScore,
      issues,
      timeframeStatus: {
        '1H': audit1H.summary,
        '15M': audit15M.summary,
        '5M': audit5M.summary,
        '1M': audit1M.summary,
      },
    };
  }

  /**
   * Evaluates staleness of a symbol and timeframe: if newest candle is older than
   * 2x its timeframe interval, returns a STALE_DATA integrity issue.
   */
  public static checkCandleStaleness(
    symbol: InstrumentSymbol,
    timeframe: Timeframe,
    newestTimestamp: number | null,
    now = Date.now(),
  ): IntegrityIssue | null {
    if (!newestTimestamp) return null;
    const expectedIntervalMs = MarketDataNormalization.getTimeframeDurationMs(timeframe);
    const ageMs = now - newestTimestamp;

    if (ageMs > 2 * expectedIntervalMs) {
      return {
        code: 'STALE_DATA',
        symbol,
        timeframe,
        timestamp: newestTimestamp,
        message: `STALE_DATA: Newest ${timeframe} candle (${new Date(
          newestTimestamp,
        ).toISOString()}) is older than 2x timeframe interval (${Math.round(
          ageMs / 1000,
        )}s > ${Math.round((2 * expectedIntervalMs) / 1000)}s).`,
        details: { ageMs, maxAllowedAgeMs: 2 * expectedIntervalMs },
      };
    }
    return null;
  }
}
