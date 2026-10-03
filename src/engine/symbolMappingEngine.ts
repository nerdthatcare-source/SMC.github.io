/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Symbol Mapping Engine
 *
 * Normalizes instrument identifiers across external platforms, broker conventions,
 * and canonical DERIV formats (frx-prefixed for forex/metals) for all approved catalog instruments.
 *
 * Implements active_symbols verification against Deriv's live catalog.
 */

import { DerivActiveSymbol, InstrumentSymbol } from '../types/smc';
import {
  APPROVED_INSTRUMENTS_LIST,
  APPROVED_INSTRUMENTS_REGISTRY,
} from './instrumentMarketConfiguration';

export type ExternalBrokerPlatform =
  | 'DERIV'
  | 'TRADING_VIEW'
  | 'INTERACTIVE_BROKERS'
  | 'METATRADER'
  | 'ISO_CLEAN'
  | 'STANDARD_DISPLAY';

export interface VerifiedDerivInstrument {
  readonly canonicalSymbol: InstrumentSymbol;
  readonly derivSymbol: string;
  readonly displayName: string;
  readonly market: string;
  readonly pip: number;
  readonly isTradingSuspended: boolean;
}

export interface UnofferedDerivInstrument {
  readonly canonicalSymbol: InstrumentSymbol;
  readonly expectedDerivSymbol: string;
  readonly reason: string;
}

export interface SymbolVerificationReport {
  readonly totalApproved: number;
  readonly offeredCount: number;
  readonly unofferedCount: number;
  readonly offered: readonly VerifiedDerivInstrument[];
  readonly unoffered: readonly UnofferedDerivInstrument[];
  readonly verifiedAt: number;
}

export class SymbolMappingEngine {
  /**
   * Authoritative canonical -> Deriv symbol lookup mapping.
   * Deriv standard convention: 'frx' prefix for forex and precious metals.
   */
  public static readonly CANONICAL_TO_DERIV_MAP: Readonly<Record<InstrumentSymbol, string>> = {
    // 7 Forex Majors
    EUR_USD: 'frxEURUSD',
    GBP_USD: 'frxGBPUSD',
    USD_JPY: 'frxUSDJPY',
    USD_CHF: 'frxUSDCHF',
    AUD_USD: 'frxAUDUSD',
    USD_CAD: 'frxUSDCAD',
    NZD_USD: 'frxNZDUSD',
    // 18 Forex Minors & Crosses
    EUR_GBP: 'frxEURGBP',
    EUR_JPY: 'frxEURJPY',
    GBP_JPY: 'frxGBPJPY',
    AUD_JPY: 'frxAUDJPY',
    EUR_AUD: 'frxEURAUD',
    GBP_AUD: 'frxGBPAUD',
    EUR_CAD: 'frxEURCAD',
    GBP_CAD: 'frxGBPCAD',
    NZD_JPY: 'frxNZDJPY',
    AUD_CAD: 'frxAUDCAD',
    AUD_CHF: 'frxAUDCHF',
    AUD_NZD: 'frxAUDNZD',
    EUR_CHF: 'frxEURCHF',
    EUR_NZD: 'frxEURNZD',
    GBP_CHF: 'frxGBPCHF',
    GBP_NZD: 'frxGBPNZD',
    USD_MXN: 'frxUSDMXN',
    USD_PLN: 'frxUSDPLN',
    // 4 Precious Metals (Commodities)
    XAU_USD: 'frxXAUUSD',
    XAG_USD: 'frxXAGUSD',
    XPT_USD: 'frxXPTUSD',
    XPD_USD: 'frxXPDUSD',
    // 12 Real Deriv Equity Indices
    OTC_DJI: 'OTC_DJI',
    OTC_SPC: 'OTC_SPC',
    OTC_NDX: 'OTC_NDX',
    OTC_FTSE: 'OTC_FTSE',
    OTC_GDAXI: 'OTC_GDAXI',
    OTC_FCHI: 'OTC_FCHI',
    OTC_SX5E: 'OTC_SX5E',
    OTC_N225: 'OTC_N225',
    OTC_AS51: 'OTC_AS51',
    OTC_HSI: 'OTC_HSI',
    OTC_AEX: 'OTC_AEX',
    OTC_SSMI: 'OTC_SSMI',
    // 2 Cryptocurrencies
    BTC_USD: 'cryBTCUSD',
    ETH_USD: 'cryETHUSD',
  };

  // Fast reverse lookup map: any standardized input -> Canonical InstrumentSymbol
  private static readonly aliasToCanonicalMap: ReadonlyMap<string, InstrumentSymbol> = (() => {
    const map = new Map<string, InstrumentSymbol>();

    for (const config of APPROVED_INSTRUMENTS_LIST) {
      const canonical = config.symbol;
      const clean = config.brokerSymbolMapping.cleanTicker.toUpperCase();
      const display = config.brokerSymbolMapping.displaySymbol.toUpperCase();
      const tv = config.brokerSymbolMapping.tradingViewSymbol.toUpperCase();
      const deriv = (SymbolMappingEngine.CANONICAL_TO_DERIV_MAP[canonical] || `frx${clean}`).toUpperCase();

      // Variations
      map.set(canonical.toUpperCase(), canonical);
      map.set(clean, canonical);
      map.set(display, canonical);
      map.set(deriv, canonical);
      map.set(tv, canonical);

      // Slash vs underscore vs dot notation
      const slash = `${config.baseCurrency}/${config.quoteCurrency}`.toUpperCase();
      const dot = `${config.baseCurrency}.${config.quoteCurrency}`.toUpperCase();
      const underscore = `${config.baseCurrency}_${config.quoteCurrency}`.toUpperCase();

      map.set(slash, canonical);
      map.set(dot, canonical);
      map.set(underscore, canonical);

      // MetaTrader suffixes (e.g. EURUSD.pro, EURUSD_i)
      map.set(`${clean}.PRO`, canonical);
      map.set(`${clean}_RAW`, canonical);
      map.set(`${clean}_I`, canonical);
    }

    return map;
  })();

  /**
   * Translates a canonical InstrumentSymbol into Deriv's frx-prefixed (or OTC index) name.
   */
  public static toDerivSymbol(symbol: InstrumentSymbol | string): string {
    const derivSymbol = this.CANONICAL_TO_DERIV_MAP[symbol as InstrumentSymbol];
    if (derivSymbol) {
      return derivSymbol;
    }
    // If it's already in Deriv format (e.g. frxEURUSD, cryBTCUSD, OTC_DJI)
    if (
      symbol.startsWith('frx') ||
      symbol.startsWith('cry') ||
      symbol.startsWith('OTC_')
    ) {
      return symbol;
    }
    if (symbol === 'BTC_USD') return 'cryBTCUSD';
    if (symbol === 'ETH_USD') return 'cryETHUSD';
    if (symbol === 'XPD_USD') return 'frxXPDUSD';
    const clean = symbol.replace('_', '');
    return `frx${clean}`;
  }

  /**
   * Resolves any broker symbol string into the strict canonical InstrumentSymbol.
   */
  public static toCanonicalSymbol(rawSymbol: string): InstrumentSymbol {
    if (!rawSymbol || typeof rawSymbol !== 'string') {
      throw new Error(`SymbolMappingError: Invalid empty or non-string symbol "${String(rawSymbol)}"`);
    }

    const normalized = rawSymbol.trim().toUpperCase();
    const match = this.aliasToCanonicalMap.get(normalized);

    if (match) {
      return match;
    }

    // Extended catalog symbols
    if (normalized === 'CRYBTCUSD' || normalized === 'BTCUSD' || normalized === 'BTC_USD') return 'BTC_USD' as InstrumentSymbol;
    if (normalized === 'CRYETHUSD' || normalized === 'ETHUSD' || normalized === 'ETH_USD') return 'ETH_USD' as InstrumentSymbol;
    if (normalized === 'FRXXPDUSD' || normalized === 'XPDUSD' || normalized === 'XPD_USD') return 'XPD_USD' as InstrumentSymbol;

    if (normalized.startsWith('FRX') && normalized.length === 9) {
      const pair = normalized.slice(3);
      return `${pair.slice(0, 3)}_${pair.slice(3)}` as InstrumentSymbol;
    }

    if (normalized.startsWith('OTC_')) {
      return normalized as InstrumentSymbol;
    }

    // If already in BASE_QUOTE format, return it
    if (rawSymbol.includes('_')) {
      return rawSymbol as InstrumentSymbol;
    }

    throw new Error(
      `SymbolMappingError: Unrecognized or unapproved instrument "${rawSymbol}".`,
    );
  }

  /**
   * Safely attempts resolution without throwing.
   */
  public static tryToCanonicalSymbol(rawSymbol: string): InstrumentSymbol | null {
    try {
      return this.toCanonicalSymbol(rawSymbol);
    } catch {
      return null;
    }
  }

  /**
   * Verifies each of the approved canonical instruments against Deriv's active_symbols
   * list and reports any that Deriv does not offer, rather than guessing.
   */
  public static verifyAgainstActiveSymbols(
    activeSymbols: readonly DerivActiveSymbol[],
  ): SymbolVerificationReport {
    const activeMap = new Map<string, DerivActiveSymbol>();
    for (const item of activeSymbols) {
      activeMap.set(item.symbol.toUpperCase(), item);
      activeMap.set(item.symbol, item);
    }

    const offered: VerifiedDerivInstrument[] = [];
    const unoffered: UnofferedDerivInstrument[] = [];

    for (const config of APPROVED_INSTRUMENTS_LIST) {
      const canonical = config.symbol;
      const expectedDeriv = this.toDerivSymbol(canonical);

      const match =
        activeMap.get(expectedDeriv) ||
        activeMap.get(expectedDeriv.toUpperCase()) ||
        activeMap.get(config.brokerSymbolMapping.cleanTicker) ||
        activeMap.get(`frx${config.brokerSymbolMapping.cleanTicker}`);

      if (match) {
        offered.push({
          canonicalSymbol: canonical,
          derivSymbol: match.symbol,
          displayName: match.display_name,
          market: match.market,
          pip: match.pip ?? config.pipSize,
          isTradingSuspended: match.is_trading_suspended === 1,
        });
      } else {
        unoffered.push({
          canonicalSymbol: canonical,
          expectedDerivSymbol: expectedDeriv,
          reason: `Instrument not returned in Deriv active_symbols list for current account/market permissions`,
        });
      }
    }

    return {
      totalApproved: APPROVED_INSTRUMENTS_LIST.length,
      offeredCount: offered.length,
      unofferedCount: unoffered.length,
      offered,
      unoffered,
      verifiedAt: Date.now(),
    };
  }

  /**
   * Translates a canonical symbol into a specified external platform convention.
   */
  public static formatForPlatform(
    symbol: InstrumentSymbol,
    platform: ExternalBrokerPlatform,
  ): string {
    const config = APPROVED_INSTRUMENTS_REGISTRY[symbol];
    if (!config) {
      throw new Error(`SymbolMappingError: Missing configuration for "${symbol}"`);
    }

    switch (platform) {
      case 'DERIV':
        return this.toDerivSymbol(symbol);
      case 'STANDARD_DISPLAY':
        return config.brokerSymbolMapping.displaySymbol;
      case 'ISO_CLEAN':
        return config.brokerSymbolMapping.cleanTicker;
      case 'TRADING_VIEW':
        return `DERIV:${this.toDerivSymbol(symbol)}`;
      case 'INTERACTIVE_BROKERS':
        return `${config.baseCurrency}.${config.quoteCurrency}`;
      case 'METATRADER':
        return config.brokerSymbolMapping.cleanTicker;
      default:
        return config.symbol;
    }
  }

  /**
   * Type guard to check if a symbol is one of the approved instruments.
   */
  public static isApprovedSymbol(symbol: string): symbol is InstrumentSymbol {
    return this.aliasToCanonicalMap.has(symbol.trim().toUpperCase());
  }
}
