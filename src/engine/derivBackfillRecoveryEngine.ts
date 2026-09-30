/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Deriv Backfill Recovery Engine
 *
 * On startup and every reconnect, detects candle gaps and backfills via
 * Deriv's ticks_history across all four canonical timeframes (1H, 15M, 5M, 1M).
 * Ensures no duplicate or missing candles at the reconnect seam.
 *
 * Deriv has no missed-event replay, so query-based backfill via ticks_history
 * is the only architectural recovery path.
 */

import { InstrumentSymbol, Timeframe } from '../types/smc';
import { CanonicalMarketDataEngine } from './canonicalMarketDataEngine';
import { DataSourceSafetyEngine } from './dataSourceSafetyEngine';
import {
  DerivAdapter,
  DerivGranularitySeconds,
  TIMEFRAME_TO_DERIV_GRANULARITY,
} from './derivAdapter';
import { MarketDataNormalization } from './marketDataNormalization';
import { SymbolMappingEngine } from './symbolMappingEngine';

export interface DerivBackfillJobResult {
  readonly symbol: InstrumentSymbol;
  readonly timeframe: Timeframe;
  readonly gapDetected: boolean;
  readonly missingCandlesEstimated: number;
  readonly candlesRecovered: number;
  readonly durationMs: number;
  readonly error?: string;
}

export type DerivBackfillEventListener = (result: DerivBackfillJobResult) => void;

export class DerivBackfillRecoveryEngine {
  private readonly backfillListeners: Set<DerivBackfillEventListener> = new Set();
  private isBackfillInProgress = false;
  private readonly canonicalTimeframes: readonly Timeframe[] = ['1H', '15M', '5M', '1M'];

  constructor(
    private readonly derivAdapter: DerivAdapter,
    private readonly marketDataEngine: CanonicalMarketDataEngine,
    private readonly safetyEngine: DataSourceSafetyEngine,
  ) {
    this.bindReconnectListener();
  }

  // ==========================================================================
  // RECONNECT HOOK
  // ==========================================================================

  private bindReconnectListener(): void {
    this.derivAdapter.onStateChange(async (newState, prevState) => {
      // Trigger automatic recovery on every reconnect or initial connection
      if (newState === 'CONNECTED' && (prevState === 'RECONNECTING' || prevState === 'CONNECTING')) {
        console.info('[DerivBackfillRecoveryEngine] Connection established; executing gap recovery...');
        try {
          await this.synchronizeActiveSymbols();
        } catch (err) {
          console.warn('[DerivBackfillRecoveryEngine] Reconnect synchronization error:', err);
        }
      }
    });
  }

  // ==========================================================================
  // SYNCHRONIZATION & GAP RECOVERY
  // ==========================================================================

  /**
   * Synchronizes all active or currently queried symbols in the market data store.
   */
  public async synchronizeActiveSymbols(symbols?: readonly InstrumentSymbol[]): Promise<void> {
    if (this.isBackfillInProgress) return;
    this.isBackfillInProgress = true;

    const targetSymbols = symbols && symbols.length > 0
      ? symbols
      : this.marketDataEngine.getActiveSymbols();

    // Default to at least EUR_USD if store is currently cold
    const effectiveSymbols: readonly InstrumentSymbol[] =
      targetSymbols.length > 0 ? targetSymbols : (['EUR_USD'] as const);

    try {
      for (const symbol of effectiveSymbols) {
        this.safetyEngine.setBackfillLock(symbol, true);
        try {
          for (const tf of this.canonicalTimeframes) {
            await this.synchronizeSymbolTimeframe(symbol, tf);
          }
        } finally {
          this.safetyEngine.setBackfillLock(symbol, false);
        }
      }
    } finally {
      this.isBackfillInProgress = false;
    }
  }

  /**
   * Evaluates missing candle ranges for a given symbol and timeframe.
   * If a gap is detected, queries Deriv ticks_history and backfills without duplicates.
   */
  public async synchronizeSymbolTimeframe(
    symbol: InstrumentSymbol,
    timeframe: Timeframe,
  ): Promise<DerivBackfillJobResult> {
    const startTime = Date.now();
    const durationMs = MarketDataNormalization.getTimeframeDurationMs(timeframe);
    const existingCandles = this.marketDataEngine.getCandles(symbol, timeframe);
    const derivSymbol = SymbolMappingEngine.toDerivSymbol(symbol);
    const granularity = TIMEFRAME_TO_DERIV_GRANULARITY[timeframe];

    // Case 1: Cold start / no existing candles -> fetch bootstrap history (e.g. 500 candles)
    if (existingCandles.length === 0) {
      try {
        const rawCandles = await this.derivAdapter.fetchCandles({
          symbol: derivSymbol,
          granularity,
          count: 500,
          end: 'latest',
        });

        this.marketDataEngine.ingestRawDerivCandles(symbol, timeframe, rawCandles, 'BACKFILL_RECOVERY');

        const result: DerivBackfillJobResult = {
          symbol,
          timeframe,
          gapDetected: true,
          missingCandlesEstimated: 500,
          candlesRecovered: rawCandles.length,
          durationMs: Date.now() - startTime,
        };

        this.emitJobResult(result);
        return result;
      } catch (err) {
        const errorMsg = (err as Error).message;
        const failureResult: DerivBackfillJobResult = {
          symbol,
          timeframe,
          gapDetected: true,
          missingCandlesEstimated: 500,
          candlesRecovered: 0,
          durationMs: Date.now() - startTime,
          error: errorMsg,
        };
        this.emitJobResult(failureResult);
        return failureResult;
      }
    }

    // Case 2: Warm start with existing candles -> detect gap from latest candle timestamp
    const latestCandle = existingCandles[existingCandles.length - 1];
    const now = Date.now();
    const timeDeltaMs = now - latestCandle.timestamp;

    // A gap exists if more than 1.5 candle intervals have elapsed without updates
    const hasGap = timeDeltaMs > durationMs * 1.5;
    const missingCandlesEstimated = hasGap ? Math.floor(timeDeltaMs / durationMs) : 0;

    if (!hasGap) {
      const cleanResult: DerivBackfillJobResult = {
        symbol,
        timeframe,
        gapDetected: false,
        missingCandlesEstimated: 0,
        candlesRecovered: 0,
        durationMs: Date.now() - startTime,
      };
      this.emitJobResult(cleanResult);
      return cleanResult;
    }

    // Fetch missing candles from latestCandle epoch seconds up to 'latest'
    const startEpochSec = Math.floor(latestCandle.timestamp / 1000);
    const countToFetch = Math.min(1000, Math.max(10, missingCandlesEstimated + 5));

    try {
      const recoveredCandles = await this.derivAdapter.fetchCandles({
        symbol: derivSymbol,
        granularity,
        start: startEpochSec,
        count: countToFetch,
        end: 'latest',
      });

      // Deduplicate at reconnect seam: ingestRawDerivCandles ensures map deduplication by timestamp
      this.marketDataEngine.ingestRawDerivCandles(
        symbol,
        timeframe,
        recoveredCandles,
        'BACKFILL_RECOVERY',
      );

      const result: DerivBackfillJobResult = {
        symbol,
        timeframe,
        gapDetected: true,
        missingCandlesEstimated,
        candlesRecovered: recoveredCandles.length,
        durationMs: Date.now() - startTime,
      };

      this.emitJobResult(result);
      return result;
    } catch (err) {
      const errorMsg = (err as Error).message;
      const failureResult: DerivBackfillJobResult = {
        symbol,
        timeframe,
        gapDetected: true,
        missingCandlesEstimated,
        candlesRecovered: 0,
        durationMs: Date.now() - startTime,
        error: errorMsg,
      };
      this.emitJobResult(failureResult);
      return failureResult;
    }
  }

  // ==========================================================================
  // LISTENERS
  // ==========================================================================

  public onBackfillEvent(listener: DerivBackfillEventListener): () => void {
    this.backfillListeners.add(listener);
    return () => this.backfillListeners.delete(listener);
  }

  private emitJobResult(result: DerivBackfillJobResult): void {
    for (const listener of this.backfillListeners) {
      try {
        listener(result);
      } catch (err) {
        console.warn('[DerivBackfillRecoveryEngine] Listener error:', err);
      }
    }
  }
}
