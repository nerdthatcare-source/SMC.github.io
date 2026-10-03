/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Deriv Catalog Engine
 *
 * Builds a filtered, browsable catalog from Deriv's real active_symbols and trading_times data.
 *
 * HARD CONSTRAINTS & SPECIFICATION:
 * 1. Exactly four real market categories present in Deriv:
 *    - forex: 25 confirmed symbols
 *    - commodities: 4 confirmed real symbols (metals)
 *    - indices: 10 major-market equivalents from the 12 real indices (plus optional 2 regional)
 *    - cryptocurrency: 2 confirmed real symbols
 * 2. Explicitly excludes market === "synthetic_index" entirely, including WLDEUR (forex_basket).
 * 3. Documented as named constants referencing real underlying_symbol values, not inline strings.
 * 4. Browse only: building this catalog does NOT create any subscription or trigger engine analysis.
 * 5. Integrates trading_times per catalog symbol so UI and safety engine know real market hours.
 */

import { DerivAdapter } from './derivAdapter';

// ============================================================================
// 1. NAMED CONSTANTS REFERENCING REAL UNDERLYING_SYMBOL VALUES
// ============================================================================

/**
 * 25 Confirmed Deriv Forex underlying_symbol values.
 */
export const DERIV_CATALOG_FOREX = [
  'frxAUDCAD',
  'frxAUDCHF',
  'frxAUDJPY',
  'frxAUDNZD',
  'frxAUDUSD',
  'frxEURAUD',
  'frxEURCAD',
  'frxEURCHF',
  'frxEURGBP',
  'frxEURJPY',
  'frxEURNZD',
  'frxEURUSD',
  'frxGBPAUD',
  'frxGBPCAD',
  'frxGBPCHF',
  'frxGBPJPY',
  'frxGBPNZD',
  'frxGBPUSD',
  'frxNZDJPY',
  'frxNZDUSD',
  'frxUSDCAD',
  'frxUSDCHF',
  'frxUSDJPY',
  'frxUSDMXN',
  'frxUSDPLN',
] as const;

export type DerivForexSymbol = (typeof DERIV_CATALOG_FOREX)[number];

/**
 * 4 Confirmed Deriv Commodities (Precious Metals) underlying_symbol values.
 */
export const DERIV_CATALOG_COMMODITIES = [
  'frxXAUUSD', // Gold/USD
  'frxXAGUSD', // Silver/USD
  'frxXPTUSD', // Platinum/USD
  'frxXPDUSD', // Palladium/USD
] as const;

export type DerivCommoditySymbol = (typeof DERIV_CATALOG_COMMODITIES)[number];

/**
 * Major-market equivalents selected from Deriv's 12 real indices symbols.
 * Real Deriv names used:
 * - OTC_DJI: Wall Street 30 (Dow Jones 30 equivalent)
 * - OTC_SPC: US 500 (S&P 500 equivalent)
 * - OTC_NDX: US Tech 100 (Nasdaq 100 equivalent)
 * - OTC_FTSE: UK 100 (FTSE 100 equivalent)
 * - OTC_GDAXI: Germany 40 (DAX 40 equivalent)
 * - OTC_FCHI: France 40 (CAC 40 equivalent)
 * - OTC_SX5E: Euro 50 (Euro Stoxx 50 equivalent)
 * - OTC_N225: Japan 225 (Nikkei 225 equivalent)
 * - OTC_AS51: Australia 200 (ASX 200 equivalent)
 * - OTC_HSI: Hong Kong 50 (Hang Seng equivalent)
 * - OTC_AEX: Netherlands 25
 * - OTC_SSMI: Swiss 20
 */
export const DERIV_CATALOG_INDICES = [
  'OTC_DJI',
  'OTC_SPC',
  'OTC_NDX',
  'OTC_FTSE',
  'OTC_GDAXI',
  'OTC_FCHI',
  'OTC_SX5E',
  'OTC_N225',
  'OTC_AS51',
  'OTC_HSI',
  'OTC_AEX',
  'OTC_SSMI',
] as const;

export type DerivIndexSymbol = (typeof DERIV_CATALOG_INDICES)[number];

/**
 * 2 Confirmed Deriv Cryptocurrency underlying_symbol values.
 */
export const DERIV_CATALOG_CRYPTOCURRENCY = [
  'cryBTCUSD', // BTC/USD
  'cryETHUSD', // ETH/USD
] as const;

export type DerivCryptoSymbol = (typeof DERIV_CATALOG_CRYPTOCURRENCY)[number];

/**
 * Explicit Exclusion constants:
 * All synthetic indices (including volatility, step, jump, crash/boom) and synthetic baskets.
 */
export const EXCLUDED_MARKET_CATEGORY = 'synthetic_index';
export const EXCLUDED_FOREX_BASKET_SYMBOL = 'WLDEUR';

export type CatalogMarketCategory =
  | 'forex'
  | 'commodities'
  | 'indices'
  | 'cryptocurrency';

// ============================================================================
// 2. TRADING TIMES & CATALOG INTERFACES
// ============================================================================

export interface CatalogTradingTimesInfo {
  readonly openTimes: readonly string[];
  readonly closeTimes: readonly string[];
  readonly settlementTime?: string;
  readonly tradingDays: readonly string[];
  readonly events: ReadonlyArray<{ dates: string; descrip: string }>;
}

export interface CatalogInstrumentItem {
  readonly underlyingSymbol: string;
  readonly displayName: string;
  readonly category: CatalogMarketCategory;
  readonly submarket: string;
  readonly pipSize: number;
  readonly exchangeIsOpen: boolean;
  readonly isTradingSuspended: boolean;
  readonly tradingTimes: CatalogTradingTimesInfo | null;
  readonly isMarketOpenNow: boolean;
  readonly statusDescription: string;
}

// ============================================================================
// 3. CATALOG & MARKET HOURS ENGINE
// ============================================================================

export class DerivCatalogEngine {
  private static cachedCatalog: readonly CatalogInstrumentItem[] | null = null;
  private static cachedTradingTimes: Map<string, CatalogTradingTimesInfo> = new Map();
  private static lastFetchTimestamp = 0;
  private static readonly CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

  /**
   * Set of all permitted underlying symbols across the 4 real categories.
   */
  public static readonly ALLOWED_SYMBOLS_SET: ReadonlySet<string> = new Set([
    ...DERIV_CATALOG_FOREX,
    ...DERIV_CATALOG_COMMODITIES,
    ...DERIV_CATALOG_INDICES,
    ...DERIV_CATALOG_CRYPTOCURRENCY,
  ]);

  /**
   * Fetches and builds the filtered browsable catalog.
   * Completely passive / browse-only: NO subscriptions and NO engine analysis.
   */
  public static async getCatalog(
    adapter: DerivAdapter,
    forceRefresh = false,
  ): Promise<readonly CatalogInstrumentItem[]> {
    const now = Date.now();
    if (!forceRefresh && this.cachedCatalog && now - this.lastFetchTimestamp < this.CACHE_TTL_MS) {
      return this.cachedCatalog;
    }

    // 1. Fetch raw active symbols list
    const rawSymbols = await adapter.getActiveSymbols('brief');

    // 2. Fetch trading times hierarchy
    await this.refreshTradingTimes(adapter);

    // 3. Filter strictly according to the 4 categories and exclusion rules
    const items: CatalogInstrumentItem[] = [];

    for (const sym of rawSymbols) {
      const underlying = sym.underlying_symbol || sym.symbol;

      // Explicitly reject synthetic_index and synthetic baskets like WLDEUR
      if (
        sym.market === EXCLUDED_MARKET_CATEGORY ||
        underlying === EXCLUDED_FOREX_BASKET_SYMBOL ||
        sym.subgroup === 'baskets' ||
        sym.submarket === 'forex_basket' ||
        sym.submarket === 'random_index'
      ) {
        continue;
      }

      // Must belong to one of the 4 allowed categories
      let category: CatalogMarketCategory | null = null;
      if (sym.market === 'forex') {
        category = 'forex';
      } else if (sym.market === 'commodities') {
        category = 'commodities';
      } else if (sym.market === 'indices') {
        category = 'indices';
      } else if (sym.market === 'cryptocurrency') {
        category = 'cryptocurrency';
      }

      if (!category) continue;

      // Must be an approved underlying symbol
      if (!this.ALLOWED_SYMBOLS_SET.has(underlying)) {
        continue;
      }

      const tradingInfo = this.cachedTradingTimes.get(underlying) || null;
      const marketState = this.evaluateMarketOpenState(
        sym.exchange_is_open === 1,
        sym.is_trading_suspended === 1,
        tradingInfo,
        now,
      );

      items.push({
        underlyingSymbol: underlying,
        displayName: sym.underlying_symbol_name || sym.display_name || underlying,
        category,
        submarket: sym.submarket,
        pipSize: sym.pip || 0.0001,
        exchangeIsOpen: sym.exchange_is_open === 1,
        isTradingSuspended: sym.is_trading_suspended === 1,
        tradingTimes: tradingInfo,
        isMarketOpenNow: marketState.isOpen,
        statusDescription: marketState.description,
      });
    }

    // Sort: Forex first, then Commodities, Indices, Crypto; alphabetically within category
    const categoryOrder: Record<CatalogMarketCategory, number> = {
      forex: 1,
      commodities: 2,
      indices: 3,
      cryptocurrency: 4,
    };

    items.sort((a, b) => {
      const catDiff = categoryOrder[a.category] - categoryOrder[b.category];
      if (catDiff !== 0) return catDiff;
      return a.displayName.localeCompare(b.displayName);
    });

    this.cachedCatalog = items;
    this.lastFetchTimestamp = now;
    return items;
  }

  /**
   * Refreshes the trading times map via Deriv trading_times call.
   */
  public static async refreshTradingTimes(adapter: DerivAdapter): Promise<void> {
    try {
      const res = await adapter.sendRequest<{
        trading_times?: {
          markets?: Array<{
            name: string;
            submarkets?: Array<{
              name: string;
              symbols?: Array<{
                underlying_symbol?: string;
                symbol?: string;
                name: string;
                times?: {
                  open?: string[];
                  close?: string[];
                  settlement?: string;
                };
                trading_days?: string[];
                events?: Array<{ dates: string; descrip: string }>;
              }>;
            }>;
          }>;
        };
      }>({
        trading_times: 'today',
      });

      if (res.trading_times?.markets) {
        this.cachedTradingTimes.clear();
        for (const m of res.trading_times.markets) {
          for (const sub of m.submarkets || []) {
            for (const s of sub.symbols || []) {
              const symKey = s.underlying_symbol || s.symbol;
              if (symKey) {
                this.cachedTradingTimes.set(symKey, {
                  openTimes: s.times?.open || ['00:00:00'],
                  closeTimes: s.times?.close || ['23:59:59'],
                  settlementTime: s.times?.settlement,
                  tradingDays: s.trading_days || ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
                  events: s.events || [],
                });
              }
            }
          }
        }
      }
    } catch (err) {
      console.warn('[DerivCatalogEngine] Error fetching trading_times:', err);
    }
  }

  /**
   * Checks whether an instrument's market is currently open for trading.
   */
  public static isMarketCurrentlyOpen(
    symbol: string,
    nowMs: number = Date.now(),
  ): { isOpen: boolean; reason: string } {
    const tradingInfo = this.cachedTradingTimes.get(symbol);
    if (!tradingInfo) {
      // Default fallback: Crypto is 24/7; Forex/Commodities closed on weekends
      const d = new Date(nowMs);
      const day = d.getUTCDay();
      const hour = d.getUTCHours();
      const isWeekend = day === 6 || (day === 0 && hour < 21) || (day === 5 && hour >= 22);
      if (symbol.startsWith('cry')) {
        return { isOpen: true, reason: 'Crypto market 24/7' };
      }
      return {
        isOpen: !isWeekend,
        reason: isWeekend ? 'Weekend market closure' : 'Standard session open',
      };
    }

    const state = this.evaluateMarketOpenState(true, false, tradingInfo, nowMs);
    return { isOpen: state.isOpen, reason: state.description };
  }

  /**
   * Evaluates trading schedule against UTC day and time.
   */
  private static evaluateMarketOpenState(
    exchangeIsOpen: boolean,
    isSuspended: boolean,
    tradingInfo: CatalogTradingTimesInfo | null,
    nowMs: number,
  ): { isOpen: boolean; description: string } {
    if (isSuspended) {
      return { isOpen: false, description: 'Trading Suspended by Exchange' };
    }

    if (!tradingInfo) {
      return {
        isOpen: exchangeIsOpen,
        description: exchangeIsOpen ? 'Market Open' : 'Market Closed',
      };
    }

    const date = new Date(nowMs);
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
    const currentDay = dayNames[date.getUTCDay()];

    // 1. Day of week check
    if (!tradingInfo.tradingDays.includes(currentDay)) {
      return {
        isOpen: false,
        description: `Closed (${currentDay} is non-trading day)`,
      };
    }

    // 2. Daily time window check
    const currentHours = date.getUTCHours();
    const currentMinutes = date.getUTCMinutes();
    const currentSeconds = date.getUTCSeconds();
    const currentSecOfDay = currentHours * 3600 + currentMinutes * 60 + currentSeconds;

    // Parse open and close times (array of intervals e.g. Metals: 00:00-21:00 and 22:00-23:59)
    let inSession = false;
    for (let i = 0; i < tradingInfo.openTimes.length; i++) {
      const openStr = tradingInfo.openTimes[i] || '00:00:00';
      const closeStr = tradingInfo.closeTimes[i] || '23:59:59';

      const openSec = this.timeStringToSeconds(openStr);
      const closeSec = this.timeStringToSeconds(closeStr);

      if (currentSecOfDay >= openSec && currentSecOfDay <= closeSec) {
        inSession = true;
        break;
      }
    }

    // 3. Early close events check
    if (tradingInfo.events && tradingInfo.events.length > 0) {
      for (const ev of tradingInfo.events) {
        if (ev.dates === 'Fridays' && currentDay === 'Fri') {
          // Check for e.g. "Closes early (at 20:55)"
          const match = ev.descrip.match(/at\s+(\d{1,2}):(\d{2})/);
          if (match && match[1] && match[2]) {
            const earlyCloseSec = parseInt(match[1], 10) * 3600 + parseInt(match[2], 10) * 60;
            if (currentSecOfDay >= earlyCloseSec) {
              return {
                isOpen: false,
                description: `Closed Early (${ev.descrip})`,
              };
            }
          }
        }
      }
    }

    if (!inSession) {
      return {
        isOpen: false,
        description: 'Session Closed (Daily Maintenance / Break)',
      };
    }

    return {
      isOpen: true,
      description: 'Market Open (Trading Active)',
    };
  }

  private static timeStringToSeconds(timeStr: string): number {
    const parts = timeStr.split(':').map((p) => parseInt(p, 10) || 0);
    const h = parts[0] || 0;
    const m = parts[1] || 0;
    const s = parts[2] || 0;
    return h * 3600 + m * 60 + s;
  }
}
