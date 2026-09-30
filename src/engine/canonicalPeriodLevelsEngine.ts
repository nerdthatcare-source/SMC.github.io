/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Canonical Period Levels Engine
 *
 * Computes prior-day (PDH, PDL, PDO, PDC), prior-week (PWH, PWL, PWO, PWC),
 * and session-based reference levels (Asian High/Low, Daily/Weekly Open).
 *
 * These reference levels act as external institutional liquidity pools (BSL / SSL).
 * Pure calculation: canonical candles in, period reference levels out.
 */

import {
  Candle,
  InstrumentSymbol,
  LiquidityLevel,
  LiquidityLevelType,
  StructuralTimeframe,
} from '../types/smc';
import { MarketDataNormalization } from './marketDataNormalization';

export interface PriorDayLevels {
  readonly dateIso: string; // YYYY-MM-DD
  readonly pdh: number; // Previous Day High
  readonly pdl: number; // Previous Day Low
  readonly pdo: number; // Previous Day Open
  readonly pdc: number; // Previous Day Close
  readonly pdhSwept: boolean;
  readonly pdhSweepTimestamp?: number;
  readonly pdlSwept: boolean;
  readonly pdlSweepTimestamp?: number;
}

export interface PriorWeekLevels {
  readonly weekIso: string; // YYYY-Www
  readonly pwh: number; // Previous Week High
  readonly pwl: number; // Previous Week Low
  readonly pwo: number; // Previous Week Open
  readonly pwc: number; // Previous Week Close
  readonly pwhSwept: boolean;
  readonly pwhSweepTimestamp?: number;
  readonly pwlSwept: boolean;
  readonly pwlSweepTimestamp?: number;
}

export interface CurrentSessionLevels {
  readonly dailyOpen: number;
  readonly weeklyOpen: number;
  readonly asianHigh: number;
  readonly asianLow: number;
  readonly asianRangePips: number;
  readonly asianSweptBSL: boolean;
  readonly asianSweptSSL: boolean;
}

export interface PeriodReferenceLevelsReport {
  readonly symbol: InstrumentSymbol;
  readonly calculatedAt: number;
  readonly priorDay: PriorDayLevels | null;
  readonly priorWeek: PriorWeekLevels | null;
  readonly currentSession: CurrentSessionLevels | null;
  readonly liquidityLevels: readonly LiquidityLevel[];
}

export class CanonicalPeriodLevelsEngine {
  /**
   * Pure calculation: Extracts Prior Day, Prior Week, and Session High/Low levels
   * from canonical candles (typically 1H or 15M candles spanning multiple days).
   */
  public static computePeriodReferenceLevels(
    candles: readonly Candle[],
    symbol: InstrumentSymbol,
    timeframe: StructuralTimeframe = '1H',
  ): PeriodReferenceLevelsReport {
    if (!candles || candles.length === 0) {
      return {
        symbol,
        calculatedAt: Date.now(),
        priorDay: null,
        priorWeek: null,
        currentSession: null,
        liquidityLevels: [],
      };
    }

    // TODO: Configure Deriv-specific trading-day boundary.
    // Deriv markets follow 00:00 UTC or market-specific trading sessions rather than standard forex
    // 17:00 New York (21:00/22:00 UTC) rollover. Do not assume a 17:00 New York rollover for Deriv.
    // Current implementation computes boundaries based on UTC calendar day (00:00:00 UTC).
    // Group candles by UTC calendar day (YYYY-MM-DD)
    const candlesByDay = new Map<string, Candle[]>();
    for (const c of candles) {
      const dayKey = new Date(c.timestamp).toISOString().split('T')[0];
      let dayList = candlesByDay.get(dayKey);
      if (!dayList) {
        dayList = [];
        candlesByDay.set(dayKey, dayList);
      }
      dayList.push(c);
    }

    const sortedDays = Array.from(candlesByDay.keys()).sort();
    const currentDayKey = sortedDays[sortedDays.length - 1];
    const previousDayKey = sortedDays.length >= 2 ? sortedDays[sortedDays.length - 2] : null;

    let priorDay: PriorDayLevels | null = null;
    const currentDayCandles = candlesByDay.get(currentDayKey) || [];

    if (previousDayKey) {
      const prevCandles = candlesByDay.get(previousDayKey)!;
      let pdh = -Infinity;
      let pdl = Infinity;
      const pdo = prevCandles[0].open;
      const pdc = prevCandles[prevCandles.length - 1].close;

      for (const c of prevCandles) {
        if (c.high > pdh) pdh = c.high;
        if (c.low < pdl) pdl = c.low;
      }

      // Check if current day candles have swept PDH or PDL
      let pdhSwept = false;
      let pdhSweepTimestamp: number | undefined;
      let pdlSwept = false;
      let pdlSweepTimestamp: number | undefined;

      for (const c of currentDayCandles) {
        if (!pdhSwept && c.high > pdh) {
          pdhSwept = true;
          pdhSweepTimestamp = c.timestamp;
        }
        if (!pdlSwept && c.low < pdl) {
          pdlSwept = true;
          pdlSweepTimestamp = c.timestamp;
        }
      }

      priorDay = {
        dateIso: previousDayKey,
        pdh,
        pdl,
        pdo,
        pdc,
        pdhSwept,
        pdhSweepTimestamp,
        pdlSwept,
        pdlSweepTimestamp,
      };
    }

    // Group candles by UTC Week (e.g. ISO Week)
    const candlesByWeek = new Map<string, Candle[]>();
    for (const c of candles) {
      const date = new Date(c.timestamp);
      const weekKey = this.getUtcWeekKey(date);
      let weekList = candlesByWeek.get(weekKey);
      if (!weekList) {
        weekList = [];
        candlesByWeek.set(weekKey, weekList);
      }
      weekList.push(c);
    }

    const sortedWeeks = Array.from(candlesByWeek.keys()).sort();
    const currentWeekKey = sortedWeeks[sortedWeeks.length - 1];
    const previousWeekKey = sortedWeeks.length >= 2 ? sortedWeeks[sortedWeeks.length - 2] : null;

    let priorWeek: PriorWeekLevels | null = null;
    const currentWeekCandles = candlesByWeek.get(currentWeekKey) || [];

    if (previousWeekKey) {
      const prevWeekCandles = candlesByWeek.get(previousWeekKey)!;
      let pwh = -Infinity;
      let pwl = Infinity;
      const pwo = prevWeekCandles[0].open;
      const pwc = prevWeekCandles[prevWeekCandles.length - 1].close;

      for (const c of prevWeekCandles) {
        if (c.high > pwh) pwh = c.high;
        if (c.low < pwl) pwl = c.low;
      }

      let pwhSwept = false;
      let pwhSweepTimestamp: number | undefined;
      let pwlSwept = false;
      let pwlSweepTimestamp: number | undefined;

      for (const c of currentWeekCandles) {
        if (!pwhSwept && c.high > pwh) {
          pwhSwept = true;
          pwhSweepTimestamp = c.timestamp;
        }
        if (!pwlSwept && c.low < pwl) {
          pwlSwept = true;
          pwlSweepTimestamp = c.timestamp;
        }
      }

      priorWeek = {
        weekIso: previousWeekKey,
        pwh,
        pwl,
        pwo,
        pwc,
        pwhSwept,
        pwhSweepTimestamp,
        pwlSwept,
        pwlSweepTimestamp,
      };
    }

    // Current Session & Asian Session (00:00 - 06:00 UTC)
    let currentSession: CurrentSessionLevels | null = null;
    if (currentDayCandles.length > 0) {
      const dailyOpen = currentDayCandles[0].open;
      const weeklyOpen = currentWeekCandles.length > 0 ? currentWeekCandles[0].open : dailyOpen;

      let asianHigh = -Infinity;
      let asianLow = Infinity;
      let hasAsianCandles = false;
      const postAsianCandles: Candle[] = [];

      for (const c of currentDayCandles) {
        const hour = new Date(c.timestamp).getUTCHours();
        if (hour >= 0 && hour < 6) {
          hasAsianCandles = true;
          if (c.high > asianHigh) asianHigh = c.high;
          if (c.low < asianLow) asianLow = c.low;
        } else if (hour >= 6) {
          postAsianCandles.push(c);
        }
      }

      if (!hasAsianCandles) {
        asianHigh = dailyOpen;
        asianLow = dailyOpen;
      }

      let asianSweptBSL = false;
      let asianSweptSSL = false;
      for (const post of postAsianCandles) {
        if (post.high > asianHigh) asianSweptBSL = true;
        if (post.low < asianLow) asianSweptSSL = true;
      }

      const asianRangePips = MarketDataNormalization.priceDeltaToPips(
        Math.max(0, asianHigh - asianLow),
        symbol,
      );

      currentSession = {
        dailyOpen,
        weeklyOpen,
        asianHigh: hasAsianCandles ? asianHigh : dailyOpen,
        asianLow: hasAsianCandles ? asianLow : dailyOpen,
        asianRangePips,
        asianSweptBSL,
        asianSweptSSL,
      };
    }

    // Form canonical LiquidityLevel models
    const liquidityLevels: LiquidityLevel[] = [];

    if (priorDay) {
      liquidityLevels.push({
        id: `liq_${symbol}_PDH_${priorDay.dateIso}`,
        symbol,
        timeframe,
        type: 'PREVIOUS_DAY_HIGH',
        price: priorDay.pdh,
        originTimestamp: new Date(`${priorDay.dateIso}T00:00:00Z`).getTime(),
        isSwept: priorDay.pdhSwept,
        sweepTimestamp: priorDay.pdhSweepTimestamp,
        touchCount: priorDay.pdhSwept ? 1 : 0,
      });

      liquidityLevels.push({
        id: `liq_${symbol}_PDL_${priorDay.dateIso}`,
        symbol,
        timeframe,
        type: 'PREVIOUS_DAY_LOW',
        price: priorDay.pdl,
        originTimestamp: new Date(`${priorDay.dateIso}T00:00:00Z`).getTime(),
        isSwept: priorDay.pdlSwept,
        sweepTimestamp: priorDay.pdlSweepTimestamp,
        touchCount: priorDay.pdlSwept ? 1 : 0,
      });
    }

    if (priorWeek) {
      liquidityLevels.push({
        id: `liq_${symbol}_PWH_${priorWeek.weekIso}`,
        symbol,
        timeframe,
        type: 'BSL',
        price: priorWeek.pwh,
        originTimestamp: Date.now() - 7 * 24 * 3600 * 1000,
        isSwept: priorWeek.pwhSwept,
        sweepTimestamp: priorWeek.pwhSweepTimestamp,
        touchCount: priorWeek.pwhSwept ? 1 : 0,
      });

      liquidityLevels.push({
        id: `liq_${symbol}_PWL_${priorWeek.weekIso}`,
        symbol,
        timeframe,
        type: 'SSL',
        price: priorWeek.pwl,
        originTimestamp: Date.now() - 7 * 24 * 3600 * 1000,
        isSwept: priorWeek.pwlSwept,
        sweepTimestamp: priorWeek.pwlSweepTimestamp,
        touchCount: priorWeek.pwlSwept ? 1 : 0,
      });
    }

    if (currentSession && currentSession.asianHigh > currentSession.asianLow) {
      liquidityLevels.push({
        id: `liq_${symbol}_ASIAN_HIGH_${currentDayKey}`,
        symbol,
        timeframe,
        type: 'SESSION_HIGH',
        price: currentSession.asianHigh,
        originTimestamp: new Date(`${currentDayKey}T00:00:00Z`).getTime(),
        isSwept: currentSession.asianSweptBSL,
        touchCount: currentSession.asianSweptBSL ? 1 : 0,
      });

      liquidityLevels.push({
        id: `liq_${symbol}_ASIAN_LOW_${currentDayKey}`,
        symbol,
        timeframe,
        type: 'SESSION_LOW',
        price: currentSession.asianLow,
        originTimestamp: new Date(`${currentDayKey}T00:00:00Z`).getTime(),
        isSwept: currentSession.asianSweptSSL,
        touchCount: currentSession.asianSweptSSL ? 1 : 0,
      });
    }

    return {
      symbol,
      calculatedAt: Date.now(),
      priorDay,
      priorWeek,
      currentSession,
      liquidityLevels,
    };
  }

  private static getUtcWeekKey(date: Date): string {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
  }
}
