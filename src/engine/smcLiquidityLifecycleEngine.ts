/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SMC Liquidity Lifecycle Engine & Canonical Store
 *
 * Tracks the state machine lifecycle of institutional liquidity pools:
 * UNTOUCHED -> APPROACHING -> SWEPT -> REVERSED
 *
 * HARD SMC DEFINITIONS:
 * - UNTOUCHED: Price has remained outside the approach threshold since pool formation.
 * - APPROACHING: Price has advanced into the proximity threshold (e.g. 0.25 * ATR),
 *   activating institutional magnet attraction.
 * - SWEPT: Candle wick or body has pierced beyond the liquidity level price.
 * - REVERSED: Institutional Turtle Soup or Wick Rejection confirmed. The market engineered
 *   liquidity extraction, failed to sustain momentum beyond the pool, and closed back inside.
 *
 * PERSISTENT LIQUIDITY STORE:
 * - Stores all active and historical liquidity pools.
 * - Records and indexes every LiquiditySweepEvent for downstream engines (confluence scoring,
 *   edge memory, causal attribution).
 *
 * Pure calculation logic with immutable state transitions.
 */

import {
  Candle,
  InstrumentSymbol,
  LiquidityLevelType,
  LiquiditySweepEvent,
  LiquiditySweepStatus,
  StructuralTimeframe,
} from '../types/smc';
import { assertStructuralTimeframe } from './canonicalDataContracts';
import { SmcLiquidityEngine, SmcLiquidityPool } from './smcLiquidityEngine';

export type LiquidityPoolLifecycleState =
  | 'UNTOUCHED'
  | 'APPROACHING'
  | 'SWEPT'
  | 'REVERSED';

export interface PoolLifecycleSnapshot {
  readonly pool: SmcLiquidityPool;
  readonly state: LiquidityPoolLifecycleState;
  readonly lastEvaluatedTimestamp: number;
  readonly distanceToCurrentPrice: number;
  readonly distanceToCurrentPricePips: number;
  readonly sweepEvent: LiquiditySweepEvent | null;
  readonly reversalConfirmed: boolean;
  readonly reversalCandleTimestamp?: number;
}

export interface LifecycleEvaluationResult {
  readonly symbol: InstrumentSymbol;
  readonly timeframe: StructuralTimeframe;
  readonly evaluatedAt: number;
  readonly activePoolsCount: number;
  readonly untouchedCount: number;
  readonly approachingCount: number;
  readonly sweptCount: number;
  readonly reversedCount: number;
  readonly poolSnapshots: readonly PoolLifecycleSnapshot[];
  readonly newSweepEvents: readonly LiquiditySweepEvent[];
}

export class SmcLiquidityLifecycleEngine {
  /**
   * Evaluates the lifecycle state of a list of liquidity pools across a series of candles.
   * Pure calculation: no side effects, returns a comprehensive snapshot report.
   */
  public static evaluatePools(
    pools: readonly SmcLiquidityPool[],
    candles: readonly Candle[],
    timeframe: StructuralTimeframe,
  ): LifecycleEvaluationResult {
    assertStructuralTimeframe(timeframe);

    if (pools.length === 0 || candles.length === 0) {
      return {
        symbol: pools[0]?.symbol ?? (candles[0]?.symbol || 'EUR_USD'),
        timeframe,
        evaluatedAt: Date.now(),
        activePoolsCount: 0,
        untouchedCount: 0,
        approachingCount: 0,
        sweptCount: 0,
        reversedCount: 0,
        poolSnapshots: [],
        newSweepEvents: [],
      };
    }

    const symbol = pools[0].symbol;
    const latestCandle = candles[candles.length - 1];
    const evaluatedAt = latestCandle.timestamp;
    const currentPrice = latestCandle.close;

    const poolSnapshots: PoolLifecycleSnapshot[] = [];
    const allSweepEvents: LiquiditySweepEvent[] = [];

    // Calculate ATR for dynamic approach buffer (0.25 * ATR)
    const atr = SmcLiquidityEngine.calculateAtr(candles, symbol);
    const approachBuffer = atr * 0.25;

    for (const pool of pools) {
      // Filter candles occurring AT or AFTER the pool's origin timestamp
      const subsequentCandles = candles.filter((c) => c.timestamp >= pool.originTimestamp);

      let currentState: LiquidityPoolLifecycleState = 'UNTOUCHED';
      let sweepEvent: LiquiditySweepEvent | null = null;
      let reversalConfirmed = false;
      let reversalCandleTimestamp: number | undefined;

      for (let i = 0; i < subsequentCandles.length; i++) {
        const c = subsequentCandles[i];
        const range = Math.max(0.00001, c.high - c.low);

        if (pool.side === 'BUY_SIDE') {
          // Buy-Side Liquidity (resting stops above pool.price)
          const distanceToHigh = pool.price - c.high;

          if (c.high >= pool.price) {
            // Price pierced Buy-Side level -> SWEPT!
            const upperWick = c.high - Math.max(c.open, c.close);
            const wickRatio = upperWick / range;

            // Determine sweep status
            let status: LiquiditySweepStatus = 'CONTINUATION_BREAK';
            if (c.close < pool.price) {
              // Body closed back below level: Confirmed Turtle Soup
              status = 'CONFIRMED_TURTLE_SOUP';
            } else if (wickRatio >= 0.5) {
              status = 'WICK_REJECTION';
            }

            if (!sweepEvent) {
              sweepEvent = {
                id: `SWEEP_${pool.id}_${c.timestamp}`,
                symbol,
                timeframe,
                liquidityLevelId: pool.id,
                levelType: pool.canonicalLevelModel.type,
                sweepHighPrice: c.high,
                sweepLowPrice: c.low,
                rejectionClosePrice: c.close,
                rejectionWickRatio: Math.round(wickRatio * 100) / 100,
                timestamp: c.timestamp,
                status,
              };
            }

            // Check for reversal: candle body closed below level, or next candle is bearish
            if (status === 'CONFIRMED_TURTLE_SOUP' || status === 'WICK_REJECTION') {
              currentState = 'REVERSED';
              reversalConfirmed = true;
              reversalCandleTimestamp = c.timestamp;
            } else {
              // Check if subsequent candle closed lower than previous close
              if (i + 1 < subsequentCandles.length) {
                const next = subsequentCandles[i + 1];
                if (next.close < c.open) {
                  currentState = 'REVERSED';
                  reversalConfirmed = true;
                  reversalCandleTimestamp = next.timestamp;
                } else {
                  currentState = 'SWEPT';
                }
              } else {
                currentState = 'SWEPT';
              }
            }
          } else if (distanceToHigh <= approachBuffer && currentState === 'UNTOUCHED') {
            currentState = 'APPROACHING';
          }
        } else {
          // Sell-Side Liquidity (resting stops below pool.price)
          const distanceToLow = c.low - pool.price;

          if (c.low <= pool.price) {
            // Price pierced Sell-Side level -> SWEPT!
            const lowerWick = Math.min(c.open, c.close) - c.low;
            const wickRatio = lowerWick / range;

            // Determine sweep status
            let status: LiquiditySweepStatus = 'CONTINUATION_BREAK';
            if (c.close > pool.price) {
              // Body closed back above level: Confirmed Turtle Soup
              status = 'CONFIRMED_TURTLE_SOUP';
            } else if (wickRatio >= 0.5) {
              status = 'WICK_REJECTION';
            }

            if (!sweepEvent) {
              sweepEvent = {
                id: `SWEEP_${pool.id}_${c.timestamp}`,
                symbol,
                timeframe,
                liquidityLevelId: pool.id,
                levelType: pool.canonicalLevelModel.type,
                sweepHighPrice: c.high,
                sweepLowPrice: c.low,
                rejectionClosePrice: c.close,
                rejectionWickRatio: Math.round(wickRatio * 100) / 100,
                timestamp: c.timestamp,
                status,
              };
            }

            // Check for reversal
            if (status === 'CONFIRMED_TURTLE_SOUP' || status === 'WICK_REJECTION') {
              currentState = 'REVERSED';
              reversalConfirmed = true;
              reversalCandleTimestamp = c.timestamp;
            } else {
              if (i + 1 < subsequentCandles.length) {
                const next = subsequentCandles[i + 1];
                if (next.close > c.open) {
                  currentState = 'REVERSED';
                  reversalConfirmed = true;
                  reversalCandleTimestamp = next.timestamp;
                } else {
                  currentState = 'SWEPT';
                }
              } else {
                currentState = 'SWEPT';
              }
            }
          } else if (distanceToLow <= approachBuffer && currentState === 'UNTOUCHED') {
            currentState = 'APPROACHING';
          }
        }
      }

      if (sweepEvent) {
        allSweepEvents.push(sweepEvent);
      }

      const distanceToCurrent = Math.abs(currentPrice - pool.price);
      // Rough pips approximation based on 0.0001 (or 0.01 for JPY)
      const pipMultiplier = symbol.includes('JPY') ? 100 : 10000;
      const distancePips = Math.round(distanceToCurrent * pipMultiplier * 10) / 10;

      poolSnapshots.push({
        pool,
        state: currentState,
        lastEvaluatedTimestamp: evaluatedAt,
        distanceToCurrentPrice: distanceToCurrent,
        distanceToCurrentPricePips: distancePips,
        sweepEvent,
        reversalConfirmed,
        reversalCandleTimestamp,
      });
    }

    return {
      symbol,
      timeframe,
      evaluatedAt,
      activePoolsCount: pools.length,
      untouchedCount: poolSnapshots.filter((s) => s.state === 'UNTOUCHED').length,
      approachingCount: poolSnapshots.filter((s) => s.state === 'APPROACHING').length,
      sweptCount: poolSnapshots.filter((s) => s.state === 'SWEPT').length,
      reversedCount: poolSnapshots.filter((s) => s.state === 'REVERSED').length,
      poolSnapshots,
      newSweepEvents: allSweepEvents,
    };
  }
}

/**
 * Canonical Liquidity Store
 *
 * Persistent, queryable registry of liquidity pools and sweep events across timeframes.
 * Scoped per symbol + timeframe + run-context to prevent cross-instrument / cross-run contamination.
 */
export class SmcLiquidityStore {
  private static instance: SmcLiquidityStore | null = null;
  private static readonly scopedInstances: Map<string, SmcLiquidityStore> = new Map();

  private readonly poolsById: Map<string, SmcLiquidityPool> = new Map();
  private readonly sweepEventsById: Map<string, LiquiditySweepEvent> = new Map();
  private readonly poolSnapshotsById: Map<string, PoolLifecycleSnapshot> = new Map();

  constructor(
    public readonly scopeSymbol?: InstrumentSymbol,
    public readonly scopeTimeframe?: StructuralTimeframe,
    public readonly runContext: string = 'default',
  ) {}

  public static getInstance(): SmcLiquidityStore {
    if (!this.instance) {
      this.instance = new SmcLiquidityStore();
    }
    return this.instance;
  }

  /**
   * Retrieves or creates a store scoped strictly to a specific symbol, timeframe, and run context.
   * Guarantees isolation across concurrent backtest / live / analysis runs.
   */
  public static getScopedInstance(
    symbol: InstrumentSymbol,
    timeframe: StructuralTimeframe,
    runContext: string = 'default',
  ): SmcLiquidityStore {
    const key = `${symbol}:${timeframe}:${runContext}`;
    let scoped = this.scopedInstances.get(key);
    if (!scoped) {
      scoped = new SmcLiquidityStore(symbol, timeframe, runContext);
      this.scopedInstances.set(key, scoped);
    }
    return scoped;
  }

  /**
   * Clears a specific scoped store.
   */
  public static clearScoped(
    symbol: InstrumentSymbol,
    timeframe: StructuralTimeframe,
    runContext: string = 'default',
  ): void {
    const key = `${symbol}:${timeframe}:${runContext}`;
    const scoped = this.scopedInstances.get(key);
    if (scoped) {
      scoped.clear();
      this.scopedInstances.delete(key);
    }
  }

  /**
   * Clears all scoped instances and singleton instance.
   */
  public static clearAll(): void {
    this.instance?.clear();
    this.scopedInstances.forEach((store) => store.clear());
    this.scopedInstances.clear();
  }

  /**
   * Ingests and persists pool lifecycle evaluations.
   */
  public ingestEvaluation(evaluation: LifecycleEvaluationResult): void {
    for (const snapshot of evaluation.poolSnapshots) {
      this.poolsById.set(snapshot.pool.id, snapshot.pool);
      this.poolSnapshotsById.set(snapshot.pool.id, snapshot);
      if (snapshot.sweepEvent) {
        this.sweepEventsById.set(snapshot.sweepEvent.id, snapshot.sweepEvent);
      }
    }
  }

  /**
   * Retrieves a pool by its canonical ID.
   */
  public getPool(id: string): SmcLiquidityPool | undefined {
    return this.poolsById.get(id);
  }

  /**
   * Retrieves a pool snapshot by its ID.
   */
  public getSnapshot(id: string): PoolLifecycleSnapshot | undefined {
    return this.poolSnapshotsById.get(id);
  }

  /**
   * Retrieves all sweep events for a specific instrument and optional timeframe.
   */
  public getSweepEvents(
    symbol?: InstrumentSymbol,
    timeframe?: StructuralTimeframe,
  ): readonly LiquiditySweepEvent[] {
    let events = Array.from(this.sweepEventsById.values());
    if (symbol) {
      events = events.filter((e) => e.symbol === symbol);
    }
    if (timeframe) {
      events = events.filter((e) => e.timeframe === timeframe);
    }
    return events.sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Retrieves the most recent sweep event for a given instrument.
   */
  public getLatestSweep(symbol: InstrumentSymbol): LiquiditySweepEvent | null {
    const sweeps = this.getSweepEvents(symbol);
    return sweeps.length > 0 ? sweeps[0] : null;
  }

  /**
   * Retrieves all active untouched or approaching pools for an instrument.
   */
  public getActiveIntactPools(symbol: InstrumentSymbol): readonly SmcLiquidityPool[] {
    return Array.from(this.poolSnapshotsById.values())
      .filter((s) => s.pool.symbol === symbol && (s.state === 'UNTOUCHED' || s.state === 'APPROACHING'))
      .map((s) => s.pool);
  }

  /**
   * Clears the store (used for unit testing or backtest reset).
   */
  public clear(): void {
    this.poolsById.clear();
    this.sweepEventsById.clear();
    this.poolSnapshotsById.clear();
  }
}
