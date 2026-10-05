/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Structural Stop Loss Engine
 *
 * Calculates precise structural stop-loss orders placed strictly beyond the
 * invalidating swing point or order block distal edge, plus an asset-class
 * calibrated minimum structural buffer.
 *
 * Confirms sensible default buffers for ALL 43 canonical Deriv catalog symbols:
 * - 25 Forex pairs (majors, minors, crosses)
 * - 4 Precious Metals (XAU_USD Gold, XAG_USD Silver, XPT_USD Platinum, XPD_USD Palladium)
 * - 12 Equity Indices (OTC_DJI, OTC_SPC, OTC_NDX, OTC_FTSE, OTC_GDAXI, OTC_FCHI,
 *                      OTC_SX5E, OTC_N225, OTC_AS51, OTC_HSI, OTC_AEX, OTC_SSMI)
 * - 2 Cryptocurrencies (BTC_USD Bitcoin, ETH_USD Ethereum)
 *
 * Every stop loss price traces directly to an identified structural level from Phases 2-3.
 */

import { InstrumentSymbol, SMCAnalysisResult } from '../types/smc';
import { getInstrumentConfig } from './instrumentMarketConfiguration';
import {
  InvalidationAnchor,
  InvalidationAnchorType,
  StopLossCalculationRequest,
  StopLossCalculationResult,
} from './structuralStopLossContracts';

export class StructuralStopLossEngine {
  /**
   * Computes the sensible structural protective buffer in price units for any of the 43 catalog symbols.
   */
  public static getStructuralBuffer(symbol: InstrumentSymbol | string): {
    bufferPrice: number;
    bufferPips: number;
  } {
    const config = getInstrumentConfig(symbol);
    const pipSize = config.pipSize;
    const assetClass = config.assetClass;
    const symStr = String(symbol).toUpperCase();

    let bufferPips: number;
    let bufferPrice: number;

    switch (assetClass) {
      case 'FOREX_MAJOR':
      case 'FOREX_MINOR': {
        // Standard forex buffer: 2.0 to 4.0 pips (e.g. 0.00020 - 0.00040, or 0.02 - 0.04 JPY)
        bufferPips = Math.max(2.0, config.volatilityProfile.minStopDistancePips * 0.2);
        bufferPrice = bufferPips * pipSize;
        break;
      }

      case 'COMMODITY_METAL': {
        if (symStr.includes('XPD')) {
          // Palladium (XPD_USD): pipSize = 0.1, 5.0 pips = $0.50
          bufferPips = 5.0;
          bufferPrice = bufferPips * pipSize;
        } else if (symStr.includes('XAU')) {
          // Gold (XAU_USD): pipSize = 0.01, 25 pips = $0.25
          bufferPips = 25.0;
          bufferPrice = bufferPips * pipSize;
        } else if (symStr.includes('XAG')) {
          // Silver (XAG_USD): pipSize = 0.001, 15 pips = $0.015
          bufferPips = 15.0;
          bufferPrice = bufferPips * pipSize;
        } else if (symStr.includes('XPT')) {
          // Platinum (XPT_USD): pipSize = 0.01, 20 pips = $0.20
          bufferPips = 20.0;
          bufferPrice = bufferPips * pipSize;
        } else {
          bufferPips = Math.max(10.0, config.volatilityProfile.minStopDistancePips * 0.25);
          bufferPrice = bufferPips * pipSize;
        }
        break;
      }

      case 'INDEX': {
        // Indices (e.g. OTC_DJI, OTC_NDX, OTC_SPC): 5.0 to 15.0 index points
        if (symStr.includes('DJI') || symStr.includes('NDX')) {
          bufferPrice = 10.0;
          bufferPips = bufferPrice / pipSize;
        } else if (symStr.includes('SPC')) {
          bufferPrice = 3.0;
          bufferPips = bufferPrice / pipSize;
        } else {
          bufferPrice = 5.0;
          bufferPips = bufferPrice / pipSize;
        }
        break;
      }

      case 'CRYPTOCURRENCY': {
        if (symStr.includes('BTC')) {
          // Bitcoin: $25.0 price buffer
          bufferPrice = 25.0;
          bufferPips = bufferPrice / pipSize;
        } else if (symStr.includes('ETH')) {
          // Ethereum: $2.50 price buffer
          bufferPrice = 2.5;
          bufferPips = bufferPrice / pipSize;
        } else {
          bufferPrice = 10.0;
          bufferPips = bufferPrice / pipSize;
        }
        break;
      }

      default: {
        bufferPips = Math.max(2.0, config.volatilityProfile.minStopDistancePips * 0.2);
        bufferPrice = bufferPips * pipSize;
        break;
      }
    }

    // Precision normalization to prevent float anomalies
    const factor = Math.pow(10, config.quotePrecision);
    bufferPrice = Math.round(bufferPrice * factor) / factor;

    return {
      bufferPrice,
      bufferPips: Math.round(bufferPips * 10) / 10,
    };
  }

  /**
   * Calculates the exact structural stop loss beyond the anchor plus buffer.
   */
  public static calculateStopLoss(
    request: StopLossCalculationRequest,
  ): StopLossCalculationResult {
    const { symbol, direction, entryPrice, anchor, manualBufferPips } = request;
    const config = getInstrumentConfig(symbol);

    let bufferPrice: number;
    let bufferPips: number;

    if (manualBufferPips !== undefined && manualBufferPips > 0) {
      bufferPips = manualBufferPips;
      bufferPrice = manualBufferPips * config.pipSize;
    } else {
      const buf = this.getStructuralBuffer(symbol);
      bufferPrice = buf.bufferPrice;
      bufferPips = buf.bufferPips;
    }

    let stopLossPrice: number;
    if (direction === 'LONG') {
      stopLossPrice = anchor.price - bufferPrice;
    } else {
      stopLossPrice = anchor.price + bufferPrice;
    }

    // Round to instrument precision
    const factor = Math.pow(10, config.quotePrecision);
    stopLossPrice = Math.round(stopLossPrice * factor) / factor;

    const riskPerUnit = Math.abs(entryPrice - stopLossPrice);
    const roundedRisk = Math.round(riskPerUnit * factor) / factor;

    const rationale =
      direction === 'LONG'
        ? `Stop loss set below ${anchor.description} (${anchor.price.toFixed(config.quotePrecision)}) minus ${bufferPips} pips (${bufferPrice.toFixed(config.quotePrecision)}) structural buffer`
        : `Stop loss set above ${anchor.description} (${anchor.price.toFixed(config.quotePrecision)}) plus ${bufferPips} pips (${bufferPrice.toFixed(config.quotePrecision)}) structural buffer`;

    return {
      symbol,
      direction,
      entryPrice,
      stopLossPrice,
      rawAnchorLevel: anchor.price,
      anchorType: anchor.type,
      anchorDescription: anchor.description,
      structuralBufferPrice: bufferPrice,
      structuralBufferPips: bufferPips,
      riskPerUnit: roundedRisk,
      rationale,
    };
  }

  /**
   * Derives the invalidating anchor from SMCAnalysisResult and computes structural stop loss.
   */
  public static deriveStopLossFromAnalysis(
    analysisResult: SMCAnalysisResult,
    direction: 'LONG' | 'SHORT',
    entryPrice: number,
  ): StopLossCalculationResult | null {
    const symbol = analysisResult.symbol;

    // 1. Check 5M swing points (immediate structural invalidation)
    const swings5M = analysisResult.lowerTimeframe5M.swingPoints;
    const relevantSwings5M = swings5M.filter((s) =>
      direction === 'LONG' ? s.type === 'SWING_LOW' : s.type === 'SWING_HIGH',
    );

    // 2. Check 5M and 15M Order Blocks
    const targetObType = direction === 'LONG' ? 'BULLISH_OB' : 'BEARISH_OB';
    const obs5M = analysisResult.lowerTimeframe5M.activeOrderBlocks.filter(
      (ob) => ob.type === targetObType,
    );
    const obs15M = analysisResult.intermediateTimeframe15M.orderBlocks.filter(
      (ob) => ob.type === targetObType,
    );

    let anchor: InvalidationAnchor | null = null;

    if (direction === 'LONG') {
      let lowestLow = Infinity;
      let anchorDesc = '';
      let anchorType: InvalidationAnchorType = 'SWING_EXTREME';

      if (relevantSwings5M.length > 0) {
        const lastSwing = relevantSwings5M[relevantSwings5M.length - 1];
        if (lastSwing.price < lowestLow) {
          lowestLow = lastSwing.price;
          anchorDesc = `5M Swing Low [${lastSwing.id}]`;
          anchorType = 'SWING_EXTREME';
        }
      }

      if (obs5M.length > 0) {
        const ob = obs5M[0];
        if (ob.lowPrice < lowestLow) {
          lowestLow = ob.lowPrice;
          anchorDesc = `5M Bullish OB distal low [${ob.id}]`;
          anchorType = 'ORDER_BLOCK_DISTAL_EDGE';
        }
      } else if (obs15M.length > 0) {
        const ob = obs15M[0];
        if (ob.lowPrice < lowestLow) {
          lowestLow = ob.lowPrice;
          anchorDesc = `15M Bullish OB distal low [${ob.id}]`;
          anchorType = 'ORDER_BLOCK_DISTAL_EDGE';
        }
      }

      if (lowestLow !== Infinity) {
        anchor = {
          id: `sl_anchor_${Date.now()}`,
          type: anchorType,
          timeframe: '5M',
          price: lowestLow,
          description: anchorDesc,
        };
      }
    } else {
      // SHORT
      let highestHigh = -Infinity;
      let anchorDesc = '';
      let anchorType: InvalidationAnchorType = 'SWING_EXTREME';

      if (relevantSwings5M.length > 0) {
        const lastSwing = relevantSwings5M[relevantSwings5M.length - 1];
        if (lastSwing.price > highestHigh) {
          highestHigh = lastSwing.price;
          anchorDesc = `5M Swing High [${lastSwing.id}]`;
          anchorType = 'SWING_EXTREME';
        }
      }

      if (obs5M.length > 0) {
        const ob = obs5M[0];
        if (ob.highPrice > highestHigh) {
          highestHigh = ob.highPrice;
          anchorDesc = `5M Bearish OB distal high [${ob.id}]`;
          anchorType = 'ORDER_BLOCK_DISTAL_EDGE';
        }
      } else if (obs15M.length > 0) {
        const ob = obs15M[0];
        if (ob.highPrice > highestHigh) {
          highestHigh = ob.highPrice;
          anchorDesc = `15M Bearish OB distal high [${ob.id}]`;
          anchorType = 'ORDER_BLOCK_DISTAL_EDGE';
        }
      }

      if (highestHigh !== -Infinity) {
        anchor = {
          id: `sl_anchor_${Date.now()}`,
          type: anchorType,
          timeframe: '5M',
          price: highestHigh,
          description: anchorDesc,
        };
      }
    }

    if (!anchor) return null;

    return this.calculateStopLoss({
      symbol,
      direction,
      entryPrice,
      anchor,
    });
  }
}
