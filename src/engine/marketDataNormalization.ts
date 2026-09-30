/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Market Data Normalization Engine
 *
 * Provides precision normalization, pip calculations, timestamp boundary alignment,
 * and canonical decimal representation for the 26 approved instruments.
 */

import { InstrumentSymbol, Timeframe } from '../types/smc';
import {
  APPROVED_INSTRUMENTS_REGISTRY,
  getInstrumentConfig,
} from './instrumentMarketConfiguration';

export class MarketDataNormalization {
  /**
   * Normalizes a raw floating point price to the instrument's official quote precision.
   */
  public static roundToPrecision(
    price: number,
    symbol: InstrumentSymbol,
  ): number {
    const config = getInstrumentConfig(symbol);
    const factor = Math.pow(10, config.quotePrecision);
    return Math.round(price * factor) / factor;
  }

  /**
   * Formats a price as a string with the exact number of decimal places for display.
   */
  public static formatPrice(
    price: number,
    symbol: InstrumentSymbol,
  ): string {
    const config = getInstrumentConfig(symbol);
    return price.toFixed(config.quotePrecision);
  }

  /**
   * Converts a price delta into standard pips according to the instrument pip size.
   */
  public static priceDeltaToPips(
    priceDelta: number,
    symbol: InstrumentSymbol,
  ): number {
    const config = getInstrumentConfig(symbol);
    const pips = priceDelta / config.pipSize;
    // Pip values are conventionally rounded to 1 decimal place (pipettes)
    return Math.round(pips * 10) / 10;
  }

  /**
   * Converts a pip count into price distance.
   */
  public static pipsToPriceDelta(
    pips: number,
    symbol: InstrumentSymbol,
  ): number {
    const config = getInstrumentConfig(symbol);
    return pips * config.pipSize;
  }

  /**
   * Calculates the spread in pips between ask and bid prices.
   */
  public static calculateSpreadPips(
    ask: number,
    bid: number,
    symbol: InstrumentSymbol,
  ): number {
    const spreadDelta = Math.max(0, ask - bid);
    return this.priceDeltaToPips(spreadDelta, symbol);
  }

  /**
   * Aligns any epoch timestamp in ms to the lower boundary of a timeframe period.
   * e.g. 15M: aligns to 00, 15, 30, 45 minutes past the hour.
   */
  public static alignTimestampToTimeframe(
    timestamp: number,
    timeframe: Timeframe,
  ): number {
    const date = new Date(timestamp);
    date.setUTCSeconds(0, 0);

    const minutes = date.getUTCMinutes();

    switch (timeframe) {
      case '1H':
        date.setUTCMinutes(0);
        return date.getTime();
      case '15M':
        date.setUTCMinutes(Math.floor(minutes / 15) * 15);
        return date.getTime();
      case '5M':
        date.setUTCMinutes(Math.floor(minutes / 5) * 5);
        return date.getTime();
      case '1M':
        return date.getTime();
    }
  }

  /**
   * Returns timeframe duration in milliseconds.
   */
  public static getTimeframeDurationMs(timeframe: Timeframe): number {
    switch (timeframe) {
      case '1H':
        return 60 * 60 * 1000;
      case '15M':
        return 15 * 60 * 1000;
      case '5M':
        return 5 * 60 * 1000;
      case '1M':
        return 60 * 1000;
    }
  }
}
