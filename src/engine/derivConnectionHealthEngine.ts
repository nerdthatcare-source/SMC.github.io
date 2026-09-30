/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Deriv Connection Health Engine
 *
 * Tracks live streaming connection uptime, transit latency, heartbeat freshness,
 * reconnect count, and emits canonical FeedStatus to all downstream market consumers.
 */

import { FeedStatus } from '../types/smc';
import { DerivAdapter, DerivConnectionState } from './derivAdapter';

export interface DerivHealthMetrics {
  readonly status: FeedStatus;
  readonly connectionState: DerivConnectionState;
  readonly uptimeMs: number;
  readonly connectedSince: number | null;
  readonly lastPongLatencyMs: number | null;
  readonly averageLatencyMs: number | null;
  readonly messagesReceivedTotal: number;
  readonly reconnectCount: number;
  readonly lastError: string | null;
}

export type DerivHealthSubscriber = (
  status: FeedStatus,
  metrics: DerivHealthMetrics,
) => void;

export class DerivConnectionHealthEngine {
  private status: FeedStatus = 'DISCONNECTED';
  private connectedSince: number | null = null;
  private lastPongLatencyMs: number | null = null;
  private averageLatencyMs: number | null = null;
  private latencySamples: number[] = [];
  private messagesReceivedTotal = 0;
  private reconnectCount = 0;
  private lastError: string | null = null;

  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;
  private readonly subscribers: Set<DerivHealthSubscriber> = new Set();

  // Latency Thresholds
  private readonly degradedLatencyThresholdMs = 1500; // Latency > 1.5s = DEGRADED_LATENCY

  constructor(private readonly derivAdapter: DerivAdapter) {
    this.bindAdapterEvents();
    this.startHealthPolling();
  }

  // ==========================================================================
  // EVENT BINDINGS
  // ==========================================================================

  private bindAdapterEvents(): void {
    this.derivAdapter.onStateChange((newState, prevState, err) => {
      if (err) {
        this.lastError = err.message;
      }

      if (newState === 'CONNECTED') {
        this.connectedSince = Date.now();
        this.status = 'HEALTHY_STREAMING';
      } else if (newState === 'CONNECTING') {
        this.status = 'CONNECTING';
      } else if (newState === 'RECONNECTING') {
        this.reconnectCount += 1;
        this.status = 'CONNECTING';
      } else if (newState === 'ERROR') {
        this.status = 'ERROR';
      } else if (newState === 'DISCONNECTED') {
        this.connectedSince = null;
        this.status = 'DISCONNECTED';
      }

      this.notifySubscribers();
    });

    this.derivAdapter.onPingPong((latencyMs) => {
      this.lastPongLatencyMs = latencyMs;
      this.messagesReceivedTotal += 1;

      // Maintain rolling average of last 10 latency samples
      this.latencySamples.push(latencyMs);
      if (this.latencySamples.length > 10) {
        this.latencySamples.shift();
      }
      const sum = this.latencySamples.reduce((a, b) => a + b, 0);
      this.averageLatencyMs = Math.round(sum / this.latencySamples.length);

      // Check for degraded latency
      if (this.status === 'HEALTHY_STREAMING' && this.averageLatencyMs > this.degradedLatencyThresholdMs) {
        this.status = 'DEGRADED_LATENCY';
      } else if (this.status === 'DEGRADED_LATENCY' && this.averageLatencyMs <= this.degradedLatencyThresholdMs) {
        this.status = 'HEALTHY_STREAMING';
      }

      this.notifySubscribers();
    });
  }

  private startHealthPolling(): void {
    if (this.healthCheckInterval) return;

    this.healthCheckInterval = setInterval(() => {
      this.notifySubscribers();
    }, 2000);
  }

  // ==========================================================================
  // METRICS COMPUTATION
  // ==========================================================================

  public getMetrics(): DerivHealthMetrics {
    const now = Date.now();
    const uptimeMs = this.connectedSince ? Math.max(0, now - this.connectedSince) : 0;

    return {
      status: this.status,
      connectionState: this.derivAdapter.getState(),
      uptimeMs,
      connectedSince: this.connectedSince,
      lastPongLatencyMs: this.lastPongLatencyMs,
      averageLatencyMs: this.averageLatencyMs,
      messagesReceivedTotal: this.messagesReceivedTotal,
      reconnectCount: this.reconnectCount,
      lastError: this.lastError,
    };
  }

  public getStatus(): FeedStatus {
    return this.status;
  }

  public subscribe(subscriber: DerivHealthSubscriber): () => void {
    this.subscribers.add(subscriber);
    subscriber(this.status, this.getMetrics());
    return () => this.subscribers.delete(subscriber);
  }

  public subscribeFeedStatus(subscriber: DerivHealthSubscriber): () => void {
    return this.subscribe(subscriber);
  }

  private notifySubscribers(): void {
    const metrics = this.getMetrics();
    for (const sub of this.subscribers) {
      try {
        sub(this.status, metrics);
      } catch (err) {
        console.warn('[DerivConnectionHealthEngine] Subscriber error:', err);
      }
    }
  }

  public dispose(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    this.subscribers.clear();
  }
}
