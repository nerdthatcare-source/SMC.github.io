/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Instrument Market Configuration Registry
 *
 * EXACT 26 APPROVED CANONICAL INSTRUMENTS:
 * - 7 Forex Majors: EUR_USD, GBP_USD, USD_JPY, USD_CHF, AUD_USD, USD_CAD, NZD_USD
 * - 11 Forex Minors / Crosses: EUR_GBP, EUR_JPY, GBP_JPY, AUD_JPY, EUR_AUD, GBP_AUD,
 *                              EUR_CAD, GBP_CAD, CAD_JPY, NZD_JPY, AUD_CAD
 * - 5 Key Indices: US30_USD, SPX500_USD, NAS100_USD, DE30_EUR, UK100_GBP
 * - 3 Precious Metals: XAU_USD (Gold), XAG_USD (Silver), XPT_USD (Platinum)
 *
 * HARD RULE: Only these 26 instruments are registered. Any order, feed, or analysis
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

// ============================================================================
// 3. MASTER REGISTRY OF EXACTLY 26 APPROVED INSTRUMENTS
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

  CAD_JPY: {
    symbol: 'CAD_JPY',
    name: 'Canadian Dollar / Japanese Yen',
    assetClass: 'FOREX_MINOR',
    baseCurrency: 'CAD',
    quoteCurrency: 'JPY',
    pipSize: 0.01,
    pipPrecision: 2,
    quotePrecision: 3,
    standardLotUnits: 100_000,
    maxLeverageRatio: 20,
    sessionHours: STANDARD_FOREX_SCHEDULE,
    volatilityProfile: {
      baselineAtr1H: 22.0,
      baselineAtr15M: 11.0,
      baselineAtr5M: 6.2,
      volatilityTier: 'MEDIUM',
      minStopDistancePips: 8.0,
      maxSpreadThresholdPips: 2.5,
    },
    brokerSymbolMapping: {
      derivSymbol: 'frxCADJPY',
      displaySymbol: 'CAD/JPY',
      tradingViewSymbol: 'DERIV:CADJPY',
      cleanTicker: 'CADJPY',
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
  // SECTION 3: 5 KEY GLOBAL INDICES
  // --------------------------------------------------------------------------
  US30_USD: {
    symbol: 'US30_USD',
    name: 'US Wall St 30 (Dow Jones)',
    assetClass: 'INDEX',
    baseCurrency: 'USD',
    quoteCurrency: 'USD',
    pipSize: 1.0,
    pipPrecision: 0,
    quotePrecision: 1,
    standardLotUnits: 1,
    maxLeverageRatio: 20,
    sessionHours: STANDARD_INDEX_SCHEDULE,
    volatilityProfile: {
      baselineAtr1H: 180.0,
      baselineAtr15M: 90.0,
      baselineAtr5M: 50.0,
      volatilityTier: 'EXTREME',
      minStopDistancePips: 60.0,
      maxSpreadThresholdPips: 4.0,
    },
    brokerSymbolMapping: {
      derivSymbol: 'OTC_DJI',
      displaySymbol: 'US30/USD',
      tradingViewSymbol: 'DERIV:US30USD',
      cleanTicker: 'US30',
    },
  },

  SPX500_USD: {
    symbol: 'SPX500_USD',
    name: 'US SPX 500 (S&P 500)',
    assetClass: 'INDEX',
    baseCurrency: 'USD',
    quoteCurrency: 'USD',
    pipSize: 0.1,
    pipPrecision: 1,
    quotePrecision: 2,
    standardLotUnits: 1,
    maxLeverageRatio: 20,
    sessionHours: STANDARD_INDEX_SCHEDULE,
    volatilityProfile: {
      baselineAtr1H: 22.0,
      baselineAtr15M: 11.0,
      baselineAtr5M: 6.0,
      volatilityTier: 'HIGH',
      minStopDistancePips: 8.0,
      maxSpreadThresholdPips: 0.8,
    },
    brokerSymbolMapping: {
      derivSymbol: 'OTC_SPC',
      displaySymbol: 'SPX500/USD',
      tradingViewSymbol: 'DERIV:SPX500USD',
      cleanTicker: 'SPX500',
    },
  },

  NAS100_USD: {
    symbol: 'NAS100_USD',
    name: 'US Tech 100 (Nasdaq 100)',
    assetClass: 'INDEX',
    baseCurrency: 'USD',
    quoteCurrency: 'USD',
    pipSize: 0.1,
    pipPrecision: 1,
    quotePrecision: 2,
    standardLotUnits: 1,
    maxLeverageRatio: 20,
    sessionHours: STANDARD_INDEX_SCHEDULE,
    volatilityProfile: {
      baselineAtr1H: 95.0,
      baselineAtr15M: 48.0,
      baselineAtr5M: 26.0,
      volatilityTier: 'EXTREME',
      minStopDistancePips: 30.0,
      maxSpreadThresholdPips: 2.0,
    },
    brokerSymbolMapping: {
      derivSymbol: 'OTC_NDX',
      displaySymbol: 'NAS100/USD',
      tradingViewSymbol: 'DERIV:NAS100USD',
      cleanTicker: 'NAS100',
    },
  },

  DE30_EUR: {
    symbol: 'DE30_EUR',
    name: 'Germany 40 (DAX 40)',
    assetClass: 'INDEX',
    baseCurrency: 'EUR',
    quoteCurrency: 'EUR',
    pipSize: 1.0,
    pipPrecision: 0,
    quotePrecision: 1,
    standardLotUnits: 1,
    maxLeverageRatio: 20,
    sessionHours: STANDARD_INDEX_SCHEDULE,
    volatilityProfile: {
      baselineAtr1H: 80.0,
      baselineAtr15M: 40.0,
      baselineAtr5M: 22.0,
      volatilityTier: 'HIGH',
      minStopDistancePips: 25.0,
      maxSpreadThresholdPips: 2.5,
    },
    brokerSymbolMapping: {
      derivSymbol: 'OTC_GDAXI',
      displaySymbol: 'GER40/EUR',
      tradingViewSymbol: 'DERIV:DE30EUR',
      cleanTicker: 'GER40',
    },
  },

  UK100_GBP: {
    symbol: 'UK100_GBP',
    name: 'UK 100 (FTSE 100)',
    assetClass: 'INDEX',
    baseCurrency: 'GBP',
    quoteCurrency: 'GBP',
    pipSize: 1.0,
    pipPrecision: 0,
    quotePrecision: 1,
    standardLotUnits: 1,
    maxLeverageRatio: 20,
    sessionHours: STANDARD_INDEX_SCHEDULE,
    volatilityProfile: {
      baselineAtr1H: 35.0,
      baselineAtr15M: 18.0,
      baselineAtr5M: 10.0,
      volatilityTier: 'MEDIUM',
      minStopDistancePips: 12.0,
      maxSpreadThresholdPips: 2.0,
    },
    brokerSymbolMapping: {
      derivSymbol: 'OTC_FTSE',
      displaySymbol: 'UK100/GBP',
      tradingViewSymbol: 'DERIV:UK100GBP',
      cleanTicker: 'UK100',
    },
  },

  // --------------------------------------------------------------------------
  // SECTION 4: 3 PRECIOUS METALS
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
    standardLotUnits: 100, // 100 troy ounces
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
    standardLotUnits: 5_000, // 5000 troy ounces
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
    standardLotUnits: 100, // 100 troy ounces
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
};

/**
 * Array of all 26 approved configurations for iteration.
 */
export const APPROVED_INSTRUMENTS_LIST: readonly InstrumentConfiguration[] =
  Object.values(APPROVED_INSTRUMENTS_REGISTRY);

/**
 * Helper to fetch instrument configuration with safety check.
 */
export function getInstrumentConfig(
  symbol: InstrumentSymbol,
): InstrumentConfiguration {
  const config = APPROVED_INSTRUMENTS_REGISTRY[symbol];
  if (!config) {
    throw new Error(
      `UNAPPROVED INSTRUMENT ERROR: Symbol "${symbol}" is not registered in the 26 canonical instruments.`,
    );
  }
  return config;
}

/**
 * Total count guard: Exactly 26 instruments.
 */
export const APPROVED_INSTRUMENTS_COUNT = APPROVED_INSTRUMENTS_LIST.length;
if (APPROVED_INSTRUMENTS_COUNT !== 26) {
  throw new Error(
    `FATAL ARCHITECTURE BREACH: Expected exactly 26 approved instruments, but found ${APPROVED_INSTRUMENTS_COUNT}.`,
  );
}
