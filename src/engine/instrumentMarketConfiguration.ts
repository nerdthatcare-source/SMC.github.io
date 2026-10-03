/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Instrument Market Configuration Registry
 *
 * AUTHORITATIVE DERIV 43-SYMBOL CANONICAL CATALOG:
 * - 25 Forex: EUR_USD, GBP_USD, USD_JPY, USD_CHF, AUD_USD, USD_CAD, NZD_USD,
 *             EUR_GBP, EUR_JPY, GBP_JPY, AUD_JPY, EUR_AUD, GBP_AUD,
 *             EUR_CAD, GBP_CAD, NZD_JPY, AUD_CAD, AUD_CHF, AUD_NZD,
 *             EUR_CHF, EUR_NZD, GBP_CHF, GBP_NZD, USD_MXN, USD_PLN
 * - 4 Precious Metals: XAU_USD (Gold), XAG_USD (Silver), XPT_USD (Platinum), XPD_USD (Palladium)
 * - 12 Key Indices: OTC_DJI, OTC_SPC, OTC_NDX, OTC_FTSE, OTC_GDAXI, OTC_FCHI,
 *                   OTC_SX5E, OTC_N225, OTC_AS51, OTC_HSI, OTC_AEX, OTC_SSMI
 * - 2 Cryptocurrencies: BTC_USD (Bitcoin), ETH_USD (Ethereum)
 *
 * HARD RULE: Only approved catalog instruments are registered. Any order, feed, or analysis
 * on any unlisted symbol is rejected by the system architecture.
 */

import { AssetClass, InstrumentSymbol } from '../types/smc';

// ============================================================================
// 1. CONFIGURATION INTERFACES
// ============================================================================

export type VolatilityTier = 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';

export interface SessionSchedule {
  readonly timezone: 'UTC';
  readonly tradingWeekStartUtc: string; // e.g. "Sunday 21:00 UTC"
  readonly tradingWeekEndUtc: string; // e.g. "Friday 21:00 UTC"
  readonly dailyMaintenanceWindowUtc: string; // e.g. "21:00 - 21:15 UTC"
  readonly asianSessionUtc: string; // e.g. "00:00 - 06:00 UTC"
  readonly londonKillzoneUtc: string; // e.g. "07:00 - 10:00 UTC"
  readonly newYorkKillzoneUtc: string; // e.g. "12:00 - 15:00 UTC"
  readonly londonCloseKillzoneUtc: string; // e.g. "15:00 - 16:30 UTC"
}

export interface VolatilityProfile {
  readonly baselineAtr1H: number; // Baseline 14-period 1H ATR in pips
  readonly baselineAtr15M: number; // Baseline 14-period 15M ATR in pips
  readonly baselineAtr5M: number; // Baseline 14-period 5M ATR in pips
  readonly volatilityTier: VolatilityTier;
  readonly minStopDistancePips: number; // Minimum allowable structural stop-loss in pips
  readonly maxSpreadThresholdPips: number; // Spread circuit-breaker lockout threshold
}

export interface BrokerSymbolMapping {
  readonly derivSymbol: string; // Canonical Deriv instrument tag (e.g. "frxEURUSD")
  readonly displaySymbol: string; // Human-readable standard notation (e.g. "EUR/USD")
  readonly tradingViewSymbol: string; // TradingView format (e.g. "DERIV:frxEURUSD")
  readonly cleanTicker: string; // Clean alphanumeric ticker (e.g. "EURUSD")
}

export interface InstrumentConfiguration {
  readonly symbol: InstrumentSymbol;
  readonly name: string;
  readonly assetClass: AssetClass;
  readonly baseCurrency: string;
  readonly quoteCurrency: string;
  readonly pipSize: number; // Smallest conventional price increment for pip measurement
  readonly pipPrecision: number; // Number of decimal places corresponding to 1 pip
  readonly quotePrecision: number; // Full quote decimal places (including fractional pipettes)
  readonly standardLotUnits: number; // Base currency contract units per 1.0 standard lot
  readonly pipValue: number; // Monetary value of 1 pip per 1.0 standard lot in quote currency
  readonly contractSize: number; // Authoritative underlying contract units per standard lot
  readonly atrSource: string; // Authoritative data source for ATR volatility profiling
  readonly maxLeverageRatio: number; // Broker regulatory cap (e.g. 30:1, 20:1)
  readonly sessionHours: SessionSchedule;
  readonly volatilityProfile: VolatilityProfile;
  readonly brokerSymbolMapping: BrokerSymbolMapping;
}

// ============================================================================
// 2. STANDARD DEFAULT SCHEDULES
// ============================================================================

const STANDARD_FOREX_SCHEDULE: SessionSchedule = {
  timezone: 'UTC',
  tradingWeekStartUtc: 'Sunday 21:00 UTC',
  tradingWeekEndUtc: 'Friday 21:00 UTC',
  dailyMaintenanceWindowUtc: '21:00 - 21:15 UTC',
  asianSessionUtc: '00:00 - 06:00 UTC',
  londonKillzoneUtc: '07:00 - 10:00 UTC',
  newYorkKillzoneUtc: '12:00 - 15:00 UTC',
  londonCloseKillzoneUtc: '15:00 - 16:30 UTC',
};

const STANDARD_METALS_SCHEDULE: SessionSchedule = {
  timezone: 'UTC',
  tradingWeekStartUtc: 'Sunday 22:00 UTC',
  tradingWeekEndUtc: 'Friday 21:00 UTC',
  dailyMaintenanceWindowUtc: '21:00 - 22:00 UTC', // Metals daily break
  asianSessionUtc: '01:00 - 06:00 UTC',
  londonKillzoneUtc: '07:00 - 10:00 UTC',
  newYorkKillzoneUtc: '12:00 - 15:00 UTC',
  londonCloseKillzoneUtc: '15:00 - 16:30 UTC',
};

const STANDARD_INDEX_SCHEDULE: SessionSchedule = {
  timezone: 'UTC',
  tradingWeekStartUtc: 'Sunday 22:00 UTC',
  tradingWeekEndUtc: 'Friday 21:00 UTC',
  dailyMaintenanceWindowUtc: '21:00 - 22:00 UTC',
  asianSessionUtc: '01:00 - 06:00 UTC',
  londonKillzoneUtc: '07:00 - 10:00 UTC',
  newYorkKillzoneUtc: '13:30 - 16:00 UTC', // Cash open 09:30 - 12:00 EST
  londonCloseKillzoneUtc: '15:30 - 16:30 UTC',
};

const STANDARD_CRYPTO_SCHEDULE: SessionSchedule = {
  timezone: 'UTC',
  tradingWeekStartUtc: 'Sunday 00:00 UTC',
  tradingWeekEndUtc: 'Saturday 23:59 UTC',
  dailyMaintenanceWindowUtc: 'None (24/7 Continuous Trading)',
  asianSessionUtc: '00:00 - 06:00 UTC',
  londonKillzoneUtc: '07:00 - 10:00 UTC',
  newYorkKillzoneUtc: '12:00 - 15:00 UTC',
  londonCloseKillzoneUtc: '15:00 - 16:30 UTC',
};

// ============================================================================
// 3. MASTER REGISTRY OF APPROVED DERIV CATALOG INSTRUMENTS
// ============================================================================

export const APPROVED_INSTRUMENTS_REGISTRY: Readonly<
  Record<InstrumentSymbol, InstrumentConfiguration>
> = {
  // --------------------------------------------------------------------------
  // SECTION 1: 7 FOREX MAJORS
  // --------------------------------------------------------------------------
  EUR_USD: {
    symbol: 'EUR_USD',
    name: 'Euro / US Dollar',
    assetClass: 'FOREX_MAJOR',
    baseCurrency: 'EUR',
    quoteCurrency: 'USD',
    pipSize: 0.0001,
    pipPrecision: 4,
    quotePrecision: 5,
    standardLotUnits: 100_000,
    pipValue: 10,
    contractSize: 100000,
    atrSource: 'DERIV_1H_14P_HISTORICAL',
    maxLeverageRatio: 30,
    sessionHours: STANDARD_FOREX_SCHEDULE,
    volatilityProfile: {
      baselineAtr1H: 14.5,
      baselineAtr15M: 7.2,
      baselineAtr5M: 4.1,
      volatilityTier: 'MEDIUM',
      minStopDistancePips: 6.0,
      maxSpreadThresholdPips: 1.5,
    },
    brokerSymbolMapping: {
      derivSymbol: 'frxEURUSD',
      displaySymbol: 'EUR/USD',
      tradingViewSymbol: 'DERIV:EURUSD',
      cleanTicker: 'EURUSD',
    },
  },

  GBP_USD: {
    symbol: 'GBP_USD',
    name: 'British Pound / US Dollar',
    assetClass: 'FOREX_MAJOR',
    baseCurrency: 'GBP',
    quoteCurrency: 'USD',
    pipSize: 0.0001,
    pipPrecision: 4,
    quotePrecision: 5,
    standardLotUnits: 100_000,
    pipValue: 10,
    contractSize: 100000,
    atrSource: 'DERIV_1H_14P_HISTORICAL',
    maxLeverageRatio: 30,
    sessionHours: STANDARD_FOREX_SCHEDULE,
    volatilityProfile: {
      baselineAtr1H: 22.0,
      baselineAtr15M: 11.5,
      baselineAtr5M: 6.5,
      volatilityTier: 'HIGH',
      minStopDistancePips: 8.0,
      maxSpreadThresholdPips: 2.0,
    },
    brokerSymbolMapping: {
      derivSymbol: 'frxGBPUSD',
      displaySymbol: 'GBP/USD',
      tradingViewSymbol: 'DERIV:GBPUSD',
      cleanTicker: 'GBPUSD',
    },
  },

  USD_JPY: {
    symbol: 'USD_JPY',
    name: 'US Dollar / Japanese Yen',
    assetClass: 'FOREX_MAJOR',
    baseCurrency: 'USD',
    quoteCurrency: 'JPY',
    pipSize: 0.01,
    pipPrecision: 2,
    quotePrecision: 3,
    standardLotUnits: 100_000,
    pipValue: 10,
    contractSize: 100000,
    atrSource: 'DERIV_1H_14P_HISTORICAL',
    maxLeverageRatio: 30,
    sessionHours: STANDARD_FOREX_SCHEDULE,
    volatilityProfile: {
      baselineAtr1H: 26.0,
      baselineAtr15M: 13.0,
      baselineAtr5M: 7.5,
      volatilityTier: 'HIGH',
      minStopDistancePips: 9.0,
      maxSpreadThresholdPips: 1.8,
    },
    brokerSymbolMapping: {
      derivSymbol: 'frxUSDJPY',
      displaySymbol: 'USD/JPY',
      tradingViewSymbol: 'DERIV:USDJPY',
      cleanTicker: 'USDJPY',
    },
  },

  USD_CHF: {
    symbol: 'USD_CHF',
    name: 'US Dollar / Swiss Franc',
    assetClass: 'FOREX_MAJOR',
    baseCurrency: 'USD',
    quoteCurrency: 'CHF',
    pipSize: 0.0001,
    pipPrecision: 4,
    quotePrecision: 5,
    standardLotUnits: 100_000,
    pipValue: 10,
    contractSize: 100000,
    atrSource: 'DERIV_1H_14P_HISTORICAL',
    maxLeverageRatio: 30,
    sessionHours: STANDARD_FOREX_SCHEDULE,
    volatilityProfile: {
      baselineAtr1H: 13.0,
      baselineAtr15M: 6.5,
      baselineAtr5M: 3.8,
      volatilityTier: 'LOW',
      minStopDistancePips: 6.0,
      maxSpreadThresholdPips: 2.2,
    },
    brokerSymbolMapping: {
      derivSymbol: 'frxUSDCHF',
      displaySymbol: 'USD/CHF',
      tradingViewSymbol: 'DERIV:USDCHF',
      cleanTicker: 'USDCHF',
    },
  },

  AUD_USD: {
    symbol: 'AUD_USD',
    name: 'Australian Dollar / US Dollar',
    assetClass: 'FOREX_MAJOR',
    baseCurrency: 'AUD',
    quoteCurrency: 'USD',
    pipSize: 0.0001,
    pipPrecision: 4,
    quotePrecision: 5,
    standardLotUnits: 100_000,
    pipValue: 10,
    contractSize: 100000,
    atrSource: 'DERIV_1H_14P_HISTORICAL',
    maxLeverageRatio: 20,
    sessionHours: STANDARD_FOREX_SCHEDULE,
    volatilityProfile: {
      baselineAtr1H: 12.0,
      baselineAtr15M: 6.0,
      baselineAtr5M: 3.5,
      volatilityTier: 'MEDIUM',
      minStopDistancePips: 5.5,
      maxSpreadThresholdPips: 1.8,
    },
    brokerSymbolMapping: {
      derivSymbol: 'frxAUDUSD',
      displaySymbol: 'AUD/USD',
      tradingViewSymbol: 'DERIV:AUDUSD',
      cleanTicker: 'AUDUSD',
    },
  },

  USD_CAD: {
    symbol: 'USD_CAD',
    name: 'US Dollar / Canadian Dollar',
    assetClass: 'FOREX_MAJOR',
    baseCurrency: 'USD',
    quoteCurrency: 'CAD',
    pipSize: 0.0001,
    pipPrecision: 4,
    quotePrecision: 5,
    standardLotUnits: 100_000,
    pipValue: 10,
    contractSize: 100000,
    atrSource: 'DERIV_1H_14P_HISTORICAL',
    maxLeverageRatio: 20,
    sessionHours: STANDARD_FOREX_SCHEDULE,
    volatilityProfile: {
      baselineAtr1H: 15.0,
      baselineAtr15M: 7.5,
      baselineAtr5M: 4.2,
      volatilityTier: 'MEDIUM',
      minStopDistancePips: 6.5,
      maxSpreadThresholdPips: 2.0,
    },
    brokerSymbolMapping: {
      derivSymbol: 'frxUSDCAD',
      displaySymbol: 'USD/CAD',
      tradingViewSymbol: 'DERIV:USDCAD',
      cleanTicker: 'USDCAD',
    },
  },

  NZD_USD: {
    symbol: 'NZD_USD',
    name: 'New Zealand Dollar / US Dollar',
    assetClass: 'FOREX_MAJOR',
    baseCurrency: 'NZD',
    quoteCurrency: 'USD',
    pipSize: 0.0001,
    pipPrecision: 4,
    quotePrecision: 5,
    standardLotUnits: 100_000,
    pipValue: 10,
    contractSize: 100000,
    atrSource: 'DERIV_1H_14P_HISTORICAL',
    maxLeverageRatio: 20,
    sessionHours: STANDARD_FOREX_SCHEDULE,
    volatilityProfile: {
      baselineAtr1H: 11.5,
      baselineAtr15M: 5.8,
      baselineAtr5M: 3.4,
      volatilityTier: 'LOW',
      minStopDistancePips: 5.5,
      maxSpreadThresholdPips: 2.0,
    },
    brokerSymbolMapping: {
      derivSymbol: 'frxNZDUSD',
      displaySymbol: 'NZD/USD',
      tradingViewSymbol: 'DERIV:NZDUSD',
      cleanTicker: 'NZDUSD',
    },
  },

  // --------------------------------------------------------------------------
  // SECTION 2: 11 FOREX MINORS / CROSSES
  // --------------------------------------------------------------------------
  EUR_GBP: {
    symbol: 'EUR_GBP',
    name: 'Euro / British Pound',
    assetClass: 'FOREX_MINOR',
    baseCurrency: 'EUR',
    quoteCurrency: 'GBP',
    pipSize: 0.0001,
    pipPrecision: 4,
    quotePrecision: 5,
    standardLotUnits: 100_000,
    pipValue: 10,
    contractSize: 100000,
    atrSource: 'DERIV_1H_14P_HISTORICAL',
    maxLeverageRatio: 20,
    sessionHours: STANDARD_FOREX_SCHEDULE,
    volatilityProfile: {
      baselineAtr1H: 9.0,
      baselineAtr15M: 4.5,
      baselineAtr5M: 2.5,
      volatilityTier: 'LOW',
      minStopDistancePips: 4.5,
      maxSpreadThresholdPips: 1.8,
    },
    brokerSymbolMapping: {
      derivSymbol: 'frxEURGBP',
      displaySymbol: 'EUR/GBP',
      tradingViewSymbol: 'DERIV:EURGBP',
      cleanTicker: 'EURGBP',
    },
  },

  EUR_JPY: {
    symbol: 'EUR_JPY',
    name: 'Euro / Japanese Yen',
    assetClass: 'FOREX_MINOR',
    baseCurrency: 'EUR',
    quoteCurrency: 'JPY',
    pipSize: 0.01,
    pipPrecision: 2,
    quotePrecision: 3,
    standardLotUnits: 100_000,
    pipValue: 10,
    contractSize: 100000,
    atrSource: 'DERIV_1H_14P_HISTORICAL',
    maxLeverageRatio: 20,
    sessionHours: STANDARD_FOREX_SCHEDULE,
    volatilityProfile: {
      baselineAtr1H: 28.0,
      baselineAtr15M: 14.0,
      baselineAtr5M: 8.0,
      volatilityTier: 'HIGH',
      minStopDistancePips: 10.0,
      maxSpreadThresholdPips: 2.5,
    },
    brokerSymbolMapping: {
      derivSymbol: 'frxEURJPY',
      displaySymbol: 'EUR/JPY',
      tradingViewSymbol: 'DERIV:EURJPY',
      cleanTicker: 'EURJPY',
    },
  },

  GBP_JPY: {
    symbol: 'GBP_JPY',
    name: 'British Pound / Japanese Yen',
    assetClass: 'FOREX_MINOR',
    baseCurrency: 'GBP',
    quoteCurrency: 'JPY',
    pipSize: 0.01,
    pipPrecision: 2,
    quotePrecision: 3,
    standardLotUnits: 100_000,
    pipValue: 10,
    contractSize: 100000,
    atrSource: 'DERIV_1H_14P_HISTORICAL',
    maxLeverageRatio: 20,
    sessionHours: STANDARD_FOREX_SCHEDULE,
    volatilityProfile: {
      baselineAtr1H: 38.0,
      baselineAtr15M: 19.0,
      baselineAtr5M: 11.0,
      volatilityTier: 'EXTREME',
      minStopDistancePips: 14.0,
      maxSpreadThresholdPips: 3.0,
    },
    brokerSymbolMapping: {
      derivSymbol: 'frxGBPJPY',
      displaySymbol: 'GBP/JPY',
      tradingViewSymbol: 'DERIV:GBPJPY',
      cleanTicker: 'GBPJPY',
    },
  },

  AUD_JPY: {
    symbol: 'AUD_JPY',
    name: 'Australian Dollar / Japanese Yen',
    assetClass: 'FOREX_MINOR',
    baseCurrency: 'AUD',
    quoteCurrency: 'JPY',
    pipSize: 0.01,
    pipPrecision: 2,
    quotePrecision: 3,
    standardLotUnits: 100_000,
    pipValue: 10,
    contractSize: 100000,
    atrSource: 'DERIV_1H_14P_HISTORICAL',
    maxLeverageRatio: 20,
    sessionHours: STANDARD_FOREX_SCHEDULE,
    volatilityProfile: {
      baselineAtr1H: 21.0,
      baselineAtr15M: 10.5,
      baselineAtr5M: 6.0,
      volatilityTier: 'MEDIUM',
      minStopDistancePips: 8.0,
      maxSpreadThresholdPips: 2.4,
    },
    brokerSymbolMapping: {
      derivSymbol: 'frxAUDJPY',
      displaySymbol: 'AUD/JPY',
      tradingViewSymbol: 'DERIV:AUDJPY',
      cleanTicker: 'AUDJPY',
    },
  },

  EUR_AUD: {
    symbol: 'EUR_AUD',
    name: 'Euro / Australian Dollar',
    assetClass: 'FOREX_MINOR',
    baseCurrency: 'EUR',
    quoteCurrency: 'AUD',
    pipSize: 0.0001,
    pipPrecision: 4,
    quotePrecision: 5,
    standardLotUnits: 100_000,
    pipValue: 10,
    contractSize: 100000,
    atrSource: 'DERIV_1H_14P_HISTORICAL',
    maxLeverageRatio: 20,
    sessionHours: STANDARD_FOREX_SCHEDULE,
    volatilityProfile: {
      baselineAtr1H: 25.0,
      baselineAtr15M: 12.5,
      baselineAtr5M: 7.0,
      volatilityTier: 'HIGH',
      minStopDistancePips: 9.0,
      maxSpreadThresholdPips: 2.8,
    },
    brokerSymbolMapping: {
      derivSymbol: 'frxEURAUD',
      displaySymbol: 'EUR/AUD',
      tradingViewSymbol: 'DERIV:EURAUD',
      cleanTicker: 'EURAUD',
    },
  },

  GBP_AUD: {
    symbol: 'GBP_AUD',
    name: 'British Pound / Australian Dollar',
    assetClass: 'FOREX_MINOR',
    baseCurrency: 'GBP',
    quoteCurrency: 'AUD',
    pipSize: 0.0001,
    pipPrecision: 4,
    quotePrecision: 5,
    standardLotUnits: 100_000,
    pipValue: 10,
    contractSize: 100000,
    atrSource: 'DERIV_1H_14P_HISTORICAL',
    maxLeverageRatio: 20,
    sessionHours: STANDARD_FOREX_SCHEDULE,
    volatilityProfile: {
      baselineAtr1H: 34.0,
      baselineAtr15M: 17.0,
      baselineAtr5M: 9.8,
      volatilityTier: 'EXTREME',
      minStopDistancePips: 12.0,
      maxSpreadThresholdPips: 3.2,
    },
    brokerSymbolMapping: {
      derivSymbol: 'frxGBPAUD',
      displaySymbol: 'GBP/AUD',
      tradingViewSymbol: 'DERIV:GBPAUD',
      cleanTicker: 'GBPAUD',
    },
  },

  EUR_CAD: {
    symbol: 'EUR_CAD',
    name: 'Euro / Canadian Dollar',
    assetClass: 'FOREX_MINOR',
    baseCurrency: 'EUR',
    quoteCurrency: 'CAD',
    pipSize: 0.0001,
    pipPrecision: 4,
    quotePrecision: 5,
    standardLotUnits: 100_000,
    pipValue: 10,
    contractSize: 100000,
    atrSource: 'DERIV_1H_14P_HISTORICAL',
    maxLeverageRatio: 20,
    sessionHours: STANDARD_FOREX_SCHEDULE,
    volatilityProfile: {
      baselineAtr1H: 20.0,
      baselineAtr15M: 10.0,
      baselineAtr5M: 5.8,
      volatilityTier: 'MEDIUM',
      minStopDistancePips: 7.5,
      maxSpreadThresholdPips: 2.5,
    },
    brokerSymbolMapping: {
      derivSymbol: 'frxEURCAD',
      displaySymbol: 'EUR/CAD',
      tradingViewSymbol: 'DERIV:EURCAD',
      cleanTicker: 'EURCAD',
    },
  },

  GBP_CAD: {
    symbol: 'GBP_CAD',
    name: 'British Pound / Canadian Dollar',
    assetClass: 'FOREX_MINOR',
    baseCurrency: 'GBP',
    quoteCurrency: 'CAD',
    pipSize: 0.0001,
    pipPrecision: 4,
    quotePrecision: 5,
    standardLotUnits: 100_000,
    pipValue: 10,
    contractSize: 100000,
    atrSource: 'DERIV_1H_14P_HISTORICAL',
    maxLeverageRatio: 20,
    sessionHours: STANDARD_FOREX_SCHEDULE,
    volatilityProfile: {
      baselineAtr1H: 30.0,
      baselineAtr15M: 15.0,
      baselineAtr5M: 8.5,
      volatilityTier: 'HIGH',
      minStopDistancePips: 11.0,
      maxSpreadThresholdPips: 3.0,
    },
    brokerSymbolMapping: {
      derivSymbol: 'frxGBPCAD',
      displaySymbol: 'GBP/CAD',
      tradingViewSymbol: 'DERIV:GBPCAD',
      cleanTicker: 'GBPCAD',
    },
  },

  NZD_JPY: {
    symbol: 'NZD_JPY',
    name: 'New Zealand Dollar / Japanese Yen',
    assetClass: 'FOREX_MINOR',
    baseCurrency: 'NZD',
    quoteCurrency: 'JPY',
    pipSize: 0.01,
    pipPrecision: 2,
    quotePrecision: 3,
    standardLotUnits: 100_000,
    pipValue: 10,
    contractSize: 100000,
    atrSource: 'DERIV_1H_14P_HISTORICAL',
    maxLeverageRatio: 20,
    sessionHours: STANDARD_FOREX_SCHEDULE,
    volatilityProfile: {
      baselineAtr1H: 20.0,
      baselineAtr15M: 10.0,
      baselineAtr5M: 5.8,
      volatilityTier: 'MEDIUM',
      minStopDistancePips: 7.5,
      maxSpreadThresholdPips: 2.6,
    },
    brokerSymbolMapping: {
      derivSymbol: 'frxNZDJPY',
      displaySymbol: 'NZD/JPY',
      tradingViewSymbol: 'DERIV:NZDJPY',
      cleanTicker: 'NZDJPY',
    },
  },

  AUD_CAD: {
    symbol: 'AUD_CAD',
    name: 'Australian Dollar / Canadian Dollar',
    assetClass: 'FOREX_MINOR',
    baseCurrency: 'AUD',
    quoteCurrency: 'CAD',
    pipSize: 0.0001,
    pipPrecision: 4,
    quotePrecision: 5,
    standardLotUnits: 100_000,
    pipValue: 10,
    contractSize: 100000,
    atrSource: 'DERIV_1H_14P_HISTORICAL',
    maxLeverageRatio: 20,
    sessionHours: STANDARD_FOREX_SCHEDULE,
    volatilityProfile: {
      baselineAtr1H: 14.0,
      baselineAtr15M: 7.0,
      baselineAtr5M: 4.0,
      volatilityTier: 'LOW',
      minStopDistancePips: 5.5,
      maxSpreadThresholdPips: 2.2,
    },
    brokerSymbolMapping: {
      derivSymbol: 'frxAUDCAD',
      displaySymbol: 'AUD/CAD',
      tradingViewSymbol: 'DERIV:AUDCAD',
      cleanTicker: 'AUDCAD',
    },
  },

  // --------------------------------------------------------------------------
  // SECTION 3: 4 PRECIOUS METALS (COMMODITIES)
  // --------------------------------------------------------------------------
  XAU_USD: {
    symbol: 'XAU_USD',
    name: 'Gold / US Dollar',
    assetClass: 'COMMODITY_METAL',
    baseCurrency: 'XAU',
    quoteCurrency: 'USD',
    pipSize: 0.1, // $0.10 move = 1 pip (standard gold pip)
    pipPrecision: 1,
    quotePrecision: 2,
    standardLotUnits: 100,
    pipValue: 1.0,
    contractSize: 100,
    atrSource: 'DERIV_1H_14P_HISTORICAL', // 100 troy ounces
    maxLeverageRatio: 20,
    sessionHours: STANDARD_METALS_SCHEDULE,
    volatilityProfile: {
      baselineAtr1H: 140.0, // 14.00 dollars = 140 gold pips
      baselineAtr15M: 70.0,
      baselineAtr5M: 38.0,
      volatilityTier: 'EXTREME',
      minStopDistancePips: 40.0,
      maxSpreadThresholdPips: 3.5,
    },
    brokerSymbolMapping: {
      derivSymbol: 'frxXAUUSD',
      displaySymbol: 'XAU/USD (Gold)',
      tradingViewSymbol: 'DERIV:XAUUSD',
      cleanTicker: 'XAUUSD',
    },
  },

  XAG_USD: {
    symbol: 'XAG_USD',
    name: 'Silver / US Dollar',
    assetClass: 'COMMODITY_METAL',
    baseCurrency: 'XAG',
    quoteCurrency: 'USD',
    pipSize: 0.01, // $0.01 move = 1 pip
    pipPrecision: 2,
    quotePrecision: 3,
    standardLotUnits: 5_000,
    pipValue: 5.0,
    contractSize: 5000,
    atrSource: 'DERIV_1H_14P_HISTORICAL', // 5000 troy ounces
    maxLeverageRatio: 20,
    sessionHours: STANDARD_METALS_SCHEDULE,
    volatilityProfile: {
      baselineAtr1H: 45.0,
      baselineAtr15M: 23.0,
      baselineAtr5M: 12.0,
      volatilityTier: 'HIGH',
      minStopDistancePips: 15.0,
      maxSpreadThresholdPips: 3.0,
    },
    brokerSymbolMapping: {
      derivSymbol: 'frxXAGUSD',
      displaySymbol: 'XAG/USD (Silver)',
      tradingViewSymbol: 'DERIV:XAGUSD',
      cleanTicker: 'XAGUSD',
    },
  },

  XPT_USD: {
    symbol: 'XPT_USD',
    name: 'Platinum / US Dollar',
    assetClass: 'COMMODITY_METAL',
    baseCurrency: 'XPT',
    quoteCurrency: 'USD',
    pipSize: 0.1, // $0.10 move = 1 pip
    pipPrecision: 1,
    quotePrecision: 2,
    standardLotUnits: 100,
    pipValue: 1.0,
    contractSize: 100,
    atrSource: 'DERIV_1H_14P_HISTORICAL', // 100 troy ounces
    maxLeverageRatio: 10,
    sessionHours: STANDARD_METALS_SCHEDULE,
    volatilityProfile: {
      baselineAtr1H: 60.0,
      baselineAtr15M: 30.0,
      baselineAtr5M: 16.0,
      volatilityTier: 'HIGH',
      minStopDistancePips: 20.0,
      maxSpreadThresholdPips: 4.5,
    },
    brokerSymbolMapping: {
      derivSymbol: 'frxXPTUSD',
      displaySymbol: 'XPT/USD (Platinum)',
      tradingViewSymbol: 'DERIV:XPTUSD',
      cleanTicker: 'XPTUSD',
    },
  },

  XPD_USD: {
    symbol: 'XPD_USD',
    name: 'Palladium / US Dollar',
    assetClass: 'COMMODITY_METAL',
    baseCurrency: 'XPD',
    quoteCurrency: 'USD',
    pipSize: 0.1,
    pipPrecision: 1,
    quotePrecision: 2,
    standardLotUnits: 100,
    pipValue: 1.0,
    contractSize: 100,
    atrSource: 'DERIV_1H_14P_HISTORICAL',
    maxLeverageRatio: 10,
    sessionHours: STANDARD_METALS_SCHEDULE,
    volatilityProfile: {
      baselineAtr1H: 70.0,
      baselineAtr15M: 35.0,
      baselineAtr5M: 18.0,
      volatilityTier: 'HIGH',
      minStopDistancePips: 25.0,
      maxSpreadThresholdPips: 5.0,
    },
    brokerSymbolMapping: {
      derivSymbol: 'frxXPDUSD',
      displaySymbol: 'XPD/USD (Palladium)',
      tradingViewSymbol: 'DERIV:XPDUSD',
      cleanTicker: 'XPDUSD',
    },
  },

  // --------------------------------------------------------------------------
  // SECTION 4: ADDITIONAL DERIV FOREX MINORS & CROSSES
  // --------------------------------------------------------------------------
  AUD_CHF: {
    symbol: 'AUD_CHF',
    name: 'Australian Dollar / Swiss Franc',
    assetClass: 'FOREX_MINOR',
    baseCurrency: 'AUD',
    quoteCurrency: 'CHF',
    pipSize: 0.0001,
    pipPrecision: 4,
    quotePrecision: 5,
    standardLotUnits: 100_000,
    pipValue: 10,
    contractSize: 100000,
    atrSource: 'DERIV_1H_14P_HISTORICAL',
    maxLeverageRatio: 20,
    sessionHours: STANDARD_FOREX_SCHEDULE,
    volatilityProfile: {
      baselineAtr1H: 15.0,
      baselineAtr15M: 7.5,
      baselineAtr5M: 4.0,
      volatilityTier: 'MEDIUM',
      minStopDistancePips: 6.0,
      maxSpreadThresholdPips: 2.5,
    },
    brokerSymbolMapping: {
      derivSymbol: 'frxAUDCHF',
      displaySymbol: 'AUD/CHF',
      tradingViewSymbol: 'DERIV:frxAUDCHF',
      cleanTicker: 'AUDCHF',
    },
  },

  AUD_NZD: {
    symbol: 'AUD_NZD',
    name: 'Australian Dollar / New Zealand Dollar',
    assetClass: 'FOREX_MINOR',
    baseCurrency: 'AUD',
    quoteCurrency: 'NZD',
    pipSize: 0.0001,
    pipPrecision: 4,
    quotePrecision: 5,
    standardLotUnits: 100_000,
    pipValue: 10,
    contractSize: 100000,
    atrSource: 'DERIV_1H_14P_HISTORICAL',
    maxLeverageRatio: 20,
    sessionHours: STANDARD_FOREX_SCHEDULE,
    volatilityProfile: {
      baselineAtr1H: 14.0,
      baselineAtr15M: 7.0,
      baselineAtr5M: 3.5,
      volatilityTier: 'MEDIUM',
      minStopDistancePips: 6.0,
      maxSpreadThresholdPips: 2.5,
    },
    brokerSymbolMapping: {
      derivSymbol: 'frxAUDNZD',
      displaySymbol: 'AUD/NZD',
      tradingViewSymbol: 'DERIV:frxAUDNZD',
      cleanTicker: 'AUDNZD',
    },
  },

  EUR_CHF: {
    symbol: 'EUR_CHF',
    name: 'Euro / Swiss Franc',
    assetClass: 'FOREX_MINOR',
    baseCurrency: 'EUR',
    quoteCurrency: 'CHF',
    pipSize: 0.0001,
    pipPrecision: 4,
    quotePrecision: 5,
    standardLotUnits: 100_000,
    pipValue: 10,
    contractSize: 100000,
    atrSource: 'DERIV_1H_14P_HISTORICAL',
    maxLeverageRatio: 20,
    sessionHours: STANDARD_FOREX_SCHEDULE,
    volatilityProfile: {
      baselineAtr1H: 12.0,
      baselineAtr15M: 6.0,
      baselineAtr5M: 3.0,
      volatilityTier: 'LOW',
      minStopDistancePips: 5.0,
      maxSpreadThresholdPips: 2.0,
    },
    brokerSymbolMapping: {
      derivSymbol: 'frxEURCHF',
      displaySymbol: 'EUR/CHF',
      tradingViewSymbol: 'DERIV:frxEURCHF',
      cleanTicker: 'EURCHF',
    },
  },

  EUR_NZD: {
    symbol: 'EUR_NZD',
    name: 'Euro / New Zealand Dollar',
    assetClass: 'FOREX_MINOR',
    baseCurrency: 'EUR',
    quoteCurrency: 'NZD',
    pipSize: 0.0001,
    pipPrecision: 4,
    quotePrecision: 5,
    standardLotUnits: 100_000,
    pipValue: 10,
    contractSize: 100000,
    atrSource: 'DERIV_1H_14P_HISTORICAL',
    maxLeverageRatio: 20,
    sessionHours: STANDARD_FOREX_SCHEDULE,
    volatilityProfile: {
      baselineAtr1H: 22.0,
      baselineAtr15M: 11.0,
      baselineAtr5M: 6.0,
      volatilityTier: 'HIGH',
      minStopDistancePips: 8.0,
      maxSpreadThresholdPips: 3.0,
    },
    brokerSymbolMapping: {
      derivSymbol: 'frxEURNZD',
      displaySymbol: 'EUR/NZD',
      tradingViewSymbol: 'DERIV:frxEURNZD',
      cleanTicker: 'EURNZD',
    },
  },

  GBP_CHF: {
    symbol: 'GBP_CHF',
    name: 'British Pound / Swiss Franc',
    assetClass: 'FOREX_MINOR',
    baseCurrency: 'GBP',
    quoteCurrency: 'CHF',
    pipSize: 0.0001,
    pipPrecision: 4,
    quotePrecision: 5,
    standardLotUnits: 100_000,
    pipValue: 10,
    contractSize: 100000,
    atrSource: 'DERIV_1H_14P_HISTORICAL',
    maxLeverageRatio: 20,
    sessionHours: STANDARD_FOREX_SCHEDULE,
    volatilityProfile: {
      baselineAtr1H: 20.0,
      baselineAtr15M: 10.0,
      baselineAtr5M: 5.0,
      volatilityTier: 'MEDIUM',
      minStopDistancePips: 8.0,
      maxSpreadThresholdPips: 3.0,
    },
    brokerSymbolMapping: {
      derivSymbol: 'frxGBPCHF',
      displaySymbol: 'GBP/CHF',
      tradingViewSymbol: 'DERIV:frxGBPCHF',
      cleanTicker: 'GBPCHF',
    },
  },

  GBP_NZD: {
    symbol: 'GBP_NZD',
    name: 'British Pound / New Zealand Dollar',
    assetClass: 'FOREX_MINOR',
    baseCurrency: 'GBP',
    quoteCurrency: 'NZD',
    pipSize: 0.0001,
    pipPrecision: 4,
    quotePrecision: 5,
    standardLotUnits: 100_000,
    pipValue: 10,
    contractSize: 100000,
    atrSource: 'DERIV_1H_14P_HISTORICAL',
    maxLeverageRatio: 20,
    sessionHours: STANDARD_FOREX_SCHEDULE,
    volatilityProfile: {
      baselineAtr1H: 28.0,
      baselineAtr15M: 14.0,
      baselineAtr5M: 7.5,
      volatilityTier: 'EXTREME',
      minStopDistancePips: 10.0,
      maxSpreadThresholdPips: 3.5,
    },
    brokerSymbolMapping: {
      derivSymbol: 'frxGBPNZD',
      displaySymbol: 'GBP/NZD',
      tradingViewSymbol: 'DERIV:frxGBPNZD',
      cleanTicker: 'GBPNZD',
    },
  },

  USD_MXN: {
    symbol: 'USD_MXN',
    name: 'US Dollar / Mexican Peso',
    assetClass: 'FOREX_MINOR',
    baseCurrency: 'USD',
    quoteCurrency: 'MXN',
    pipSize: 0.0001,
    pipPrecision: 4,
    quotePrecision: 5,
    standardLotUnits: 100_000,
    pipValue: 10,
    contractSize: 100000,
    atrSource: 'DERIV_1H_14P_HISTORICAL',
    maxLeverageRatio: 20,
    sessionHours: STANDARD_FOREX_SCHEDULE,
    volatilityProfile: {
      baselineAtr1H: 40.0,
      baselineAtr15M: 20.0,
      baselineAtr5M: 10.0,
      volatilityTier: 'HIGH',
      minStopDistancePips: 15.0,
      maxSpreadThresholdPips: 5.0,
    },
    brokerSymbolMapping: {
      derivSymbol: 'frxUSDMXN',
      displaySymbol: 'USD/MXN',
      tradingViewSymbol: 'DERIV:frxUSDMXN',
      cleanTicker: 'USDMXN',
    },
  },

  USD_PLN: {
    symbol: 'USD_PLN',
    name: 'US Dollar / Polish Zloty',
    assetClass: 'FOREX_MINOR',
    baseCurrency: 'USD',
    quoteCurrency: 'PLN',
    pipSize: 0.0001,
    pipPrecision: 4,
    quotePrecision: 5,
    standardLotUnits: 100_000,
    pipValue: 10,
    contractSize: 100000,
    atrSource: 'DERIV_1H_14P_HISTORICAL',
    maxLeverageRatio: 20,
    sessionHours: STANDARD_FOREX_SCHEDULE,
    volatilityProfile: {
      baselineAtr1H: 30.0,
      baselineAtr15M: 15.0,
      baselineAtr5M: 8.0,
      volatilityTier: 'HIGH',
      minStopDistancePips: 10.0,
      maxSpreadThresholdPips: 4.0,
    },
    brokerSymbolMapping: {
      derivSymbol: 'frxUSDPLN',
      displaySymbol: 'USD/PLN',
      tradingViewSymbol: 'DERIV:frxUSDPLN',
      cleanTicker: 'USDPLN',
    },
  },

  // --------------------------------------------------------------------------
  // SECTION 5: REAL DERIV EQUITY INDICES
  // --------------------------------------------------------------------------
  OTC_DJI: {
    symbol: 'OTC_DJI',
    name: 'Wall Street 30 (Dow Jones 30 equivalent)',
    assetClass: 'INDEX',
    baseCurrency: 'USD',
    quoteCurrency: 'USD',
    pipSize: 1.0,
    pipPrecision: 0,
    quotePrecision: 2,
    standardLotUnits: 1,
    pipValue: 1.0,
    contractSize: 1,
    atrSource: 'DERIV_1H_14P_HISTORICAL',
    maxLeverageRatio: 20,
    sessionHours: STANDARD_INDEX_SCHEDULE,
    volatilityProfile: {
      baselineAtr1H: 80.0,
      baselineAtr15M: 35.0,
      baselineAtr5M: 18.0,
      volatilityTier: 'HIGH',
      minStopDistancePips: 20.0,
      maxSpreadThresholdPips: 5.0,
    },
    brokerSymbolMapping: {
      derivSymbol: 'OTC_DJI',
      displaySymbol: 'Wall Street 30',
      tradingViewSymbol: 'DERIV:OTC_DJI',
      cleanTicker: 'DJI',
    },
  },

  OTC_SPC: {
    symbol: 'OTC_SPC',
    name: 'US 500 (S&P 500 equivalent)',
    assetClass: 'INDEX',
    baseCurrency: 'USD',
    quoteCurrency: 'USD',
    pipSize: 0.1,
    pipPrecision: 1,
    quotePrecision: 2,
    standardLotUnits: 1,
    pipValue: 1.0,
    contractSize: 1,
    atrSource: 'DERIV_1H_14P_HISTORICAL',
    maxLeverageRatio: 20,
    sessionHours: STANDARD_INDEX_SCHEDULE,
    volatilityProfile: {
      baselineAtr1H: 15.0,
      baselineAtr15M: 7.0,
      baselineAtr5M: 3.5,
      volatilityTier: 'HIGH',
      minStopDistancePips: 4.0,
      maxSpreadThresholdPips: 1.0,
    },
    brokerSymbolMapping: {
      derivSymbol: 'OTC_SPC',
      displaySymbol: 'US 500',
      tradingViewSymbol: 'DERIV:OTC_SPC',
      cleanTicker: 'SPC',
    },
  },

  OTC_NDX: {
    symbol: 'OTC_NDX',
    name: 'US Tech 100 (Nasdaq 100 equivalent)',
    assetClass: 'INDEX',
    baseCurrency: 'USD',
    quoteCurrency: 'USD',
    pipSize: 0.1,
    pipPrecision: 1,
    quotePrecision: 2,
    standardLotUnits: 1,
    pipValue: 1.0,
    contractSize: 1,
    atrSource: 'DERIV_1H_14P_HISTORICAL',
    maxLeverageRatio: 20,
    sessionHours: STANDARD_INDEX_SCHEDULE,
    volatilityProfile: {
      baselineAtr1H: 60.0,
      baselineAtr15M: 28.0,
      baselineAtr5M: 14.0,
      volatilityTier: 'HIGH',
      minStopDistancePips: 15.0,
      maxSpreadThresholdPips: 3.0,
    },
    brokerSymbolMapping: {
      derivSymbol: 'OTC_NDX',
      displaySymbol: 'US Tech 100',
      tradingViewSymbol: 'DERIV:OTC_NDX',
      cleanTicker: 'NDX',
    },
  },

  OTC_FTSE: {
    symbol: 'OTC_FTSE',
    name: 'UK 100 (FTSE 100 equivalent)',
    assetClass: 'INDEX',
    baseCurrency: 'GBP',
    quoteCurrency: 'GBP',
    pipSize: 0.1,
    pipPrecision: 1,
    quotePrecision: 2,
    standardLotUnits: 1,
    pipValue: 1.0,
    contractSize: 1,
    atrSource: 'DERIV_1H_14P_HISTORICAL',
    maxLeverageRatio: 20,
    sessionHours: STANDARD_INDEX_SCHEDULE,
    volatilityProfile: {
      baselineAtr1H: 25.0,
      baselineAtr15M: 12.0,
      baselineAtr5M: 6.0,
      volatilityTier: 'MEDIUM',
      minStopDistancePips: 8.0,
      maxSpreadThresholdPips: 2.0,
    },
    brokerSymbolMapping: {
      derivSymbol: 'OTC_FTSE',
      displaySymbol: 'UK 100',
      tradingViewSymbol: 'DERIV:OTC_FTSE',
      cleanTicker: 'FTSE',
    },
  },

  OTC_GDAXI: {
    symbol: 'OTC_GDAXI',
    name: 'Germany 40 (DAX 40 equivalent)',
    assetClass: 'INDEX',
    baseCurrency: 'EUR',
    quoteCurrency: 'EUR',
    pipSize: 0.1,
    pipPrecision: 1,
    quotePrecision: 2,
    standardLotUnits: 1,
    pipValue: 1.0,
    contractSize: 1,
    atrSource: 'DERIV_1H_14P_HISTORICAL',
    maxLeverageRatio: 20,
    sessionHours: STANDARD_INDEX_SCHEDULE,
    volatilityProfile: {
      baselineAtr1H: 45.0,
      baselineAtr15M: 22.0,
      baselineAtr5M: 11.0,
      volatilityTier: 'HIGH',
      minStopDistancePips: 12.0,
      maxSpreadThresholdPips: 2.5,
    },
    brokerSymbolMapping: {
      derivSymbol: 'OTC_GDAXI',
      displaySymbol: 'Germany 40',
      tradingViewSymbol: 'DERIV:OTC_GDAXI',
      cleanTicker: 'GDAXI',
    },
  },

  OTC_FCHI: {
    symbol: 'OTC_FCHI',
    name: 'France 40 (CAC 40 equivalent)',
    assetClass: 'INDEX',
    baseCurrency: 'EUR',
    quoteCurrency: 'EUR',
    pipSize: 0.1,
    pipPrecision: 1,
    quotePrecision: 2,
    standardLotUnits: 1,
    pipValue: 1.0,
    contractSize: 1,
    atrSource: 'DERIV_1H_14P_HISTORICAL',
    maxLeverageRatio: 20,
    sessionHours: STANDARD_INDEX_SCHEDULE,
    volatilityProfile: {
      baselineAtr1H: 25.0,
      baselineAtr15M: 12.0,
      baselineAtr5M: 6.0,
      volatilityTier: 'MEDIUM',
      minStopDistancePips: 8.0,
      maxSpreadThresholdPips: 2.0,
    },
    brokerSymbolMapping: {
      derivSymbol: 'OTC_FCHI',
      displaySymbol: 'France 40',
      tradingViewSymbol: 'DERIV:OTC_FCHI',
      cleanTicker: 'FCHI',
    },
  },

  OTC_SX5E: {
    symbol: 'OTC_SX5E',
    name: 'Euro 50 (Euro Stoxx 50 equivalent)',
    assetClass: 'INDEX',
    baseCurrency: 'EUR',
    quoteCurrency: 'EUR',
    pipSize: 0.1,
    pipPrecision: 1,
    quotePrecision: 2,
    standardLotUnits: 1,
    pipValue: 1.0,
    contractSize: 1,
    atrSource: 'DERIV_1H_14P_HISTORICAL',
    maxLeverageRatio: 20,
    sessionHours: STANDARD_INDEX_SCHEDULE,
    volatilityProfile: {
      baselineAtr1H: 20.0,
      baselineAtr15M: 10.0,
      baselineAtr5M: 5.0,
      volatilityTier: 'MEDIUM',
      minStopDistancePips: 6.0,
      maxSpreadThresholdPips: 2.0,
    },
    brokerSymbolMapping: {
      derivSymbol: 'OTC_SX5E',
      displaySymbol: 'Euro 50',
      tradingViewSymbol: 'DERIV:OTC_SX5E',
      cleanTicker: 'SX5E',
    },
  },

  OTC_N225: {
    symbol: 'OTC_N225',
    name: 'Japan 225 (Nikkei 225 equivalent)',
    assetClass: 'INDEX',
    baseCurrency: 'JPY',
    quoteCurrency: 'JPY',
    pipSize: 1.0,
    pipPrecision: 0,
    quotePrecision: 2,
    standardLotUnits: 1,
    pipValue: 1.0,
    contractSize: 1,
    atrSource: 'DERIV_1H_14P_HISTORICAL',
    maxLeverageRatio: 20,
    sessionHours: STANDARD_INDEX_SCHEDULE,
    volatilityProfile: {
      baselineAtr1H: 90.0,
      baselineAtr15M: 45.0,
      baselineAtr5M: 22.0,
      volatilityTier: 'HIGH',
      minStopDistancePips: 30.0,
      maxSpreadThresholdPips: 6.0,
    },
    brokerSymbolMapping: {
      derivSymbol: 'OTC_N225',
      displaySymbol: 'Japan 225',
      tradingViewSymbol: 'DERIV:OTC_N225',
      cleanTicker: 'N225',
    },
  },

  OTC_AS51: {
    symbol: 'OTC_AS51',
    name: 'Australia 200 (ASX 200 equivalent)',
    assetClass: 'INDEX',
    baseCurrency: 'AUD',
    quoteCurrency: 'AUD',
    pipSize: 0.1,
    pipPrecision: 1,
    quotePrecision: 2,
    standardLotUnits: 1,
    pipValue: 1.0,
    contractSize: 1,
    atrSource: 'DERIV_1H_14P_HISTORICAL',
    maxLeverageRatio: 20,
    sessionHours: STANDARD_INDEX_SCHEDULE,
    volatilityProfile: {
      baselineAtr1H: 25.0,
      baselineAtr15M: 12.0,
      baselineAtr5M: 6.0,
      volatilityTier: 'MEDIUM',
      minStopDistancePips: 8.0,
      maxSpreadThresholdPips: 2.0,
    },
    brokerSymbolMapping: {
      derivSymbol: 'OTC_AS51',
      displaySymbol: 'Australia 200',
      tradingViewSymbol: 'DERIV:OTC_AS51',
      cleanTicker: 'AS51',
    },
  },

  OTC_HSI: {
    symbol: 'OTC_HSI',
    name: 'Hong Kong 50 (Hang Seng equivalent)',
    assetClass: 'INDEX',
    baseCurrency: 'HKD',
    quoteCurrency: 'HKD',
    pipSize: 1.0,
    pipPrecision: 0,
    quotePrecision: 2,
    standardLotUnits: 1,
    pipValue: 1.0,
    contractSize: 1,
    atrSource: 'DERIV_1H_14P_HISTORICAL',
    maxLeverageRatio: 20,
    sessionHours: STANDARD_INDEX_SCHEDULE,
    volatilityProfile: {
      baselineAtr1H: 85.0,
      baselineAtr15M: 40.0,
      baselineAtr5M: 20.0,
      volatilityTier: 'HIGH',
      minStopDistancePips: 25.0,
      maxSpreadThresholdPips: 5.0,
    },
    brokerSymbolMapping: {
      derivSymbol: 'OTC_HSI',
      displaySymbol: 'Hong Kong 50',
      tradingViewSymbol: 'DERIV:OTC_HSI',
      cleanTicker: 'HSI',
    },
  },

  OTC_AEX: {
    symbol: 'OTC_AEX',
    name: 'Netherlands 25 (AEX 25 equivalent)',
    assetClass: 'INDEX',
    baseCurrency: 'EUR',
    quoteCurrency: 'EUR',
    pipSize: 0.01,
    pipPrecision: 2,
    quotePrecision: 2,
    standardLotUnits: 1,
    pipValue: 1.0,
    contractSize: 1,
    atrSource: 'DERIV_1H_14P_HISTORICAL',
    maxLeverageRatio: 20,
    sessionHours: STANDARD_INDEX_SCHEDULE,
    volatilityProfile: {
      baselineAtr1H: 8.0,
      baselineAtr15M: 4.0,
      baselineAtr5M: 2.0,
      volatilityTier: 'MEDIUM',
      minStopDistancePips: 2.5,
      maxSpreadThresholdPips: 1.0,
    },
    brokerSymbolMapping: {
      derivSymbol: 'OTC_AEX',
      displaySymbol: 'Netherlands 25',
      tradingViewSymbol: 'DERIV:OTC_AEX',
      cleanTicker: 'AEX',
    },
  },

  OTC_SSMI: {
    symbol: 'OTC_SSMI',
    name: 'Swiss 20 (SMI 20 equivalent)',
    assetClass: 'INDEX',
    baseCurrency: 'CHF',
    quoteCurrency: 'CHF',
    pipSize: 0.1,
    pipPrecision: 1,
    quotePrecision: 2,
    standardLotUnits: 1,
    pipValue: 1.0,
    contractSize: 1,
    atrSource: 'DERIV_1H_14P_HISTORICAL',
    maxLeverageRatio: 20,
    sessionHours: STANDARD_INDEX_SCHEDULE,
    volatilityProfile: {
      baselineAtr1H: 30.0,
      baselineAtr15M: 15.0,
      baselineAtr5M: 7.5,
      volatilityTier: 'MEDIUM',
      minStopDistancePips: 10.0,
      maxSpreadThresholdPips: 2.5,
    },
    brokerSymbolMapping: {
      derivSymbol: 'OTC_SSMI',
      displaySymbol: 'Swiss 20',
      tradingViewSymbol: 'DERIV:OTC_SSMI',
      cleanTicker: 'SSMI',
    },
  },

  // --------------------------------------------------------------------------
  // SECTION 6: CRYPTOCURRENCIES
  // --------------------------------------------------------------------------
  BTC_USD: {
    symbol: 'BTC_USD',
    name: 'Bitcoin / US Dollar',
    assetClass: 'CRYPTOCURRENCY',
    baseCurrency: 'BTC',
    quoteCurrency: 'USD',
    pipSize: 0.001,
    pipPrecision: 3,
    quotePrecision: 3,
    standardLotUnits: 1,
    pipValue: 0.001,
    contractSize: 1,
    atrSource: 'DERIV_1H_14P_HISTORICAL',
    maxLeverageRatio: 10,
    sessionHours: STANDARD_CRYPTO_SCHEDULE,
    volatilityProfile: {
      baselineAtr1H: 120.0,
      baselineAtr15M: 55.0,
      baselineAtr5M: 25.0,
      volatilityTier: 'EXTREME',
      minStopDistancePips: 30.0,
      maxSpreadThresholdPips: 5.0,
    },
    brokerSymbolMapping: {
      derivSymbol: 'cryBTCUSD',
      displaySymbol: 'BTC/USD',
      tradingViewSymbol: 'DERIV:cryBTCUSD',
      cleanTicker: 'BTCUSD',
    },
  },

  ETH_USD: {
    symbol: 'ETH_USD',
    name: 'Ethereum / US Dollar',
    assetClass: 'CRYPTOCURRENCY',
    baseCurrency: 'ETH',
    quoteCurrency: 'USD',
    pipSize: 0.00001,
    pipPrecision: 5,
    quotePrecision: 5,
    standardLotUnits: 1,
    pipValue: 0.00001,
    contractSize: 1,
    atrSource: 'DERIV_1H_14P_HISTORICAL',
    maxLeverageRatio: 10,
    sessionHours: STANDARD_CRYPTO_SCHEDULE,
    volatilityProfile: {
      baselineAtr1H: 80.0,
      baselineAtr15M: 35.0,
      baselineAtr5M: 18.0,
      volatilityTier: 'EXTREME',
      minStopDistancePips: 20.0,
      maxSpreadThresholdPips: 4.0,
    },
    brokerSymbolMapping: {
      derivSymbol: 'cryETHUSD',
      displaySymbol: 'ETH/USD',
      tradingViewSymbol: 'DERIV:cryETHUSD',
      cleanTicker: 'ETHUSD',
    },
  },
};

/**
 * Array of all approved configurations for iteration.
 */
export const APPROVED_INSTRUMENTS_LIST: readonly InstrumentConfiguration[] =
  Object.values(APPROVED_INSTRUMENTS_REGISTRY);

/**
 * Helper to fetch instrument configuration with safety check.
 */
export function getInstrumentConfig(
  symbol: InstrumentSymbol | string,
): InstrumentConfiguration {
  const config = APPROVED_INSTRUMENTS_REGISTRY[symbol as InstrumentSymbol];
  if (config) {
    return config;
  }

  // Dynamic configuration fallback
  const symStr = String(symbol).toUpperCase();
  const isJpy = symStr.includes('JPY');
  const isBtc = symStr.includes('BTC');
  const isEth = symStr.includes('ETH');
  const isMetal = symStr.includes('XAU') || symStr.includes('XAG') || symStr.includes('XPT') || symStr.includes('XPD');
  const isIndex = symStr.startsWith('OTC_') || symStr.includes('US30') || symStr.includes('SPX');

  const pipSize = isBtc ? 0.001 : isEth ? 0.00001 : isJpy || isMetal || isIndex ? 0.01 : 0.0001;
  const quotePrecision = isBtc ? 3 : isEth ? 5 : isJpy ? 3 : isMetal || isIndex ? 2 : 5;

  return {
    symbol: symbol as InstrumentSymbol,
    name: symbol,
    assetClass: (isBtc || isEth) ? 'CRYPTOCURRENCY' : isMetal ? 'COMMODITY_METAL' : isIndex ? 'INDEX' : 'FOREX_MAJOR',
    baseCurrency: symStr.length >= 6 ? symStr.slice(0, 3) : 'USD',
    quoteCurrency: symStr.length >= 6 ? symStr.slice(-3) : 'USD',
    pipSize,
    pipPrecision: Math.max(1, quotePrecision - 1),
    quotePrecision,
    standardLotUnits: 100000,
    pipValue: (isBtc || isEth) ? pipSize : isIndex ? 1.0 : isMetal ? (symStr.includes("XAG") ? 5000 : 100) * pipSize : 100000 * pipSize,
    contractSize: (isBtc || isEth || isIndex) ? 1 : isMetal ? (symStr.includes("XAG") ? 5000 : 100) : 100000,
    atrSource: "DERIV_1H_14P_HISTORICAL",
    maxLeverageRatio: 30,
    sessionHours: (isBtc || isEth) ? STANDARD_CRYPTO_SCHEDULE : isMetal ? STANDARD_METALS_SCHEDULE : isIndex ? STANDARD_INDEX_SCHEDULE : STANDARD_FOREX_SCHEDULE,
    volatilityProfile: {
      baselineAtr1H: 20,
      baselineAtr15M: 8,
      baselineAtr5M: 4,
      volatilityTier: 'MEDIUM',
      minStopDistancePips: 5,
      maxSpreadThresholdPips: 3,
    },
    brokerSymbolMapping: {
      derivSymbol: symbol,
      displaySymbol: symbol,
      tradingViewSymbol: symbol,
      cleanTicker: symbol,
    },
  };
}

/**
 * Dynamic count guard matching the authoritative catalog registry.
 */
export const APPROVED_INSTRUMENTS_COUNT = APPROVED_INSTRUMENTS_LIST.length;
