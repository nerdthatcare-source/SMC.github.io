/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Market Data Client API Service
 *
 * Dedicated client-side service consuming already-processed canonical market data
 * and live streaming events from the Express server (/api/market/*).
 *
 * Integrated with M38 Access Gateway & M34 Identity:
 * - Injects signed session Bearer token into all API calls
 * - Provides token parameter to EventSource for SSE authentication
 * - Handles authentication state and admin credentials
 */

import {
  ActiveSafetyBlock,
  CatalogInstrumentItem,
  DerivHealthMetrics,
  FeedStatus,
  InstrumentSymbol,
  LineageAuditSummary,
  CandleLineageRecord,
  SymbolVerificationReport,
  Timeframe,
  DerivBackfillJobResult,
  WatchlistEntry,
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
  readonly type: 'init' | 'tick' | 'candle' | 'health' | 'watchlist';
  readonly status?: FeedStatus;
  readonly metrics?: DerivHealthMetrics;
  readonly tick?: CanonicalTick;
  readonly candle?: CanonicalCandle;
  readonly watchlist?: readonly WatchlistEntry[];
  readonly serverTime?: number;
}

export type StreamEventListener = (event: StreamEvent) => void;

export class MarketDataApiClient {
  private static eventSource: EventSource | null = null;
  private static readonly eventListeners: Set<StreamEventListener> = new Set();
  private static authToken: string | null = null;

  public static setAuthToken(token: string | null): void {
    this.authToken = token;
    if (typeof window !== 'undefined') {
      if (token) {
        sessionStorage.setItem('smc_session_token', token);
      } else {
        sessionStorage.removeItem('smc_session_token');
      }
    }
  }

  public static getAuthToken(): string | null {
    if (!this.authToken && typeof window !== 'undefined') {
      this.authToken = sessionStorage.getItem('smc_session_token');
    }
    return this.authToken;
  }

  private static getHeaders(customHeaders?: HeadersInit): HeadersInit {
    const headers: Record<string, string> = {};
    if (customHeaders) {
      Object.assign(headers, customHeaders);
    }
    const token = this.getAuthToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  private static authRequiredHandler?: () => void;

  /**
   * Registers a callback invoked whenever authentication is missing or revoked.
   */
  public static onAuthRequired(handler: () => void): void {
    this.authRequiredHandler = handler;
  }

  /**
   * Handles authentication failure by clearing storage and notifying listeners.
   */
  public static handleAuthFailure(): void {
    this.setAuthToken(null);
    if (this.authRequiredHandler) {
      this.authRequiredHandler();
    }
  }

  /**
   * Verifies whether the client has an active authenticated session token.
   * NEVER automatically logs in with admin credentials.
   * If unauthenticated, notifies listeners so client redirects to the login screen.
   */
  public static async ensureAuthenticated(): Promise<string | null> {
    const existing = this.getAuthToken();
    if (!existing) {
      this.handleAuthFailure();
      return null;
    }
    return existing;
  }

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
    await this.ensureAuthenticated();
    const res = await fetch('/api/market/active-symbols', {
      headers: this.getHeaders(),
    });
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
    await this.ensureAuthenticated();
    const res = await fetch(
      `/api/market/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(
        timeframe,
      )}&limit=${limit}`,
      { headers: this.getHeaders() },
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
    await this.ensureAuthenticated();
    const res = await fetch(
      `/api/market/all-candles?symbol=${encodeURIComponent(symbol)}`,
      { headers: this.getHeaders() },
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
    await this.ensureAuthenticated();
    const res = await fetch(
      `/api/market/latest-tick?symbol=${encodeURIComponent(symbol)}`,
      { headers: this.getHeaders() },
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
    await this.ensureAuthenticated();
    const res = await fetch(
      `/api/market/safety?symbol=${encodeURIComponent(symbol)}`,
      { headers: this.getHeaders() },
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
    await this.ensureAuthenticated();
    const res = await fetch(
      `/api/market/lineage?symbol=${encodeURIComponent(symbol)}&limit=${limit}`,
      { headers: this.getHeaders() },
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
    await this.ensureAuthenticated();
    const res = await fetch('/api/market/stream/start', {
      method: 'POST',
      headers: this.getHeaders({ 'Content-Type': 'application/json' }),
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
    await this.ensureAuthenticated();
    const res = await fetch('/api/market/stream/stop', {
      method: 'POST',
      headers: this.getHeaders({ 'Content-Type': 'application/json' }),
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
    await this.ensureAuthenticated();
    const res = await fetch('/api/market/backfill', {
      method: 'POST',
      headers: this.getHeaders({ 'Content-Type': 'application/json' }),
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
    await this.ensureAuthenticated();
    const res = await fetch('/api/market/fetch-live', {
      method: 'POST',
      headers: this.getHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ symbol }),
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch live instrument: HTTP ${res.status}`);
    }
    return res.json();
  }

  /**
   * Fetches the filtered browsable catalog across Forex, Commodities, Indices, and Crypto.
   * Browse-only: does not trigger subscriptions or engine analysis.
   */
  public static async fetchCatalog(): Promise<readonly CatalogInstrumentItem[]> {
    await this.ensureAuthenticated();
    const res = await fetch('/api/market/catalog', {
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch catalog: HTTP ${res.status}`);
    }
    return res.json();
  }

  /**
   * Fetches the current watchlisted instruments.
   */
  public static async fetchWatchlist(): Promise<readonly WatchlistEntry[]> {
    await this.ensureAuthenticated();
    const res = await fetch('/api/market/watchlist', {
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch watchlist: HTTP ${res.status}`);
    }
    return res.json();
  }

  /**
   * Adds an instrument to the active watchlist (triggers multiplexed subscription & backfill).
   */
  public static async addToWatchlist(
    symbol: string,
  ): Promise<{ success: boolean; entry: WatchlistEntry }> {
    await this.ensureAuthenticated();
    const res = await fetch('/api/market/watchlist/add', {
      method: 'POST',
      headers: this.getHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ symbol }),
    });
    if (!res.ok) {
      throw new Error(`Failed to add to watchlist: HTTP ${res.status}`);
    }
    return res.json();
  }

  /**
   * Removes an instrument from the active watchlist (unsubscribes and fully clears state).
   */
  public static async removeFromWatchlist(
    symbol: string,
  ): Promise<{ success: boolean }> {
    await this.ensureAuthenticated();
    const res = await fetch('/api/market/watchlist/remove', {
      method: 'POST',
      headers: this.getHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ symbol }),
    });
    if (!res.ok) {
      throw new Error(`Failed to remove from watchlist: HTTP ${res.status}`);
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
        const token = this.getAuthToken();
        const url = token
          ? `/api/market/events?token=${encodeURIComponent(token)}`
          : '/api/market/events';
        const es = new EventSource(url);
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
