/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Canonical Market Data Engine
 *
 * The single authoritative market data repository for the SMC Trading OS.
 * - Normalizes raw Deriv responses into canonical Candle contracts.
 * - Deduplicates candles by timestamp.
 * - Maintains sorted in-memory chronological series.
 * - Records provenance to DataIntegrityLineageEngine.
 * - Exposes single clean read API: getCandles(symbol, timeframe, range).
 *
 * ARCHITECTURAL RULE: No other engine may talk to derivAdapter directly.
 * Zero OANDA code paths permitted.
 */

import {
  BrokerId,
  CANONICAL_BROKER_ID,
  Candle,
  InstrumentSymbol,
  Timeframe,
} from '../types/smc';
import {
  CanonicalCandle,
  CanonicalTick,
  validateCanonicalCandle,
  validateCanonicalTick,
} from './canonicalDataContracts';
import {
  DataIntegrityLineageEngine,
  IngestionPath,
} from './dataIntegrityLineageEngine';
import {
  DerivAdapter,
  DerivRawCandle,
  DerivRawTick,
  TIMEFRAME_TO_DERIV_GRANULARITY,
} from './derivAdapter';
import { MarketDataNormalization } from './marketDataNormalization';
import { SymbolMappingEngine } from './symbolMappingEngine';

export interface CandleRangeQuery {
  readonly from?: number; // epoch ms (inclusive)
  readonly to?: number; // epoch ms (inclusive)
  readonly limit?: number; // max candles to return
}

export type CandleUpdateListener = (candle: CanonicalCandle) => void;
export type TickUpdateListener = (tick: CanonicalTick) => void;

export class CanonicalMarketDataEngine {
  // Candle series indexed by `${symbol}:${timeframe}` -> Map<timestamp, CanonicalCandle>
  private readonly candleStore: Map<string, Map<number, CanonicalCandle>> = new Map();

  // Latest verified tick per symbol
  private readonly latestTicks: Map<InstrumentSymbol, CanonicalTick> = new Map();

  // Listeners
  private readonly candleListeners: Set<CandleUpdateListener> = new Set();
  private readonly tickListeners: Set<TickUpdateListener> = new Set();

  // In-memory capacity per series
  private readonly maxSeriesCapacity = 1000;

  constructor(
    private readonly derivAdapter: DerivAdapter,
    private readonly lineageEngine: DataIntegrityLineageEngine,
  ) {}

  private getSeriesKey(symbol: InstrumentSymbol, timeframe: Timeframe): string {
    return `${symbol}:${timeframe}`;
  }

  // ==========================================================================
  // READ API (SINGLE ACCESS POINT FOR ALL DOWNSTREAM ENGINES)
  // ==========================================================================

  /**
   * Primary read API for all SMC structural engines.
   * Returns a deduplicated, chronologically ascending array of canonical candles.
   */
  public getCandles(
    symbol: InstrumentSymbol,
    timeframe: Timeframe,
    range?: CandleRangeQuery,
  ): readonly CanonicalCandle[] {
    const key = this.getSeriesKey(symbol, timeframe);
    const seriesMap = this.candleStore.get(key);

    if (!seriesMap || seriesMap.size === 0) {
      return [];
    }

    const allTimestamps = Array.from(seriesMap.keys()).sort((a, b) => a - b);
    let filtered = allTimestamps;

    if (range?.from !== undefined) {
      filtered = filtered.filter((t) => t >= range.from!);
    }
    if (range?.to !== undefined) {
      filtered = filtered.filter((t) => t <= range.to!);
    }

    if (range?.limit !== undefined && range.limit > 0) {
      // Take the most recent `limit` candles
      filtered = filtered.slice(-range.limit);
    }

    return filtered.map((t) => seriesMap.get(t)!);
  }

  /**
   * Fetches the single latest candle for a symbol and timeframe.
   */
  public getLatestCandle(
    symbol: InstrumentSymbol,
    timeframe: Timeframe,
  ): CanonicalCandle | undefined {
    const key = this.getSeriesKey(symbol, timeframe);
    const seriesMap = this.candleStore.get(key);
    if (!seriesMap || seriesMap.size === 0) return undefined;

    let latestTimestamp = -1;
    for (const t of seriesMap.keys()) {
      if (t > latestTimestamp) latestTimestamp = t;
    }

    return latestTimestamp >= 0 ? seriesMap.get(latestTimestamp) : undefined;
  }

  /**
   * Returns the most recent tick for an instrument.
   */
  public getLatestTick(symbol: InstrumentSymbol): CanonicalTick | undefined {
    return this.latestTicks.get(symbol);
  }

  /**
   * Returns list of all symbols that currently have candle data.
   */
  public getActiveSymbols(): readonly InstrumentSymbol[] {
    const symbols = new Set<InstrumentSymbol>();
    for (const key of this.candleStore.keys()) {
      const [sym] = key.split(':');
      if (sym) {
        symbols.add(sym as InstrumentSymbol);
      }
    }
    return Array.from(symbols);
  }

  // ==========================================================================
  // WRITE & INGESTION PIPELINES (NORMALIZATION & DEDUPLICATION)
  // ==========================================================================

  /**
   * Ingests and normalizes raw historical candle batches directly from Deriv.
   */
  public async ingestHistoricalFromDeriv(
    symbol: InstrumentSymbol,
    timeframe: Timeframe,
    count = 500,
  ): Promise<readonly CanonicalCandle[]> {
    const granularity = TIMEFRAME_TO_DERIV_GRANULARITY[timeframe];
    const derivSymbol = SymbolMappingEngine.toDerivSymbol(symbol);

    const rawCandles = await this.derivAdapter.fetchCandles({
      symbol: derivSymbol,
      granularity,
      count,
      end: 'latest',
    });

    const normalized = this.normalizeRawDerivCandles(
      symbol,
      timeframe,
      rawCandles,
      'REST_HISTORICAL',
    );

    this.upsertCandles(symbol, timeframe, normalized);
    return normalized;
  }

  /**
   * Ingests a raw Deriv candle batch (e.g. from backfill or stream) into the canonical series.
   */
  public ingestRawDerivCandles(
    symbol: InstrumentSymbol,
    timeframe: Timeframe,
    rawCandles: readonly DerivRawCandle[],
    ingestionPath: IngestionPath,
  ): readonly CanonicalCandle[] {
    const normalized = this.normalizeRawDerivCandles(
      symbol,
      timeframe,
      rawCandles,
      ingestionPath,
    );
    this.upsertCandles(symbol, timeframe, normalized);
    return normalized;
  }

  /**
   * Normalizes raw Deriv candle records into strict CanonicalCandle objects.
   */
  public normalizeRawDerivCandles(
    symbol: InstrumentSymbol,
    timeframe: Timeframe,
    rawItems: readonly DerivRawCandle[],
    ingestionPath: IngestionPath,
  ): readonly CanonicalCandle[] {
    const result: CanonicalCandle[] = [];

    for (const raw of rawItems) {
      const timestamp = raw.epoch * 1000;
      const isoTimestamp = new Date(timestamp).toISOString();

      const open = MarketDataNormalization.roundToPrecision(raw.open, symbol);
      const high = MarketDataNormalization.roundToPrecision(raw.high, symbol);
      const low = MarketDataNormalization.roundToPrecision(raw.low, symbol);
      const close = MarketDataNormalization.roundToPrecision(raw.close, symbol);

      const candleCandidate: CanonicalCandle = {
        symbol,
        timeframe,
        timestamp,
        isoTimestamp,
        open,
        high,
        low,
        close,
        volume: 100, // Deriv ticks_history provides OHLC without tick volume
        isComplete: true,
        source: CANONICAL_BROKER_ID,
      };

      const validation = validateCanonicalCandle(candleCandidate);
      if (validation.success) {
        this.lineageEngine.recordCandle(validation.data, ingestionPath);
        result.push(validation.data);
      } else {
        console.warn('[CanonicalMarketDataEngine] Candle failed validation:', validation.errors);
      }
    }

    return result;
  }

  /**
   * Ingests a real-time streaming price tick from Deriv.
   */
  public ingestStreamingTick(rawTick: DerivRawTick): CanonicalTick {
    const symbol = SymbolMappingEngine.toCanonicalSymbol(rawTick.symbol);
    const timestamp = rawTick.epoch * 1000;
    const isoTimestamp = new Date(timestamp).toISOString();

    const quote = rawTick.quote;
    const bid = rawTick.bid ?? quote;
    const ask = rawTick.ask ?? quote;
    const mid = (bid + ask) / 2;
    const spreadPips = MarketDataNormalization.calculateSpreadPips(ask, bid, symbol);

    const tickCandidate: CanonicalTick = {
      symbol,
      timestamp,
      isoTimestamp,
      bid,
      ask,
      mid: MarketDataNormalization.roundToPrecision(mid, symbol),
      spreadPips,
      source: CANONICAL_BROKER_ID,
    };

    const validation = validateCanonicalTick(tickCandidate);
    if (!validation.success) {
      throw new Error(
        `Failed canonical tick validation: ${validation.errors[0]?.message}`,
      );
    }

    const validatedTick = validation.data;
    this.latestTicks.set(symbol, validatedTick);

    // Update forming candles across 1H, 15M, 5M, 1M
    this.updateFormingCandlesWithTick(validatedTick);

    for (const listener of this.tickListeners) {
      try {
        listener(validatedTick);
      } catch (e) {
        console.error('Error in tick listener:', e);
      }
    }

    return validatedTick;
  }

  /**
   * Internal deduplication and storage engine.
   */
  private upsertCandles(
    symbol: InstrumentSymbol,
    timeframe: Timeframe,
    candles: readonly CanonicalCandle[],
  ): void {
    const key = this.getSeriesKey(symbol, timeframe);
    let seriesMap = this.candleStore.get(key);

    if (!seriesMap) {
      seriesMap = new Map<number, CanonicalCandle>();
      this.candleStore.set(key, seriesMap);
    }

    for (const candle of candles) {
      seriesMap.set(candle.timestamp, candle);
      // Notify listeners of latest complete or updated candle
      for (const listener of this.candleListeners) {
        try {
          listener(candle);
        } catch (e) {
          console.error('Error in candle update listener:', e);
        }
      }
    }

    // Prune oldest if series exceeds capacity
    if (seriesMap.size > this.maxSeriesCapacity) {
      const excess = seriesMap.size - this.maxSeriesCapacity;
      const sortedKeys = Array.from(seriesMap.keys()).sort((a, b) => a - b);
      for (let i = 0; i < excess; i++) {
        seriesMap.delete(sortedKeys[i]);
      }
    }
  }

  /**
   * Synthesizes live forming candle updates from incoming ticks.
   */
  private updateFormingCandlesWithTick(tick: CanonicalTick): void {
    const timeframes: Timeframe[] = ['1H', '15M', '5M', '1M'];

    for (const tf of timeframes) {
      const periodStart = MarketDataNormalization.alignTimestampToTimeframe(
        tick.timestamp,
        tf,
      );
      const key = this.getSeriesKey(tick.symbol, tf);
      let seriesMap = this.candleStore.get(key);
      if (!seriesMap) {
        seriesMap = new Map();
        this.candleStore.set(key, seriesMap);
      }

      const existing = seriesMap.get(periodStart);
      if (existing) {
        const updatedCandle: CanonicalCandle = {
          ...existing,
          high: Math.max(existing.high, tick.mid),
          low: Math.min(existing.low, tick.mid),
          close: tick.mid,
          volume: existing.volume + 1,
          spreadPips: tick.spreadPips,
        };
        seriesMap.set(periodStart, updatedCandle);
      } else {
        const newFormingCandle: CanonicalCandle = {
          symbol: tick.symbol,
          timeframe: tf,
          timestamp: periodStart,
          isoTimestamp: new Date(periodStart).toISOString(),
          open: tick.mid,
          high: tick.mid,
          low: tick.mid,
          close: tick.mid,
          volume: 1,
          isComplete: false,
          source: CANONICAL_BROKER_ID,
          spreadPips: tick.spreadPips,
        };
        seriesMap.set(periodStart, newFormingCandle);
      }
    }
  }

  // ==========================================================================
  // EVENT SUBSCRIPTIONS
  // ==========================================================================

  public subscribeCandleUpdates(listener: CandleUpdateListener): () => void {
    this.candleListeners.add(listener);
    return () => this.candleListeners.delete(listener);
  }

  public subscribeTickUpdates(listener: TickUpdateListener): () => void {
    this.tickListeners.add(listener);
    return () => this.tickListeners.delete(listener);
  }

  public clearAll(): void {
    this.candleStore.clear();
    this.latestTicks.clear();
  }
}
