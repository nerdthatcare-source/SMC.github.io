/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Market Data Client API Service
 *
 * Dedicated client-side service consuming already-processed canonical market data
 * and live streaming events from the Express server (/api/market/*).
 *
 * HARD SECURITY & ARCHITECTURAL INVARIANTS:
 * - NO direct browser WebSocket connection to Deriv.
 * - ZERO references to DERIV_API_TOKEN (server-managed only).
 * - Receives strictly sanitized, canonical SMC contracts.
 */

import {
  ActiveSafetyBlock,
  DerivHealthMetrics,
  FeedStatus,
  InstrumentSymbol,
  LineageAuditSummary,
  CandleLineageRecord,
  SymbolVerificationReport,
  Timeframe,
  DerivBackfillJobResult,
} from '../types/smc';
import {
  CanonicalCandle,
  CanonicalTick,
} from '../engine/canonicalDataContracts';

export interface MarketHealthResponse {
  readonly status: string;
  readonly feedStatus: FeedStatus;
  readonly metrics: DerivHealthMetrics;
  readonly hasToken: boolean;
  readonly appId: string;
  readonly serverTime: number;
}

export interface StreamEvent {
  readonly type: 'init' | 'tick' | 'candle' | 'health';
  readonly status?: FeedStatus;
  readonly metrics?: DerivHealthMetrics;
  readonly tick?: CanonicalTick;
  readonly candle?: CanonicalCandle;
  readonly serverTime?: number;
}

export type StreamEventListener = (event: StreamEvent) => void;

export class MarketDataApiClient {
  private static eventSource: EventSource | null = null;
  private static readonly eventListeners: Set<StreamEventListener> = new Set();

  /**
   * Fetches backend health status, Deriv connection metrics, and token status.
   */
  public static async fetchHealth(): Promise<MarketHealthResponse> {
    const res = await fetch('/api/health');
    if (!res.ok) {
      throw new Error(`Failed to fetch server health: HTTP ${res.status}`);
    }
    return res.json();
  }

  /**
   * Fetches active symbols verification report.
   */
  public static async fetchActiveSymbols(): Promise<SymbolVerificationReport> {
    const res = await fetch('/api/market/active-symbols');
    if (!res.ok) {
      throw new Error(`Failed to fetch active symbols: HTTP ${res.status}`);
    }
    return res.json();
  }

  /**
   * Fetches canonical candles for a symbol and timeframe.
   */
  public static async fetchCandles(
    symbol: InstrumentSymbol,
    timeframe: Timeframe,
    limit = 100,
  ): Promise<readonly CanonicalCandle[]> {
    const res = await fetch(
      `/api/market/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(
        timeframe,
      )}&limit=${limit}`,
    );
    if (!res.ok) {
      throw new Error(`Failed to fetch candles: HTTP ${res.status}`);
    }
    return res.json();
  }

  /**
   * Fetches all four timeframes (1H, 15M, 5M, 1M) for a symbol simultaneously.
   */
  public static async fetchAllCandles(
    symbol: InstrumentSymbol,
  ): Promise<Record<Timeframe, readonly CanonicalCandle[]>> {
    const res = await fetch(
      `/api/market/all-candles?symbol=${encodeURIComponent(symbol)}`,
    );
    if (!res.ok) {
      throw new Error(`Failed to fetch all candles: HTTP ${res.status}`);
    }
    return res.json();
  }

  /**
   * Fetches latest canonical tick.
   */
  public static async fetchLatestTick(
    symbol: InstrumentSymbol,
  ): Promise<CanonicalTick | null> {
    const res = await fetch(
      `/api/market/latest-tick?symbol=${encodeURIComponent(symbol)}`,
    );
    if (!res.ok) {
      throw new Error(`Failed to fetch latest tick: HTTP ${res.status}`);
    }
    return res.json();
  }

  /**
   * Fetches safety gates and active blocks.
   */
  public static async fetchSafety(
    symbol: InstrumentSymbol,
  ): Promise<{ allowed: boolean; blocks: readonly ActiveSafetyBlock[] }> {
    const res = await fetch(
      `/api/market/safety?symbol=${encodeURIComponent(symbol)}`,
    );
    if (!res.ok) {
      throw new Error(`Failed to fetch safety status: HTTP ${res.status}`);
    }
    return res.json();
  }

  /**
   * Fetches data lineage audit records and summary.
   */
  public static async fetchLineage(
    symbol: InstrumentSymbol,
    limit = 30,
  ): Promise<{
    records: readonly CandleLineageRecord[];
    summary: LineageAuditSummary;
  }> {
    const res = await fetch(
      `/api/market/lineage?symbol=${encodeURIComponent(symbol)}&limit=${limit}`,
    );
    if (!res.ok) {
      throw new Error(`Failed to fetch lineage: HTTP ${res.status}`);
    }
    return res.json();
  }

  /**
   * Requests backend to start streaming ticks/candles for instruments.
   */
  public static async startStreaming(
    symbols: readonly InstrumentSymbol[],
  ): Promise<boolean> {
    const res = await fetch('/api/market/stream/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbols }),
    });
    if (!res.ok) {
      throw new Error(`Failed to start streaming: HTTP ${res.status}`);
    }
    const data = await res.json();
    return data.success;
  }

  /**
   * Requests backend to stop streaming.
   */
  public static async stopStreaming(): Promise<boolean> {
    const res = await fetch('/api/market/stream/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      throw new Error(`Failed to stop streaming: HTTP ${res.status}`);
    }
    const data = await res.json();
    return data.success;
  }

  /**
   * Requests backend to execute backfill recovery.
   */
  public static async triggerBackfill(
    symbol: InstrumentSymbol,
  ): Promise<readonly DerivBackfillJobResult[]> {
    const res = await fetch('/api/market/backfill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol }),
    });
    if (!res.ok) {
      throw new Error(`Failed to execute backfill: HTTP ${res.status}`);
    }
    const data = await res.json();
    return data.results || [];
  }

  /**
   * End-to-end trigger: requests backend to fetch live quotes for an instrument from Deriv.
   */
  public static async fetchLiveInstrument(symbol: InstrumentSymbol): Promise<{
    success: boolean;
    symbol: string;
    latestTick: CanonicalTick | null;
    latestCandle: CanonicalCandle | null;
    candlesCount: number;
  }> {
    const res = await fetch('/api/market/fetch-live', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol }),
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch live instrument: HTTP ${res.status}`);
    }
    return res.json();
  }

  /**
   * Subscribes to real-time Server-Sent Events from the backend.
   */
  public static subscribeStreamEvents(
    listener: StreamEventListener,
  ): () => void {
    this.eventListeners.add(listener);

    if (!this.eventSource && typeof window !== 'undefined') {
      try {
        const es = new EventSource('/api/market/events');
        this.eventSource = es;

        es.onmessage = (ev) => {
          try {
            const data: StreamEvent = JSON.parse(ev.data);
            for (const sub of this.eventListeners) {
              sub(data);
            }
          } catch (err) {
            console.warn('[MarketDataApiClient] Parse error on SSE event:', err);
          }
        };

        es.onerror = (err) => {
          console.warn('[MarketDataApiClient] SSE connection event:', err);
        };
      } catch (e) {
        console.warn('[MarketDataApiClient] EventSource unavailable:', e);
      }
    }

    return () => {
      this.eventListeners.delete(listener);
      if (this.eventListeners.size === 0 && this.eventSource) {
        this.eventSource.close();
        this.eventSource = null;
      }
    };
  }
}
