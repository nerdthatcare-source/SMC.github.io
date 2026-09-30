/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Canonical Data Engine (Unified Facade)
 *
 * The single, authoritative entry point coordinating all canonical market data operations.
 * Enforces the architectural invariant: No other engine may talk to Deriv adapters directly.
 * All OANDA code paths have been completely removed.
 *
 * Coordinates:
 * - DerivAdapter
 * - DerivConnectionHealthEngine
 * - DerivBackfillRecoveryEngine
 * - CanonicalMarketDataEngine
 * - CandleIntegrityEngine
 * - DataIntegrityLineageEngine
 * - DataSourceSafetyEngine
 */

import { FeedStatus, InstrumentSymbol, Timeframe } from '../types/smc';
import {
  CandleRangeQuery,
  CanonicalMarketDataEngine,
} from './canonicalMarketDataEngine';
import {
  CanonicalCandle,
  CanonicalTick,
} from './canonicalDataContracts';
import {
  CandleIntegrityEngine,
  MultiTimeframeIntegrityReport,
} from './candleIntegrityEngine';
import {
  DataIntegrityLineageEngine,
  LineageAuditSummary,
} from './dataIntegrityLineageEngine';
import {
  ActiveSafetyBlock,
  DataSourceSafetyEngine,
  SafetyDecision,
} from './dataSourceSafetyEngine';
import {
  DerivConnectionHealthEngine,
  DerivHealthMetrics,
} from './derivConnectionHealthEngine';
import {
  DerivBackfillJobResult,
  DerivBackfillRecoveryEngine,
} from './derivBackfillRecoveryEngine';
import {
  DerivAdapter,
  DerivAdapterConfig,
} from './derivAdapter';
import { SymbolMappingEngine } from './symbolMappingEngine';

export class CanonicalDataEngine {
  public readonly derivAdapter: DerivAdapter;
  public readonly healthEngine: DerivConnectionHealthEngine;
  public readonly lineageEngine: DataIntegrityLineageEngine;
  public readonly marketDataEngine: CanonicalMarketDataEngine;
  public readonly safetyEngine: DataSourceSafetyEngine;
  public readonly backfillEngine: DerivBackfillRecoveryEngine;

  private activeTickSubscriptions: Map<InstrumentSymbol, string> = new Map();

  constructor(config?: DerivAdapterConfig) {
    this.derivAdapter = new DerivAdapter(config);
    this.healthEngine = new DerivConnectionHealthEngine(this.derivAdapter);
    this.lineageEngine = new DataIntegrityLineageEngine();
    this.marketDataEngine = new CanonicalMarketDataEngine(
      this.derivAdapter,
      this.lineageEngine,
    );
    this.safetyEngine = new DataSourceSafetyEngine();
    this.backfillEngine = new DerivBackfillRecoveryEngine(
      this.derivAdapter,
      this.marketDataEngine,
      this.safetyEngine,
    );

    this.wireInternalPipelines();
  }

  /**
   * Wires real-time stream ticks directly to the canonical market data store,
   * updates health statuses, and triggers safety evaluation on state change.
   */
  private wireInternalPipelines(): void {
    // Pipe FeedStatus into SafetyEngine
    this.healthEngine.subscribe((status) => {
      this.safetyEngine.evaluateFeedStatus(status);
    });
  }

  // ==========================================================================
  // UNIFIED READ API
  // ==========================================================================

  /**
   * Primary single clean read API for all downstream SMC trading engines.
   * Signature is invariant and calls marketDataEngine directly.
   */
  public getCandles(
    symbol: InstrumentSymbol,
    timeframe: Timeframe,
    range?: CandleRangeQuery,
  ): readonly CanonicalCandle[] {
    return this.marketDataEngine.getCandles(symbol, timeframe, range);
  }

  public getLatestCandle(
    symbol: InstrumentSymbol,
    timeframe: Timeframe,
  ): CanonicalCandle | undefined {
    return this.marketDataEngine.getLatestCandle(symbol, timeframe);
  }

  public getLatestTick(symbol: InstrumentSymbol): CanonicalTick | undefined {
    return this.marketDataEngine.getLatestTick(symbol);
  }

  public subscribeCandles(
    listener: (candle: CanonicalCandle) => void,
  ): () => void {
    return this.marketDataEngine.subscribeCandleUpdates(listener);
  }

  public subscribeTicks(
    listener: (tick: CanonicalTick) => void,
  ): () => void {
    return this.marketDataEngine.subscribeTickUpdates(listener);
  }

  // ==========================================================================
  // STREAM & CONNECTION CONTROLS
  // ==========================================================================

  public async startStreaming(
    instruments: readonly InstrumentSymbol[],
  ): Promise<void> {
    await this.derivAdapter.connect();

    for (const symbol of instruments) {
      if (this.activeTickSubscriptions.has(symbol)) continue;

      const derivSymbol = SymbolMappingEngine.toDerivSymbol(symbol);
      try {
        const subId = await this.derivAdapter.subscribeTicks(derivSymbol, (rawTick) => {
          try {
            this.marketDataEngine.ingestStreamingTick(rawTick);
          } catch (err) {
            console.error(`[CanonicalDataEngine] Ingestion error for ${symbol}:`, err);
          }
        });
        this.activeTickSubscriptions.set(symbol, subId);
      } catch (subErr) {
        console.warn(`[CanonicalDataEngine] Failed to subscribe ticks for ${symbol}:`, subErr);
      }
    }
  }

  public async stopStreaming(): Promise<void> {
    for (const subId of this.activeTickSubscriptions.values()) {
      try {
        await this.derivAdapter.forget(subId);
      } catch {
        // Ignore
      }
    }
    this.activeTickSubscriptions.clear();
    this.derivAdapter.disconnect();
  }

  public getFeedStatus(): FeedStatus {
    return this.healthEngine.getStatus();
  }

  public getConnectionMetrics(): DerivHealthMetrics {
    return this.healthEngine.getMetrics();
  }

  // ==========================================================================
  // INTEGRITY & SAFETY GATES
  // ==========================================================================

  public auditSymbolIntegrity(
    symbol: InstrumentSymbol,
  ): MultiTimeframeIntegrityReport {
    const c1H = this.marketDataEngine.getCandles(symbol, '1H');
    const c15M = this.marketDataEngine.getCandles(symbol, '15M');
    const c5M = this.marketDataEngine.getCandles(symbol, '5M');
    const c1M = this.marketDataEngine.getCandles(symbol, '1M');

    const report = CandleIntegrityEngine.auditMultiTimeframeSync(
      symbol,
      c1H,
      c15M,
      c5M,
      c1M,
    );

    // Update safety engine with new findings
    this.safetyEngine.evaluateIntegrityReport(report);
    return report;
  }

  public canAnalyze(
    symbol: InstrumentSymbol,
    timeframe?: Timeframe,
  ): SafetyDecision {
    return this.safetyEngine.canAnalyze(symbol, timeframe);
  }

  public canExecuteTrade(symbol: InstrumentSymbol): SafetyDecision {
    return this.safetyEngine.canExecuteTrade(symbol);
  }

  public getWhyNotTradeSummary(
    symbol: InstrumentSymbol,
  ): readonly ActiveSafetyBlock[] {
    return this.safetyEngine.getWhyNotTradeSummary(symbol);
  }

  public getLineageSummary(): LineageAuditSummary {
    return this.lineageEngine.getAuditSummary();
  }

  public async backfillSymbol(
    symbol: InstrumentSymbol,
  ): Promise<readonly DerivBackfillJobResult[]> {
    const timeframes: Timeframe[] = ['1H', '15M', '5M', '1M'];
    const results: DerivBackfillJobResult[] = [];
    for (const tf of timeframes) {
      const res = await this.backfillEngine.synchronizeSymbolTimeframe(symbol, tf);
      results.push(res);
    }
    return results;
  }
}
