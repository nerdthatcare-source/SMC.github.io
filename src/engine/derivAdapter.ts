/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Deriv WebSocket API Adapter
 *
 * Modern, strictly-typed client interfacing directly with Deriv's API per:
 * https://developers.deriv.com/llms.txt
 *
 * SPECIFICATION SUMMARY:
 * - Public market data gateway: wss://api.derivws.com/trading/v1/options/ws/public
 *   Connects directly without OTP, auth, or query parameters. Used for ticks,
 *   ticks_history, active_symbols, ping, time, and trading_times.
 * - Authenticated trading gateway: OTP-issued wss://api.derivws.com/trading/v1/options/ws/{real|demo}
 *   Obtained via REST POST /trading/v1/options/accounts/{accountId}/otp with
 *   Authorization: Bearer <token> and Deriv-App-ID header (for PAT auth).
 *   No auth handshake on the WebSocket itself.
 * - REST base URL: https://api.derivws.com
 * - Deriv-App-ID: Required header for PAT authentication on REST calls; not required
 *   for OAuth 2.0 or the public WebSocket gateway.
 * - Symbol field: underlying_symbol (from active_symbols catalog).
 *
 * HARD INVARIANTS:
 * - DERIV is the SOLE canonical broker/data source for this trading OS.
 * - No OANDA or synthetic code paths may remain.
 * - Implements req_id tracking, active_symbols, ticks_history (style "candles",
 *   granularity in seconds 3600/900/300/60 for 1H/15M/5M/1M), live subscriptions
 *   with matching forget()/forget_all() lifecycle management, and reconnect
 *   with exponential backoff, jitter, and heartbeat/stall watchdog.
 */

import WebSocket from 'ws';
import { DerivActiveSymbol, InstrumentSymbol, Timeframe } from '../types/smc';

export type { DerivActiveSymbol };

// ============================================================================
// 1. DERIV TYPES & INTERFACES
// ============================================================================

export type DerivGranularitySeconds = 3600 | 900 | 300 | 60;

export const TIMEFRAME_TO_DERIV_GRANULARITY: Record<
  Timeframe,
  DerivGranularitySeconds
> = {
  '1H': 3600,
  '15M': 900,
  '5M': 300,
  '1M': 60,
} as const;

export const DERIV_GRANULARITY_TO_TIMEFRAME: Record<
  DerivGranularitySeconds,
  Timeframe
> = {
  3600: '1H',
  900: '15M',
  300: '5M',
  60: '1M',
} as const;

export const DEFAULT_DERIV_PUBLIC_GATEWAY =
  'wss://api.derivws.com/trading/v1/options/ws/public';
export const DEFAULT_DERIV_REST_API = 'https://api.derivws.com';

export interface DerivAdapterConfig {
  readonly appId?: string; // Deriv App ID (header for REST PAT auth, default '1089')
  readonly apiToken?: string; // Server-side: Loaded from process.env.DERIV_API_TOKEN
  readonly endpoint?: string; // Default wss://api.derivws.com/trading/v1/options/ws/public
  readonly restBaseUrl?: string; // Default https://api.derivws.com
  readonly heartbeatIntervalMs?: number; // Default 30,000 ms (per Deriv best practices)
  readonly heartbeatTimeoutMs?: number; // Default 15,000 ms
  readonly baseReconnectDelayMs?: number; // Default 1,000 ms
  readonly maxReconnectDelayMs?: number; // Default 30,000 ms
  readonly backoffFactor?: number; // Default 1.8
  readonly maxJitterMs?: number; // Default 500 ms
}

export interface DerivRawCandle {
  readonly epoch: number; // Unix timestamp in seconds
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
}

export interface DerivRawTick {
  readonly epoch: number; // Unix timestamp in seconds
  readonly quote: number;
  readonly ask?: number;
  readonly bid?: number;
  readonly symbol: string;
  readonly id?: string;
  readonly pip_size?: number;
}

export interface DerivRawOhlcUpdate {
  readonly epoch: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly symbol: string;
  readonly id: string;
  readonly granularity: number;
}

export type DerivConnectionState =
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'RECONNECTING'
  | 'ERROR';

export type DerivTickCallback = (tick: DerivRawTick) => void;
export type DerivCandleCallback = (candle: DerivRawCandle, symbol: string) => void;
export type DerivStateChangeCallback = (
  newState: DerivConnectionState,
  prevState: DerivConnectionState,
  error?: Error,
) => void;

export interface DerivWebSocketCloseDetails {
  readonly code: number;
  readonly reason: string;
  readonly wasClean: boolean;
  readonly timestamp: number;
}

export interface DerivWebSocketErrorDetails {
  readonly message: string;
  readonly code?: string | number;
  readonly httpStatus?: number;
  readonly httpStatusText?: string;
  readonly raw?: unknown;
  readonly timestamp: number;
}

// ============================================================================
// 2. DERIV WEBSOCKET CLIENT ADAPTER
// ============================================================================

export class DerivAdapter {
  private socket: WebSocket | null = null;
  private state: DerivConnectionState = 'DISCONNECTED';
  private lastCloseDetails: DerivWebSocketCloseDetails | null = null;
  private lastErrorDetails: DerivWebSocketErrorDetails | null = null;
  private reqIdCounter = 1;
  private readonly pendingRequests: Map<
    number,
    {
      resolve: (data: unknown) => void;
      reject: (err: Error) => void;
      timer: ReturnType<typeof setTimeout>;
      method: string;
    }
  > = new Map();

  // Active subscriptions map: subscription_id -> handler
  private readonly subscriptionHandlers: Map<
    string,
    {
      type: 'ticks' | 'candles';
      symbol: string;
      tickCallbacks: Set<DerivTickCallback>;
      candleCallbacks: Set<DerivCandleCallback>;
    }
  > = new Map();

  // Mapping from symbol/type to subscription_id for easy lookup
  private readonly symbolToSubscriptionId: Map<string, string> = new Map();

  // Configuration
  private readonly appId: string;
  private readonly apiToken: string | undefined;
  private readonly endpoint: string;
  private readonly restBaseUrl: string;
  private readonly heartbeatIntervalMs: number;
  private readonly heartbeatTimeoutMs: number;
  private readonly baseReconnectDelayMs: number;
  private readonly maxReconnectDelayMs: number;
  private readonly backoffFactor: number;
  private readonly maxJitterMs: number;

  // Heartbeat & Watchdog
  private heartbeatIntervalTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private lastPingSentAt: number | null = null;
  private lastPongReceivedAt: number | null = null;
  private lastPongLatencyMs: number | null = null;

  // Reconnection state
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private retryCount = 0;
  private isManuallyClosed = false;

  // Event Listeners
  private readonly stateListeners: Set<DerivStateChangeCallback> = new Set();
  private readonly pingPongListeners: Set<(latencyMs: number) => void> = new Set();

  constructor(config?: DerivAdapterConfig) {
    // Server-side only: Resolve environment token strictly from process.env (never client-side)
    const envToken =
      typeof process !== 'undefined' && process.env
        ? process.env.DERIV_API_TOKEN
        : undefined;

    const envAppId =
      typeof process !== 'undefined' && process.env
        ? process.env.DERIV_APP_ID
        : undefined;

    this.appId = config?.appId || envAppId || '1089';
    this.apiToken = config?.apiToken || envToken;
    this.endpoint = config?.endpoint || DEFAULT_DERIV_PUBLIC_GATEWAY;
    this.restBaseUrl = config?.restBaseUrl || DEFAULT_DERIV_REST_API;
    this.heartbeatIntervalMs = config?.heartbeatIntervalMs || 30000;
    this.heartbeatTimeoutMs = config?.heartbeatTimeoutMs || 15000;
    this.baseReconnectDelayMs = config?.baseReconnectDelayMs || 1000;
    this.maxReconnectDelayMs = config?.maxReconnectDelayMs || 30000;
    this.backoffFactor = config?.backoffFactor || 1.8;
    this.maxJitterMs = config?.maxJitterMs || 500;
  }

  // ==========================================================================
  // CONNECTION LIFECYCLE
  // ==========================================================================

  /**
   * Resolves the WebSocket URL according to Deriv official API reference:
   * - Public market data gateway: wss://api.derivws.com/trading/v1/options/ws/public
   *   Connects directly without OTP, auth, or query parameters.
   * - OTP-issued trading URL: wss://.../ws/real?otp=... connects directly.
   * - Legacy v3 fallback: wss://ws.derivws.com/websockets/v3?app_id={appId}.
   */
  public buildWebSocketUrl(): string {
    if (this.endpoint.includes('?')) {
      return this.endpoint;
    }
    // Per Deriv reference: "No authentication, OTP, or query parameters are required" for public gateway
    if (
      this.endpoint.includes('/options/ws/public') ||
      this.endpoint.includes('/ws/public')
    ) {
      return this.endpoint;
    }
    // Legacy endpoint with app_id parameter
    if (this.appId) {
      return `${this.endpoint}?app_id=${this.appId}`;
    }
    return this.endpoint;
  }

  public async connect(): Promise<void> {
    if (this.state === 'CONNECTED' && this.socket && this.socket.readyState === WebSocket.OPEN) {
      return;
    }

    this.isManuallyClosed = false;
    this.transitionState('CONNECTING');

    return new Promise<void>((resolve, reject) => {
      try {
        const url = this.buildWebSocketUrl();
        const ws = new WebSocket(url, {
          headers: {
            Origin: 'https://app.deriv.com',
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
        });
        this.socket = ws;

        const onOpen = async () => {
          this.retryCount = 0;
          this.transitionState('CONNECTED');
          this.startHeartbeatWatchdog();

          // Deriv Reference: There is NO auth handshake on wss://.../options/ws/public.
          // Only attempt authorize message if explicitly connected to a legacy custom v3 endpoint.
          const isLegacyEndpoint = this.endpoint.includes('websockets/v3');
          if (isLegacyEndpoint && this.apiToken && this.apiToken.trim() !== '') {
            try {
              await this.authorize(this.apiToken);
            } catch (authErr) {
              console.warn('[DerivAdapter] Legacy authorization note:', authErr);
            }
          }

          resolve();
        };

        const onUnexpectedResponse = (_req: unknown, res: any) => {
          const status = res.statusCode;
          const statusText = res.statusMessage || '';
          const errMsg = `Deriv WebSocket handshake rejected: HTTP ${status} ${statusText} from ${url}`;
          console.error(`[DerivAdapter] ${errMsg}`);
          const err = new Error(errMsg);
          this.lastErrorDetails = {
            message: errMsg,
            httpStatus: status,
            httpStatusText: statusText,
            timestamp: Date.now(),
          };
          if (this.state === 'CONNECTING') {
            reject(err);
          }
          this.handleSocketFailure(err);
        };

        const onError = (ev: any) => {
          const underlying =
            ev?.error?.message ||
            ev?.message ||
            (typeof ev?.error === 'string' ? ev.error : null) ||
            'Underlying transport failure';
          const code = ev?.error?.code || ev?.code;
          const errMsg = `Deriv WebSocket error on ${url}: ${underlying}${code ? ` [code: ${code}]` : ''}`;

          console.error(`[DerivAdapter] ${errMsg}`, ev?.error || ev);

          const err = new Error(errMsg);
          this.lastErrorDetails = {
            message: underlying,
            code,
            raw: ev?.error || ev,
            timestamp: Date.now(),
          };

          if (this.state === 'CONNECTING') {
            reject(err);
          }
          this.handleSocketFailure(err);
        };

        const onClose = (ev?: any) => {
          const code = ev?.code ?? 1006;
          const reasonStr =
            typeof ev?.reason === 'string'
              ? ev.reason
              : ev?.reason?.toString?.() || '';
          const wasClean = Boolean(ev?.wasClean);

          this.lastCloseDetails = {
            code,
            reason: reasonStr,
            wasClean,
            timestamp: Date.now(),
          };

          const closeMsg = `Deriv WebSocket closed: code=${code}, reason="${reasonStr || '<none>'}", wasClean=${wasClean} on ${url}`;
          console.error(`[DerivAdapter] ${closeMsg}`);

          if (!this.isManuallyClosed) {
            this.handleSocketFailure(new Error(closeMsg));
          } else {
            this.transitionState('DISCONNECTED');
          }
        };

        const onMessage = (ev: any) => {
          this.handleIncomingMessage(ev.data);
        };

        ws.onopen = onOpen;
        ws.onerror = onError;
        ws.onclose = onClose;
        ws.onmessage = onMessage;
        if (typeof (ws as any).on === 'function') {
          (ws as any).on('unexpected-response', onUnexpectedResponse);
        }
      } catch (err) {
        this.transitionState('ERROR', err as Error);
        reject(err);
      }
    });
  }

  public disconnect(): void {
    this.isManuallyClosed = true;
    this.stopHeartbeatWatchdog();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Cancel pending requests
    for (const [reqId, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`Deriv connection disconnected; cancelled request ${reqId}`));
    }
    this.pendingRequests.clear();
    this.subscriptionHandlers.clear();
    this.symbolToSubscriptionId.clear();

    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        // Ignore
      }
      this.socket = null;
    }

    this.transitionState('DISCONNECTED');
  }

  public getState(): DerivConnectionState {
    return this.state;
  }

  public getLastPongLatencyMs(): number | null {
    return this.lastPongLatencyMs;
  }

  public getLastCloseDetails(): DerivWebSocketCloseDetails | null {
    return this.lastCloseDetails;
  }

  public getLastErrorDetails(): DerivWebSocketErrorDetails | null {
    return this.lastErrorDetails;
  }

  public onStateChange(listener: DerivStateChangeCallback): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  public onPingPong(listener: (latencyMs: number) => void): () => void {
    this.pingPongListeners.add(listener);
    return () => this.pingPongListeners.delete(listener);
  }

  // ==========================================================================
  // REQUEST-RESPONSE WITH REQ_ID TRACKING
  // ==========================================================================

  private getNextReqId(): number {
    this.reqIdCounter += 1;
    return this.reqIdCounter;
  }

  public async sendRequest<T = unknown>(
    payload: Record<string, unknown>,
    timeoutMs = 15000,
  ): Promise<T> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      await this.connect();
    }

    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('Deriv WebSocket is not connected');
    }

    const reqId = this.getNextReqId();
    const messageWithId = { ...payload, req_id: reqId };

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(reqId);
        reject(
          new Error(
            `Deriv request timed out after ${timeoutMs}ms (req_id: ${reqId}, payload: ${JSON.stringify(
              payload,
            )})`,
          ),
        );
      }, timeoutMs);

      this.pendingRequests.set(reqId, {
        resolve: resolve as (data: unknown) => void,
        reject,
        timer,
        method: Object.keys(payload)[0] || 'unknown',
      });

      this.socket!.send(JSON.stringify(messageWithId));
    });
  }

  // ==========================================================================
  // DERIV API METHODS
  // ==========================================================================

  /**
   * Fetches trading account list via Deriv REST API per:
   * https://developers.deriv.com/llms/authentication.md
   * GET /trading/v1/options/accounts
   * Requires Authorization: Bearer <token> (+ Deriv-App-ID header for PAT auth).
   */
  public async fetchTradingAccounts(token?: string): Promise<unknown> {
    const authToken = token || this.apiToken;
    if (!authToken) {
      throw new Error('No Deriv API token available for authenticated REST request');
    }

    const res = await fetch(`${this.restBaseUrl}/trading/v1/options/accounts`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Deriv-App-ID': this.appId,
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Deriv REST fetchTradingAccounts failed [${res.status}]: ${errorText}`);
    }

    return res.json();
  }

  /**
   * Requests a WebSocket One-Time-Password (OTP) URL for authenticated trading per:
   * https://developers.deriv.com/llms/websocket.md
   * POST /trading/v1/options/accounts/{accountId}/otp
   * Returns data.url (e.g., wss://api.derivws.com/trading/v1/options/ws/real?otp=...)
   */
  public async requestTradingOtpUrl(
    accountId: string,
    token?: string,
  ): Promise<string> {
    const authToken = token || this.apiToken;
    if (!authToken) {
      throw new Error('No Deriv API token available to request trading OTP URL');
    }

    const res = await fetch(
      `${this.restBaseUrl}/trading/v1/options/accounts/${encodeURIComponent(accountId)}/otp`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Deriv-App-ID': this.appId,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      },
    );

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Deriv OTP request failed [${res.status}]: ${errorText}`);
    }

    const data = (await res.json()) as { data?: { url?: string } };
    if (!data.data?.url) {
      throw new Error('Deriv OTP response missing data.url');
    }

    return data.data.url;
  }

  /**
   * Authorizes the WebSocket connection with a token (legacy custom endpoint support).
   * Note: The modern Deriv API specification (https://developers.deriv.com/llms.txt)
   * does not use an in-band WebSocket auth handshake on wss://.../options/ws/public.
   */
  public async authorize(token: string): Promise<Record<string, unknown>> {
    const res = await this.sendRequest<Record<string, unknown>>({
      authorize: token,
    });
    if (res.error) {
      const errObj = res.error as { message?: string; code?: string };
      throw new Error(`Deriv Authorization Failed [${errObj.code}]: ${errObj.message}`);
    }
    return res;
  }

  /**
   * Fetches the complete list of active tradeable symbols from Deriv.
   * Deriv specification states: "the symbol field is underlying_symbol".
   */
  public async getActiveSymbols(activeSymbolsStyle: 'brief' | 'full' = 'brief'): Promise<readonly DerivActiveSymbol[]> {
    const res = await this.sendRequest<{
      active_symbols?: Array<{
        symbol?: string;
        display_name?: string;
        underlying_symbol?: string;
        underlying_symbol_name?: string;
        market?: string;
        submarket?: string;
        symbol_type?: string;
        underlying_symbol_type?: string;
        is_trading_suspended?: 0 | 1;
        pip_size?: number;
        pip?: number;
      }>;
      error?: { message: string };
    }>({
      active_symbols: activeSymbolsStyle,
    });

    if (res.error) {
      throw new Error(`Deriv getActiveSymbols failed: ${res.error.message}`);
    }

    const rawList = res.active_symbols || [];
    return rawList.map((item) => {
      const sym = item.underlying_symbol || item.symbol || '';
      const disp =
        item.underlying_symbol_name ||
        item.display_name ||
        item.underlying_symbol ||
        item.symbol ||
        '';
      return {
        symbol: sym,
        display_name: disp,
        market: item.market || '',
        submarket: item.submarket || '',
        symbol_type: item.underlying_symbol_type || item.symbol_type || item.market || '',
        is_trading_suspended: item.is_trading_suspended,
        pip: item.pip ?? item.pip_size,
        underlying_symbol: sym,
        underlying_symbol_name: disp,
      };
    });
  }

  /**
   * Fetches historical OHLC candle data via ticks_history.
   */
  public async fetchCandles(params: {
    symbol: string;
    granularity: DerivGranularitySeconds;
    count?: number;
    start?: number; // epoch in seconds
    end?: number | 'latest'; // epoch in seconds or 'latest'
  }): Promise<readonly DerivRawCandle[]> {
    const payload: Record<string, unknown> = {
      ticks_history: params.symbol,
      style: 'candles',
      granularity: params.granularity,
      count: params.count ?? 500,
      end: params.end ?? 'latest',
      adjust_start_time: 1,
    };

    if (params.start !== undefined) {
      payload.start = params.start;
    }

    const res = await this.sendRequest<{
      candles?: DerivRawCandle[];
      error?: { message: string; code: string };
    }>(payload);

    if (res.error) {
      throw new Error(`Deriv fetchCandles failed [${res.error.code}]: ${res.error.message}`);
    }

    return res.candles || [];
  }

  /**
   * Subscribes to live price ticks for a symbol.
   * Handles idempotency and already subscribed errors automatically.
   */
  public async subscribeTicks(
    symbol: string,
    callback: DerivTickCallback,
  ): Promise<string> {
    const key = `ticks:${symbol}`;
    const existingSubId = this.symbolToSubscriptionId.get(key);
    if (existingSubId) {
      const handler = this.subscriptionHandlers.get(existingSubId);
      if (handler) {
        handler.tickCallbacks.add(callback);
        return existingSubId;
      }
    }

    try {
      const res = await this.sendRequest<{
        subscription?: { id: string };
        tick?: DerivRawTick;
        error?: { message: string; code: string };
      }>({
        ticks: symbol,
        subscribe: 1,
      });

      if (res.error) {
        if (
          res.error.code === 'AlreadySubscribed' ||
          res.error.message?.includes('AlreadySubscribed') ||
          res.error.message?.includes('already subscribed')
        ) {
          return this.handleAlreadySubscribedTicks(symbol, callback);
        }
        throw new Error(`Deriv subscribeTicks failed for ${symbol}: ${res.error.message}`);
      }

      const subId = res.subscription?.id;
      if (!subId) {
        throw new Error(`Deriv subscribeTicks response missing subscription ID for ${symbol}`);
      }

      let handler = this.subscriptionHandlers.get(subId);
      if (!handler) {
        handler = {
          type: 'ticks',
          symbol,
          tickCallbacks: new Set([callback]),
          candleCallbacks: new Set(),
        };
        this.subscriptionHandlers.set(subId, handler);
      } else {
        handler.tickCallbacks.add(callback);
      }
      this.symbolToSubscriptionId.set(key, subId);

      // If an initial tick arrived in the response, deliver it
      if (res.tick) {
        try {
          callback(res.tick);
        } catch (err) {
          console.error('[DerivAdapter] Initial tick callback error:', err);
        }
      }

      return subId;
    } catch (err: any) {
      if (
        err?.message?.includes('AlreadySubscribed') ||
        err?.message?.includes('already subscribed')
      ) {
        return this.handleAlreadySubscribedTicks(symbol, callback);
      }
      throw err;
    }
  }

  private handleAlreadySubscribedTicks(
    symbol: string,
    callback: DerivTickCallback,
  ): string {
    const key = `ticks:${symbol}`;
    let subId = this.symbolToSubscriptionId.get(key);
    if (!subId) {
      subId = `sub-ticks-${symbol}`;
      this.symbolToSubscriptionId.set(key, subId);
    }
    let handler = this.subscriptionHandlers.get(subId);
    if (!handler) {
      handler = {
        type: 'ticks',
        symbol,
        tickCallbacks: new Set([callback]),
        candleCallbacks: new Set(),
      };
      this.subscriptionHandlers.set(subId, handler);
    } else {
      handler.tickCallbacks.add(callback);
    }
    return subId;
  }

  /**
   * Subscribes to live OHLC candle streaming updates via ticks_history.
   */
  public async subscribeCandles(
    symbol: string,
    granularity: DerivGranularitySeconds,
    callback: DerivCandleCallback,
  ): Promise<string> {
    const key = `candles:${symbol}:${granularity}`;
    const existingSubId = this.symbolToSubscriptionId.get(key);
    if (existingSubId) {
      const handler = this.subscriptionHandlers.get(existingSubId);
      if (handler) {
        handler.candleCallbacks.add(callback);
        return existingSubId;
      }
    }

    try {
      const res = await this.sendRequest<{
        subscription?: { id: string };
        candles?: DerivRawCandle[];
        ohlc?: DerivRawOhlcUpdate;
        error?: { message: string; code: string };
      }>({
        ticks_history: symbol,
        style: 'candles',
        granularity,
        end: 'latest',
        count: 1,
        subscribe: 1,
      });

      if (res.error) {
        if (
          res.error.code === 'AlreadySubscribed' ||
          res.error.message?.includes('AlreadySubscribed') ||
          res.error.message?.includes('already subscribed')
        ) {
          return this.handleAlreadySubscribedCandles(symbol, granularity, callback);
        }
        throw new Error(`Deriv subscribeCandles failed for ${symbol}: ${res.error.message}`);
      }

      const subId = res.subscription?.id;
      if (!subId) {
        throw new Error(`Deriv subscribeCandles response missing subscription ID for ${symbol}`);
      }

      let handler = this.subscriptionHandlers.get(subId);
      if (!handler) {
        handler = {
          type: 'candles',
          symbol,
          tickCallbacks: new Set(),
          candleCallbacks: new Set([callback]),
        };
        this.subscriptionHandlers.set(subId, handler);
      } else {
        handler.candleCallbacks.add(callback);
      }
      this.symbolToSubscriptionId.set(key, subId);

      return subId;
    } catch (err: any) {
      if (
        err?.message?.includes('AlreadySubscribed') ||
        err?.message?.includes('already subscribed')
      ) {
        return this.handleAlreadySubscribedCandles(symbol, granularity, callback);
      }
      throw err;
    }
  }

  private handleAlreadySubscribedCandles(
    symbol: string,
    granularity: DerivGranularitySeconds,
    callback: DerivCandleCallback,
  ): string {
    const key = `candles:${symbol}:${granularity}`;
    let subId = this.symbolToSubscriptionId.get(key);
    if (!subId) {
      subId = `sub-candles-${symbol}-${granularity}`;
      this.symbolToSubscriptionId.set(key, subId);
    }
    let handler = this.subscriptionHandlers.get(subId);
    if (!handler) {
      handler = {
        type: 'candles',
        symbol,
        tickCallbacks: new Set(),
        candleCallbacks: new Set([callback]),
      };
      this.subscriptionHandlers.set(subId, handler);
    } else {
      handler.candleCallbacks.add(callback);
    }
    return subId;
  }

  /**
   * Forgets a specific subscription by its ID.
   */
  public async forget(subscriptionId: string): Promise<boolean> {
    const handler = this.subscriptionHandlers.get(subscriptionId);
    if (!handler) {
      if (this.socket && this.socket.readyState === WebSocket.OPEN && !subscriptionId.startsWith('sub-')) {
        try {
          await this.sendRequest({ forget: subscriptionId });
        } catch {
          // Ignore
        }
      }
      return true;
    }

    try {
      if (!subscriptionId.startsWith('sub-') && this.socket && this.socket.readyState === WebSocket.OPEN) {
        await this.sendRequest({
          forget: subscriptionId,
        });
      }
    } catch {
      // Ignore forget errors during teardown
    } finally {
      this.subscriptionHandlers.delete(subscriptionId);
      for (const [key, id] of this.symbolToSubscriptionId.entries()) {
        if (id === subscriptionId) {
          this.symbolToSubscriptionId.delete(key);
        }
      }
    }
    return true;
  }

  /**
   * Forgets all subscriptions of given types (e.g. ['ticks', 'candles']).
   */
  public async forgetAll(types: ('ticks' | 'candles')[] = ['ticks', 'candles']): Promise<boolean> {
    try {
      await this.sendRequest({
        forget_all: types,
      });
    } catch {
      // Ignore
    } finally {
      this.subscriptionHandlers.clear();
      this.symbolToSubscriptionId.clear();
    }
    return true;
  }

  // ==========================================================================
  // MESSAGE HANDLING & SUBSCRIPTION DISPATCH
  // ==========================================================================

  private handleIncomingMessage(rawMessage: string | ArrayBuffer): void {
    if (typeof rawMessage !== 'string') return;

    try {
      const msg = JSON.parse(rawMessage) as Record<string, unknown>;

      // 1. Handle Ping / Heartbeat Pong
      if (msg.ping === 'pong') {
        const now = Date.now();
        this.lastPongReceivedAt = now;
        if (this.lastPingSentAt !== null) {
          this.lastPongLatencyMs = now - this.lastPingSentAt;
          for (const listener of this.pingPongListeners) {
            listener(this.lastPongLatencyMs);
          }
        }
        this.resetHeartbeatTimeoutTimer();
        return;
      }

      // 2. Handle Request-Response via req_id
      if (typeof msg.req_id === 'number') {
        const reqId = msg.req_id;
        const pending = this.pendingRequests.get(reqId);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingRequests.delete(reqId);
          if (msg.error) {
            pending.reject(
              new Error(
                `Deriv Error [${(msg.error as { code: string }).code}]: ${
                  (msg.error as { message: string }).message
                }`,
              ),
            );
          } else {
            pending.resolve(msg);
          }
        }
      }

      // 3. Handle Live Stream Ticks
      if (msg.msg_type === 'tick' && msg.tick) {
        const rawTick = msg.tick as DerivRawTick;
        const subId = (msg.subscription as { id: string } | undefined)?.id;
        const delivered = new Set<DerivTickCallback>();

        if (subId) {
          const handler = this.subscriptionHandlers.get(subId);
          if (handler && handler.tickCallbacks) {
            for (const cb of handler.tickCallbacks) {
              delivered.add(cb);
              try {
                cb(rawTick);
              } catch (err) {
                console.error('[DerivAdapter] Tick callback error:', err);
              }
            }
          }
        }

        // Also deliver to any handler matching rawTick.symbol
        for (const handler of this.subscriptionHandlers.values()) {
          if (handler.type === 'ticks' && handler.symbol === rawTick.symbol && handler.tickCallbacks) {
            for (const cb of handler.tickCallbacks) {
              if (!delivered.has(cb)) {
                delivered.add(cb);
                try {
                  cb(rawTick);
                } catch (err) {
                  console.error('[DerivAdapter] Tick callback error:', err);
                }
              }
            }
          }
        }
      }

      // 4. Handle Live OHLC Candle Updates
      if (msg.msg_type === 'ohlc' && msg.ohlc) {
        const ohlc = msg.ohlc as DerivRawOhlcUpdate;
        const candle: DerivRawCandle = {
          epoch: ohlc.epoch,
          open: ohlc.open,
          high: ohlc.high,
          low: ohlc.low,
          close: ohlc.close,
        };

        const subId = (msg.subscription as { id: string } | undefined)?.id;
        const delivered = new Set<DerivCandleCallback>();

        if (subId) {
          const handler = this.subscriptionHandlers.get(subId);
          if (handler && handler.candleCallbacks) {
            for (const cb of handler.candleCallbacks) {
              delivered.add(cb);
              try {
                cb(candle, ohlc.symbol);
              } catch (err) {
                console.error('[DerivAdapter] Candle callback error:', err);
              }
            }
          }
        }

        for (const handler of this.subscriptionHandlers.values()) {
          if (handler.type === 'candles' && handler.symbol === ohlc.symbol && handler.candleCallbacks) {
            for (const cb of handler.candleCallbacks) {
              if (!delivered.has(cb)) {
                delivered.add(cb);
                try {
                  cb(candle, ohlc.symbol);
                } catch (err) {
                  console.error('[DerivAdapter] Candle callback error:', err);
                }
              }
            }
          }
        }
      }
    } catch (parseErr) {
      console.warn('[DerivAdapter] Message parse error:', parseErr);
    }
  }

  // ==========================================================================
  // HEARTBEAT / STALL WATCHDOG
  // ==========================================================================

  private startHeartbeatWatchdog(): void {
    this.stopHeartbeatWatchdog();

    this.heartbeatIntervalTimer = setInterval(() => {
      this.sendPing();
    }, this.heartbeatIntervalMs);

    // Initial ping
    this.sendPing();
  }

  private stopHeartbeatWatchdog(): void {
    if (this.heartbeatIntervalTimer) {
      clearInterval(this.heartbeatIntervalTimer);
      this.heartbeatIntervalTimer = null;
    }
    this.resetHeartbeatTimeoutTimer();
  }

  private sendPing(): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;

    this.lastPingSentAt = Date.now();
    try {
      this.socket.send(JSON.stringify({ ping: 1 }));
      this.startHeartbeatTimeoutTimer();
    } catch {
      this.handleSocketFailure(new Error('Failed to send heartbeat ping to Deriv'));
    }
  }

  private startHeartbeatTimeoutTimer(): void {
    this.resetHeartbeatTimeoutTimer();
    this.heartbeatTimeoutTimer = setTimeout(() => {
      console.warn('[DerivAdapter] Heartbeat stall detected! No pong received within timeout.');
      this.handleSocketFailure(new Error('Deriv WebSocket heartbeat stall watchdog triggered'));
    }, this.heartbeatTimeoutMs);
  }

  private resetHeartbeatTimeoutTimer(): void {
    if (this.heartbeatTimeoutTimer) {
      clearTimeout(this.heartbeatTimeoutTimer);
      this.heartbeatTimeoutTimer = null;
    }
  }

  // ==========================================================================
  // RECONNECTION WITH EXPONENTIAL BACKOFF & JITTER
  // ==========================================================================

  private handleSocketFailure(err: Error): void {
    if (this.isManuallyClosed) return;

    this.stopHeartbeatWatchdog();
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        // Ignore
      }
      this.socket = null;
    }

    this.transitionState('RECONNECTING', err);
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    this.retryCount += 1;
    const expDelay = this.baseReconnectDelayMs * Math.pow(this.backoffFactor, this.retryCount - 1);
    const cappedDelay = Math.min(this.maxReconnectDelayMs, expDelay);
    const jitter = Math.random() * this.maxJitterMs;
    const finalDelay = Math.floor(cappedDelay + jitter);

    console.info(`[DerivAdapter] Scheduling reconnect in ${finalDelay}ms (attempt #${this.retryCount})`);

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.connect();
      } catch (err) {
        console.warn(`[DerivAdapter] Reconnect attempt #${this.retryCount} failed:`, err);
        // Will automatically schedule next attempt through handleSocketFailure
      }
    }, finalDelay);
  }

  private transitionState(newState: DerivConnectionState, error?: Error): void {
    if (this.state === newState) return;
    const prevState = this.state;
    this.state = newState;
    for (const listener of this.stateListeners) {
      listener(newState, prevState, error);
    }
  }
}
