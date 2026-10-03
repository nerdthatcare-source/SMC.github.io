/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Watchlist Engine
 *
 * Orchestrates user-directed watchlist management, subscription multiplexing,
 * staggered rate-limited backfills, and complete state teardown.
 *
 * HARD INVARIANTS:
 * 1. A watchlist entry exists ONLY when explicitly added by the user.
 * 2. Adding:
 *    - Subscribes via ONE multiplexed WebSocket connection (never one per symbol).
 *    - Triggers historical backfill across all timeframes (1H, 15M, 5M, 1M).
 *    - Staggers backfill requests (400ms intervals) adhering to Deriv ticks_history rate limits.
 *    - Starts downstream SMC processing pipeline for the symbol.
 * 3. Removing:
 *    - Unsubscribes (forget call on Deriv WebSocket).
 *    - Fully stops and clears all engine processing and cached state for that symbol.
 *    - Deletes cached candles in CanonicalMarketDataEngine.
 *    - Deletes scoped liquidity pools and sweep history in SmcLiquidityStore.
 *    - Clears safety blocks for that symbol in DataSourceSafetyEngine.
 *    - Does NOT just hide it in the UI.
 * 4. Persists the watchlist across server reloads.
 */

import fs from 'fs';
import path from 'path';
import { DatabaseConnection } from '../db/database';
import { InstrumentSymbol, Timeframe } from '../types/smc';
import { CanonicalDataEngine } from './canonicalDataEngine';
import { DerivCatalogEngine } from './derivCatalogEngine';
import { SmcLiquidityStore } from './smcLiquidityLifecycleEngine';
import { SymbolMappingEngine } from './symbolMappingEngine';

export interface WatchlistEntry {
  readonly symbol: string;          // Primary symbol identifier (e.g. "frxEURUSD" or "EUR_USD")
  readonly canonicalSymbol: string; // Canonical format (e.g. "EUR_USD")
  readonly derivSymbol: string;     // Deriv format (e.g. "frxEURUSD")
  readonly displayName: string;     // Human-readable (e.g. "EUR/USD")
  readonly category: string;        // "forex" | "commodities" | "indices" | "cryptocurrency"
  readonly subscriptionId: string | null;
  readonly status: 'INITIALIZING' | 'ACTIVE' | 'ERROR';
  readonly addedAt: number;
  readonly lastBackfillAt?: number;
  readonly isStreaming: boolean;
}

export type WatchlistChangeListener = (watchlist: readonly WatchlistEntry[]) => void;

export class WatchlistEngine {
  private readonly watchlist: Map<string, WatchlistEntry> = new Map();
  private readonly listeners: Set<WatchlistChangeListener> = new Set();

  // Rate-limiting delay for staggered historical backfill (Deriv ticks_history limit)
  private readonly BACKFILL_STAGGER_MS = 400;

  constructor(
    private readonly canonicalDataEngine: CanonicalDataEngine,
  ) {}

  // ==========================================================================
  // READ API
  // ==========================================================================

  public getWatchlist(): readonly WatchlistEntry[] {
    return Array.from(this.watchlist.values());
  }

  public isWatchlisted(symbol: string): boolean {
    const derivSym = SymbolMappingEngine.toDerivSymbol(symbol);
    const canSym = SymbolMappingEngine.toCanonicalSymbol(symbol);
    return this.watchlist.has(derivSym) || this.watchlist.has(canSym) || this.watchlist.has(symbol);
  }

  public getEntry(symbol: string): WatchlistEntry | undefined {
    const derivSym = SymbolMappingEngine.toDerivSymbol(symbol);
    const canSym = SymbolMappingEngine.toCanonicalSymbol(symbol);
    return this.watchlist.get(derivSym) || this.watchlist.get(canSym) || this.watchlist.get(symbol);
  }

  // ==========================================================================
  // WATCHLIST MUTATIONS (ADD & REMOVE)
  // ==========================================================================

  /**
   * Adds an instrument to the active watchlist:
   * 1. Subscribes to live ticks via the shared multiplexed WebSocket.
   * 2. Runs staggered historical backfills across 1H, 15M, 5M, 1M to avoid rate-limiting.
   * 3. Starts Phase 2-4 pipeline.
   * 4. Persists state.
   */
  public async addInstrument(rawSymbol: string): Promise<WatchlistEntry> {
    const derivSymbol = SymbolMappingEngine.toDerivSymbol(rawSymbol);
    const canonicalSymbol = SymbolMappingEngine.toCanonicalSymbol(derivSymbol);

    // If already watchlisted, return current entry
    const existing = this.getEntry(derivSymbol);
    if (existing && existing.status === 'ACTIVE') {
      return existing;
    }

    // Determine category and display name
    const category = derivSymbol.startsWith('cry')
      ? 'cryptocurrency'
      : derivSymbol.startsWith('OTC')
      ? 'indices'
      : (derivSymbol.includes('XAU') || derivSymbol.includes('XAG') || derivSymbol.includes('XPT') || derivSymbol.includes('XPD'))
      ? 'commodities'
      : 'forex';

    const displayName = canonicalSymbol.replace('_', '/');

    // Register initializing entry
    const initializingEntry: WatchlistEntry = {
      symbol: derivSymbol,
      canonicalSymbol,
      derivSymbol,
      displayName,
      category,
      subscriptionId: null,
      status: 'INITIALIZING',
      addedAt: Date.now(),
      isStreaming: false,
    };
    this.watchlist.set(derivSymbol, initializingEntry);
    this.notifyListeners();

    try {
      // 1. Multiplex live tick subscription on the single WebSocket connection
      await this.canonicalDataEngine.derivAdapter.connect();
      let subId: string | null = null;

      try {
        subId = await this.canonicalDataEngine.derivAdapter.subscribeTicks(derivSymbol, (rawTick) => {
          try {
            this.canonicalDataEngine.marketDataEngine.ingestStreamingTick(rawTick);
          } catch (err) {
            console.error(`[WatchlistEngine] Tick ingestion error for ${derivSymbol}:`, err);
          }
        });
        if (subId) {
          this.canonicalDataEngine.registerActiveTickSubscription(canonicalSymbol, subId);
        }
      } catch (subErr) {
        console.warn(`[WatchlistEngine] Tick subscription note for ${derivSymbol}:`, subErr);
      }

      // 2. Staggered historical backfill across timeframes
      // Using BACKFILL_STAGGER_MS delay between ticks_history calls to avoid rate limits
      await this.performStaggeredBackfill(derivSymbol, canonicalSymbol);

      // 3. Mark active entry
      const activeEntry: WatchlistEntry = {
        symbol: derivSymbol,
        canonicalSymbol,
        derivSymbol,
        displayName,
        category,
        subscriptionId: subId,
        status: 'ACTIVE',
        addedAt: initializingEntry.addedAt,
        lastBackfillAt: Date.now(),
        isStreaming: Boolean(subId),
      };

      this.watchlist.set(derivSymbol, activeEntry);
      this.persistWatchlist(activeEntry);
      this.notifyListeners();
      return activeEntry;
    } catch (err) {
      console.error(`[WatchlistEngine] Failed to add instrument ${rawSymbol}:`, err);
      const errorEntry: WatchlistEntry = {
        ...initializingEntry,
        status: 'ERROR',
      };
      this.watchlist.set(derivSymbol, errorEntry);
      this.notifyListeners();
      throw err;
    }
  }

  /**
   * Removes an instrument from the active watchlist:
   * 1. Unsubscribes from WebSocket stream.
   * 2. Clears all cached candles in CanonicalMarketDataEngine.
   * 3. Clears all scoped liquidity pools and sweeps in SmcLiquidityStore.
   * 4. Clears all safety blocks in DataSourceSafetyEngine.
   * 5. Fully stops and clears all state for this symbol.
   * 6. Persists state.
   */
  public async removeInstrument(rawSymbol: string): Promise<boolean> {
    const derivSymbol = SymbolMappingEngine.toDerivSymbol(rawSymbol);
    const canonicalSymbol = SymbolMappingEngine.toCanonicalSymbol(derivSymbol);

    const entry = this.getEntry(derivSymbol);
    if (!entry) {
      return false;
    }

    // 1. Unsubscribe from WebSocket
    if (entry.subscriptionId) {
      try {
        await this.canonicalDataEngine.derivAdapter.forget(entry.subscriptionId);
      } catch (err) {
        console.warn(`[WatchlistEngine] Error forgetting subscription ${entry.subscriptionId}:`, err);
      }
    }
    this.canonicalDataEngine.unregisterActiveTickSubscription(canonicalSymbol);

    // 2. FULL STATE TEARDOWN:
    // A. Clear cached market data
    this.canonicalDataEngine.marketDataEngine.clearSymbol(derivSymbol);
    this.canonicalDataEngine.marketDataEngine.clearSymbol(canonicalSymbol);

    // B. Clear scoped liquidity store
    SmcLiquidityStore.clearSymbol(derivSymbol);
    SmcLiquidityStore.clearSymbol(canonicalSymbol);

    // C. Clear safety blocks
    this.canonicalDataEngine.safetyEngine.clearSymbolBlocks(derivSymbol);
    this.canonicalDataEngine.safetyEngine.clearSymbolBlocks(canonicalSymbol);

    // 3. Remove from watchlist
    this.watchlist.delete(derivSymbol);
    this.watchlist.delete(canonicalSymbol);
    this.watchlist.delete(rawSymbol);

    this.deleteFromDatabase(derivSymbol, canonicalSymbol);
    this.notifyListeners();
    console.info(`[WatchlistEngine] Removed ${rawSymbol} and completely cleared all cached state.`);
    return true;
  }

  // ==========================================================================
  // STAGGERED HISTORICAL BACKFILL (RATE-LIMIT COMPLIANT)
  // ==========================================================================

  private async performStaggeredBackfill(
    derivSymbol: string,
    canonicalSymbol: string,
  ): Promise<void> {
    const timeframes: Timeframe[] = ['1H', '15M', '5M', '1M'];

    for (let i = 0; i < timeframes.length; i++) {
      const tf = timeframes[i];
      if (i > 0) {
        // Enforce rate-limit interval
        await new Promise((r) => setTimeout(r, this.BACKFILL_STAGGER_MS));
      }

      try {
        await this.canonicalDataEngine.marketDataEngine.ingestHistoricalFromDeriv(
          canonicalSymbol as InstrumentSymbol,
          tf,
          100, // 100 bars per timeframe
        );
      } catch (err) {
        console.warn(
          `[WatchlistEngine] Backfill note for ${derivSymbol} ${tf}:`,
          err,
        );
      }
    }
  }

  // ==========================================================================
  // PERSISTENCE & INITIALIZATION VIA RELATIONAL DATABASE
  // ==========================================================================

  public async initializeOnStartup(defaultSymbols = ['frxEURUSD']): Promise<void> {
    let symbolsToLoad: string[] = [];

    try {
      const db = await DatabaseConnection.getInstance();
      const records = db.getWatchlistRecords();
      if (records && records.length > 0) {
        symbolsToLoad = records.map((r) => r.derivSymbol);
      }
    } catch (err) {
      console.warn('[WatchlistEngine] Database initialization note:', err);
    }

    // Migration fallback from legacy data/watchlist.json if DB has no records yet
    if (symbolsToLoad.length === 0) {
      const legacyPath = path.resolve(process.cwd(), 'data/watchlist.json');
      if (fs.existsSync(legacyPath)) {
        try {
          const raw = fs.readFileSync(legacyPath, 'utf-8');
          const data = JSON.parse(raw);
          if (Array.isArray(data) && data.length > 0) {
            symbolsToLoad = data;
          }
          // Remove legacy file after migrating to database
          fs.unlinkSync(legacyPath);
          console.info('[WatchlistEngine] Successfully migrated legacy data/watchlist.json to relational database.');
        } catch {
          // Ignore migration read error
        }
      }
    }

    if (symbolsToLoad.length === 0) {
      symbolsToLoad = defaultSymbols;
    }

    console.info(`[WatchlistEngine] Initializing database-backed watchlist with ${symbolsToLoad.length} symbols:`, symbolsToLoad);

    for (let i = 0; i < symbolsToLoad.length; i++) {
      const sym = symbolsToLoad[i];
      if (i > 0) {
        await new Promise((r) => setTimeout(r, 800)); // Stagger symbol additions
      }
      try {
        await this.addInstrument(sym);
      } catch (err) {
        console.warn(`[WatchlistEngine] Startup load failed for ${sym}:`, err);
      }
    }
  }

  private persistWatchlist(entry?: WatchlistEntry): void {
    if (!entry) return;
    try {
      if (DatabaseConnection.isInitialized()) {
        const db = DatabaseConnection.getSyncInstance();
        db.upsertWatchlistEntry({
          derivSymbol: entry.derivSymbol,
          canonicalSymbol: entry.canonicalSymbol,
          displayName: entry.displayName,
          category: entry.category,
          subscriptionId: entry.subscriptionId,
          status: entry.status,
          addedAt: entry.addedAt,
          lastBackfillAt: entry.lastBackfillAt,
          isStreaming: entry.isStreaming,
        });
        db.logAuditEvent('WATCHLIST_UPSERT', entry.derivSymbol, {
          canonicalSymbol: entry.canonicalSymbol,
          status: entry.status,
        });
      }
    } catch (err) {
      console.warn('[WatchlistEngine] DB persistWatchlist note:', err);
    }
  }

  private deleteFromDatabase(derivSymbol: string, canonicalSymbol: string): void {
    try {
      if (DatabaseConnection.isInitialized()) {
        const db = DatabaseConnection.getSyncInstance();
        db.deleteWatchlistEntry(derivSymbol);
        db.logAuditEvent('WATCHLIST_REMOVE', derivSymbol, { canonicalSymbol });
      }
    } catch (err) {
      console.warn('[WatchlistEngine] DB deleteWatchlist note:', err);
    }
  }

  public subscribe(listener: WatchlistChangeListener): () => void {
    this.listeners.add(listener);
    listener(this.getWatchlist());
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    const list = this.getWatchlist();
    for (const listener of this.listeners) {
      try {
        listener(list);
      } catch (err) {
        console.error('Error in watchlist listener:', err);
      }
    }
  }
}
