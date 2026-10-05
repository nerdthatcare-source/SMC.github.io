/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Entry Calculation Engine
 *
 * Computes exact institutional entry prices derived directly from Phase 3 POIs:
 * - FVG Consequent Encroachment (CE: 50% midpoint)
 * - FVG Proximal Edge
 * - Order Block Proximal Edge
 * - Order Block Mean Threshold (MT: 50% midpoint)
 * - Liquidity Sweep Retest Level
 *
 * Every calculated price traces directly to an identified structural level from Phases 2-3.
 */

import { InstrumentSymbol, SMCAnalysisResult } from '../types/smc';
import {
  EntryCalculationRequest,
  EntryCalculationResult,
  EntryModelType,
  JustifyingPoiContract,
} from './entryContracts';

export class EntryEngine {
  /**
   * Calculates the exact entry price from a typed POI contract.
   */
  public static calculateEntry(
    request: EntryCalculationRequest,
  ): EntryCalculationResult {
    const { symbol, direction, justifyingPoi, preferredModel } = request;
    const { highPrice, lowPrice, type } = justifyingPoi;

    let modelType: EntryModelType;
    let entryPrice: number;
    let referenceLevel: number;
    let rationale: string;

    if (type === 'FAIR_VALUE_GAP') {
      const ceMidpoint = (highPrice + lowPrice) / 2;
      const proximalEdge = direction === 'LONG' ? highPrice : lowPrice;

      if (preferredModel === 'FVG_PROXIMAL_EDGE') {
        modelType = 'FVG_PROXIMAL_EDGE';
        entryPrice = proximalEdge;
        referenceLevel = proximalEdge;
        rationale = `Entry at proximal boundary of ${justifyingPoi.timeframe} FVG [${lowPrice.toFixed(5)} - ${highPrice.toFixed(5)}]`;
      } else {
        modelType = 'FVG_CONSEQUENT_ENCROACHMENT';
        entryPrice = ceMidpoint;
        referenceLevel = ceMidpoint;
        rationale = `Entry at 50% Consequent Encroachment (CE) of ${justifyingPoi.timeframe} FVG [${lowPrice.toFixed(5)} - ${highPrice.toFixed(5)}]`;
      }
    } else if (type === 'ORDER_BLOCK') {
      const proximalEdge = direction === 'LONG' ? highPrice : lowPrice;
      const meanThreshold = (highPrice + lowPrice) / 2;

      if (preferredModel === 'ORDER_BLOCK_MEAN_THRESHOLD') {
        modelType = 'ORDER_BLOCK_MEAN_THRESHOLD';
        entryPrice = meanThreshold;
        referenceLevel = meanThreshold;
        rationale = `Entry at 50% Mean Threshold (MT) of ${justifyingPoi.timeframe} Order Block [${lowPrice.toFixed(5)} - ${highPrice.toFixed(5)}]`;
      } else {
        modelType = 'ORDER_BLOCK_PROXIMAL_EDGE';
        entryPrice = proximalEdge;
        referenceLevel = proximalEdge;
        rationale = `Entry at proximal edge of ${justifyingPoi.timeframe} Order Block [${lowPrice.toFixed(5)} - ${highPrice.toFixed(5)}]`;
      }
    } else {
      // Liquidity pool / structural retest
      modelType = 'LIQUIDITY_SWEEP_RETEST';
      referenceLevel = direction === 'LONG' ? lowPrice : highPrice;
      entryPrice = referenceLevel;
      rationale = `Entry at swept structural level retest (${referenceLevel.toFixed(5)})`;
    }

    return {
      symbol,
      direction,
      entryPrice,
      modelType,
      justifyingPoi,
      structuralTraceLevel: referenceLevel,
      rationale,
    };
  }

  /**
   * Helper extracting the active setup POI from SMCAnalysisResult and computing entry.
   */
  public static deriveEntryFromAnalysis(
    analysisResult: SMCAnalysisResult,
    direction: 'LONG' | 'SHORT',
    preferredModel?: EntryModelType,
  ): EntryCalculationResult | null {
    const symbol = analysisResult.symbol;

    const targetObType = direction === 'LONG' ? 'BULLISH_OB' : 'BEARISH_OB';
    const targetFvgType = direction === 'LONG' ? 'BISI' : 'SIBI';

    // 1. Check for 15M active POIs aligned with trade direction
    const active15mObs = analysisResult.intermediateTimeframe15M.orderBlocks.filter(
      (ob) => !ob.isMitigated && ob.type === targetObType,
    );
    const active15mFvgs = analysisResult.intermediateTimeframe15M.fairValueGaps.filter(
      (fvg) => !fvg.isMitigated && fvg.type === targetFvgType,
    );

    // 2. Check 5M active POIs
    const active5mObs = analysisResult.lowerTimeframe5M.activeOrderBlocks.filter(
      (ob) => !ob.isMitigated && ob.type === targetObType,
    );
    const active5mFvgs = analysisResult.lowerTimeframe5M.activeFVGs.filter(
      (fvg) => !fvg.isMitigated && fvg.type === targetFvgType,
    );

    let justifyingPoi: JustifyingPoiContract | null = null;

    // Prefer 5M newly formed POIs in retracement, then 15M MTF POIs
    if (active5mFvgs.length > 0) {
      const fvg = active5mFvgs[0];
      justifyingPoi = {
        id: fvg.id,
        type: 'FAIR_VALUE_GAP',
        timeframe: '5M',
        highPrice: fvg.topPrice,
        lowPrice: fvg.bottomPrice,
      };
    } else if (active5mObs.length > 0) {
      const ob = active5mObs[0];
      justifyingPoi = {
        id: ob.id,
        type: 'ORDER_BLOCK',
        timeframe: '5M',
        highPrice: ob.highPrice,
        lowPrice: ob.lowPrice,
      };
    } else if (active15mFvgs.length > 0) {
      const fvg = active15mFvgs[0];
      justifyingPoi = {
        id: fvg.id,
        type: 'FAIR_VALUE_GAP',
        timeframe: '15M',
        highPrice: fvg.topPrice,
        lowPrice: fvg.bottomPrice,
      };
    } else if (active15mObs.length > 0) {
      const ob = active15mObs[0];
      justifyingPoi = {
        id: ob.id,
        type: 'ORDER_BLOCK',
        timeframe: '15M',
        highPrice: ob.highPrice,
        lowPrice: ob.lowPrice,
      };
    } else {
      // Fallback: use 5M structure break price or swing point
      const swings = analysisResult.lowerTimeframe5M.swingPoints;
      const relevantSwings = swings.filter((s) =>
        direction === 'LONG' ? s.type === 'SWING_LOW' : s.type === 'SWING_HIGH',
      );
      if (relevantSwings.length > 0) {
        const sw = relevantSwings[relevantSwings.length - 1];
        justifyingPoi = {
          id: sw.id,
          type: 'LIQUIDITY_POOL',
          timeframe: '5M',
          highPrice: sw.price,
          lowPrice: sw.price,
        };
      }
    }

    if (!justifyingPoi) return null;

    return this.calculateEntry({
      symbol,
      direction,
      justifyingPoi,
      preferredModel,
    });
  }
}
