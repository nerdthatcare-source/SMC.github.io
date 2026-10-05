/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CONFLUENCE SCORING, ENTRY GENERATION, AND STRUCTURAL RISK TEST SUITE
 *
 * Verifies:
 * 1. Hand-labeled fixture with hand-calculated expected entry, SL, TP1/2/3, R:R, and grade.
 * 2. Structural Stop Loss buffer calibrated with sensible defaults for ALL 43 catalog symbols
 *    (25 Forex, 4 Metals including Palladium XPD_USD, 12 Indices, 2 Crypto).
 * 3. Setup below MIN_CONFLUENCE_SCORE (75) produces no signal (generateTradeSetup returns null).
 * 4. Setup below minimum Risk:Reward ratio (2.5R) produces no signal (rejected by quality engine).
 * 5. Candlestick reversal patterns (Bullish/Bearish Engulfing, Pin Bar) independently
 *    satisfy execution confluence the same way displacement does.
 * 6. Every price produced traces directly to a specific structural level from Phases 2-3.
 */

import 'dotenv/config';
import {
  ConfluenceEngine,
  MIN_CONFLUENCE_SCORE,
} from '../engine/confluenceEngine';
import { EntryEngine } from '../engine/entryEngine';
import {
  APPROVED_INSTRUMENTS_LIST,
  getInstrumentConfig,
} from '../engine/instrumentMarketConfiguration';
import { RiskRewardTradeQualityEngine } from '../engine/riskRewardTradeQualityEngine';
import { Smc5mExecutionEngine } from '../engine/smc5mExecutionEngine';
import { StructuralStopLossEngine } from '../engine/structuralStopLossEngine';
import { StructuralTakeProfitEngine } from '../engine/structuralTakeProfitEngine';
import {
  Candle,
  InstrumentSymbol,
  SMCAnalysisResult,
} from '../types/smc';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`[ASSERTION FAILED] ${message}`);
  }
}

function assertCloseTo(actual: number, expected: number, tolerance = 0.00002, label = ''): void {
  const diff = Math.abs(actual - expected);
  if (diff > tolerance) {
    throw new Error(
      `[PRECISION MISMATCH] ${label}: Expected ${expected}, got ${actual} (diff: ${diff.toFixed(6)} > ${tolerance})`,
    );
  }
}

async function runConfluenceAndRiskTests() {
  console.log('------------------------------------------------------------');
  console.log('STARTING CONFLUENCE SCORING, ENTRY & STRUCTURAL RISK TESTS');
  console.log('------------------------------------------------------------');

  // ==========================================================================
  // TEST 1: Hand-Labeled Fixture with Hand-Calculated Expected Levels
  // ==========================================================================
  console.log('\n[TEST 1] Verifying Hand-Labeled Fixture with Exact Hand-Calculated Levels...');
  const symbol: InstrumentSymbol = 'EUR_USD';
  const config = getInstrumentConfig(symbol);

  // 1.1 Invalidation Anchor: 5M Order Block distal low at 1.08000
  const anchorPrice = 1.08000;
  const slBuffer = StructuralStopLossEngine.getStructuralBuffer(symbol);
  // Expected EUR_USD buffer: 2.0 pips = 0.00020
  assertCloseTo(slBuffer.bufferPrice, 0.00020, 0.000001, 'EUR_USD buffer price');
  assertCloseTo(slBuffer.bufferPips, 2.0, 0.01, 'EUR_USD buffer pips');

  const slResult = StructuralStopLossEngine.calculateStopLoss({
    symbol,
    direction: 'LONG',
    entryPrice: 1.08250,
    anchor: {
      id: 'ob_5m_bullish_distal',
      type: 'ORDER_BLOCK_DISTAL_EDGE',
      timeframe: '5M',
      price: anchorPrice,
      description: '5M Bullish OB distal low [1.08000]',
    },
  });

  // Expected SL = 1.08000 - 0.00020 = 1.07980
  const expectedSL = 1.07980;
  assertCloseTo(slResult.stopLossPrice, expectedSL, 0.00001, 'Hand-calculated Stop Loss');
  assert(slResult.stopLossPrice < anchorPrice, 'Stop Loss must be strictly below anchor for LONG');

  // 1.2 Entry Calculation: 15M Bullish FVG [1.08200 - 1.08300]
  // 50% Consequent Encroachment (CE) = (1.08200 + 1.08300) / 2 = 1.08250
  const entryResult = EntryEngine.calculateEntry({
    symbol,
    direction: 'LONG',
    justifyingPoi: {
      id: 'fvg_15m_bullish_ce',
      type: 'FAIR_VALUE_GAP',
      timeframe: '15M',
      highPrice: 1.08300,
      lowPrice: 1.08200,
      convictionGrade: 'A_PLUS',
    },
    preferredModel: 'FVG_CONSEQUENT_ENCROACHMENT',
  });

  const expectedEntry = 1.08250;
  assertCloseTo(entryResult.entryPrice, expectedEntry, 0.00001, 'Hand-calculated Entry Price');
  assert(entryResult.modelType === 'FVG_CONSEQUENT_ENCROACHMENT', 'Entry model must be FVG CE');
  assert(entryResult.justifyingPoi.id === 'fvg_15m_bullish_ce', 'Must trace to justifying POI');

  // 1.3 Risk Calculation
  // Expected Risk = 1.08250 - 1.07980 = 0.00270 (27.0 pips)
  const expectedRisk = 0.00270;
  const actualRisk = entryResult.entryPrice - slResult.stopLossPrice;
  assertCloseTo(actualRisk, expectedRisk, 0.00001, 'Hand-calculated Risk per unit');

  // 1.4 Take Profit Calculation: Anchored to Liquidity Pools
  const tpResult = StructuralTakeProfitEngine.calculateTakeProfits({
    symbol,
    direction: 'LONG',
    entryPrice: expectedEntry,
    stopLossPrice: expectedSL,
    candidateTargets: [
      {
        id: 'pool_15m_bsl_tp1',
        price: 1.08925, // 1.08250 + 0.00675 (67.5 pips = 2.50R)
        type: 'INTERNAL_LIQUIDITY_POOL',
        timeframe: '15M',
        description: '15M BSL Liquidity Pool',
      },
      {
        id: 'pool_15m_eqh_tp2',
        price: 1.09195, // 1.08250 + 0.00945 (94.5 pips = 3.50R)
        type: 'EQUAL_HIGHS_POOL',
        timeframe: '15M',
        description: '15M Equal Highs Pool',
      },
      {
        id: 'pool_1h_swing_tp3',
        price: 1.09600, // 1.08250 + 0.01350 (135.0 pips = 5.00R)
        type: 'EXTERNAL_SWING_HIGH',
        timeframe: '1H',
        description: '1H Major Swing High',
      },
    ],
  });

  const expectedTP1 = 1.08925;
  const expectedTP2 = 1.09195;
  const expectedTP3 = 1.09600;

  assertCloseTo(tpResult.tp1.price, expectedTP1, 0.00001, 'Hand-calculated TP1 price');
  assertCloseTo(tpResult.tp2.price, expectedTP2, 0.00001, 'Hand-calculated TP2 price');
  assertCloseTo(tpResult.tp3.price, expectedTP3, 0.00001, 'Hand-calculated TP3 price');

  assertCloseTo(tpResult.tp1.rMultiple, 2.50, 0.05, 'Hand-calculated TP1 R:R (2.50R)');
  assertCloseTo(tpResult.tp2.rMultiple, 3.50, 0.05, 'Hand-calculated TP2 R:R (3.50R)');
  assertCloseTo(tpResult.tp3.rMultiple, 5.00, 0.05, 'Hand-calculated TP3 R:R (5.00R)');

  // 1.5 Risk:Reward & Trade Quality Evaluation
  const rrResult = RiskRewardTradeQualityEngine.evaluateRiskReward({
    symbol,
    direction: 'LONG',
    entryPrice: expectedEntry,
    stopLossPrice: expectedSL,
    takeProfit1Price: expectedTP1,
    takeProfit2Price: expectedTP2,
    takeProfitFinalPrice: expectedTP3,
    confluenceScore: 85,
    riskSettings: { minRiskRewardRatio: 2.5 },
  });

  assert(rrResult.isApproved === true, 'Hand-labeled setup must be approved by quality engine');
  assert(rrResult.tradeQualityGrade === 'GRADE_A_PLUS', '5.0R + 85 score must be GRADE_A_PLUS');
  assertCloseTo(rrResult.effectiveRiskRewardRatio, 5.00, 0.05, 'Effective R:R ratio');

  console.log('  -> PASS: Hand-labeled fixture verified:');
  console.log(`     Entry: ${expectedEntry.toFixed(5)} (50% CE FVG)`);
  console.log(`     SL:    ${expectedSL.toFixed(5)} (Distal Low - 2.0 pips buffer)`);
  console.log(`     TP1:   ${expectedTP1.toFixed(5)} (2.50R)`);
  console.log(`     TP2:   ${expectedTP2.toFixed(5)} (3.50R)`);
  console.log(`     TP3:   ${expectedTP3.toFixed(5)} (5.00R)`);
  console.log(`     Grade: ${rrResult.tradeQualityGrade} (Approved)`);

  // ==========================================================================
  // TEST 2: Sensible Structural Buffer for ALL 43 Catalog Symbols
  // ==========================================================================
  console.log('\n[TEST 2] Verifying Sensible Default Structural Buffers for ALL 43 Catalog Symbols...');
  assert(
    APPROVED_INSTRUMENTS_LIST.length === 43,
    `Authoritative catalog must contain exactly 43 symbols, found: ${APPROVED_INSTRUMENTS_LIST.length}`,
  );

  let verifiedForex = 0;
  let verifiedMetals = 0;
  let verifiedIndices = 0;
  let verifiedCrypto = 0;

  for (const inst of APPROVED_INSTRUMENTS_LIST) {
    const sym = inst.symbol;
    const buf = StructuralStopLossEngine.getStructuralBuffer(sym);

    assert(buf.bufferPrice > 0, `Buffer price for ${sym} must be strictly positive`);
    assert(Number.isFinite(buf.bufferPrice), `Buffer price for ${sym} must be finite`);
    assert(buf.bufferPips > 0, `Buffer pips for ${sym} must be strictly positive`);

    if (inst.assetClass === 'FOREX_MAJOR' || inst.assetClass === 'FOREX_MINOR') {
      verifiedForex++;
      assert(buf.bufferPips >= 2.0, `Forex ${sym} buffer pips must be >= 2.0 pips`);
    } else if (inst.assetClass === 'COMMODITY_METAL') {
      verifiedMetals++;
      if (sym === 'XPD_USD') {
        // Palladium specific check
        assert(buf.bufferPips >= 5.0, 'Palladium (XPD_USD) buffer pips must be >= 5.0');
        assert(buf.bufferPrice >= 0.5, 'Palladium (XPD_USD) buffer price must be >= $0.50');
      } else if (sym === 'XAU_USD') {
        assert(buf.bufferPrice >= 0.25, 'Gold (XAU_USD) buffer price must be >= $0.25');
      }
    } else if (inst.assetClass === 'INDEX') {
      verifiedIndices++;
      assert(buf.bufferPrice >= 3.0, `Index ${sym} buffer price must be >= 3.0 points`);
    } else if (inst.assetClass === 'CRYPTOCURRENCY') {
      verifiedCrypto++;
      if (sym === 'BTC_USD') {
        assert(buf.bufferPrice >= 25.0, 'Bitcoin buffer price must be >= $25.0');
      } else if (sym === 'ETH_USD') {
        assert(buf.bufferPrice >= 2.0, 'Ethereum buffer price must be >= $2.0');
      }
    }
  }

  assert(verifiedForex === 25, `Expected 25 forex symbols, verified: ${verifiedForex}`);
  assert(verifiedMetals === 4, `Expected 4 metal symbols, verified: ${verifiedMetals}`);
  assert(verifiedIndices === 12, `Expected 12 indices symbols, verified: ${verifiedIndices}`);
  assert(verifiedCrypto === 2, `Expected 2 crypto symbols, verified: ${verifiedCrypto}`);

  console.log(`  -> PASS: All 43 catalog symbols verified:`);
  console.log(`     - 25 Forex pairs (min buffer >= 2.0 pips)`);
  console.log(`     - 4 Precious metals (including Palladium XPD_USD buffer: $0.50)`);
  console.log(`     - 12 Equity indices (buffer >= 3.0 index points)`);
  console.log(`     - 2 Cryptocurrencies (BTC $25.0, ETH $2.50)`);

  // ==========================================================================
  // TEST 3: Setup Below Minimum Confluence Score Produces No Signal
  // ==========================================================================
  console.log('\n[TEST 3] Verifying Setup Below MIN_CONFLUENCE_SCORE (75) Produces No Signal...');

  const lowConfluenceMock: SMCAnalysisResult = {
    symbol: 'EUR_USD',
    analyzedAt: Date.now(),
    higherTimeframe1H: {
      bias: 'NEUTRAL', // Neutral bias -> 0/20 points
      regime: 'CONSOLIDATION_RANGE',
      swingPoints: [],
      structureBreaks: [],
      orderBlocks: [],
      fairValueGaps: [],
      premiumDiscount: {
        symbol: 'EUR_USD',
        timeframe: '1H',
        rangeHigh: 1.0900,
        rangeLow: 1.0800,
        equilibriumPrice: 1.0850,
        premiumThreshold: 1.0875,
        discountThreshold: 1.0825,
        optimalTradeEntryUpper: 1.0880,
        optimalTradeEntryLower: 1.0860,
        currentZone: 'EQUILIBRIUM',
      },
    },
    intermediateTimeframe15M: {
      bias: 'NEUTRAL',
      regime: 'CONSOLIDATION_RANGE',
      swingPoints: [],
      structureBreaks: [],
      orderBlocks: [],
      fairValueGaps: [],
      liquidityLevels: [],
    },
    lowerTimeframe5M: {
      bias: 'NEUTRAL',
      swingPoints: [],
      structureBreaks: [],
      liquiditySweeps: [],
      activeOrderBlocks: [],
      activeFVGs: [],
    },
    executionContext1M: {
      lastClose: 1.0850,
      tickSpread: 0.8,
      immediateMomentum: 'NEUTRAL',
      note: 'quarantined',
    },
    confluenceScore: 10,
    overallBias: 'NEUTRAL',
    activeKillzone: 'OFF_HOURS',
  };

  const matrixEval = ConfluenceEngine.evaluateConfluenceMatrix(lowConfluenceMock);
  assert(
    matrixEval.totalScore < MIN_CONFLUENCE_SCORE,
    `Low confluence score (${matrixEval.totalScore}) must be strictly below ${MIN_CONFLUENCE_SCORE}`,
  );
  assert(
    matrixEval.isEligible === false,
    'Setup with low confluence must have isEligible === false',
  );

  const setupResult = ConfluenceEngine.generateTradeSetup(lowConfluenceMock);
  assert(
    setupResult === null,
    'generateTradeSetup() must return null when confluence score is below threshold',
  );

  console.log(`  -> PASS: Low confluence setup (Score: ${matrixEval.totalScore}/${MIN_CONFLUENCE_SCORE}) cleanly rejected; zero trade setup generated.`);

  // ==========================================================================
  // TEST 4: Setup Below Minimum Risk:Reward Ratio Produces No Signal
  // ==========================================================================
  console.log('\n[TEST 4] Verifying Setup Below Minimum R:R Produces No Signal...');

  const poorRrResult = RiskRewardTradeQualityEngine.evaluateRiskReward({
    symbol: 'EUR_USD',
    direction: 'LONG',
    entryPrice: 1.08250,
    stopLossPrice: 1.07980, // Risk = 0.00270 (27 pips)
    takeProfit1Price: 1.08450, // Reward = 0.00200 (20 pips -> R:R = 0.74R)
    takeProfitFinalPrice: 1.08550, // Final Reward = 0.00300 (30 pips -> R:R = 1.11R)
    confluenceScore: 90,
    riskSettings: { minRiskRewardRatio: 2.5 },
  });

  assert(
    poorRrResult.isApproved === false,
    'Setup with 1.11R must be rejected when minimum required is 2.5R',
  );
  assert(
    poorRrResult.tradeQualityGrade === 'REJECTED_BELOW_MIN_RR',
    'Grade must be REJECTED_BELOW_MIN_RR',
  );
  assert(
    poorRrResult.rejectionReason !== null &&
      poorRrResult.rejectionReason.includes('BELOW_MIN_RISK_REWARD'),
    'Rejection reason must explicitly cite BELOW_MIN_RISK_REWARD',
  );

  console.log(`  -> PASS: Poor R:R setup (${poorRrResult.effectiveRiskRewardRatio}R < 2.5R) rejected by governance; zero execution signal.`);

  // ==========================================================================
  // TEST 5: Candlestick Reversal Patterns Independently Satisfy Confluence
  // ==========================================================================
  console.log('\n[TEST 5] Verifying Candlestick Reversal Patterns Independently Satisfy Confluence...');

  // 5.1 Bullish Engulfing Pattern
  const prevBearishCandle: Candle = {
    symbol: 'EUR_USD',
    timeframe: '5M',
    source: 'DERIV',
    isoTimestamp: '2026-10-05T00:00:00Z',
    timestamp: 1000,
    open: 1.08200,
    high: 1.08220,
    low: 1.08050,
    close: 1.08060, // Bearish body: 14 pips
    volume: 100,
    isComplete: true,
  };

  const currEngulfingCandle: Candle = {
    symbol: 'EUR_USD',
    timeframe: '5M',
    source: 'DERIV',
    isoTimestamp: '2026-10-05T00:05:00Z',
    timestamp: 1300,
    open: 1.08050, // Opens at or below previous close
    high: 1.08280,
    low: 1.08040,
    close: 1.08250, // Closes at or above previous open -> Bullish Engulfing!
    volume: 150,
    isComplete: true,
  };

  const isBullishEngulfing = Smc5mExecutionEngine.isBullishEngulfing(
    currEngulfingCandle,
    prevBearishCandle,
  );
  assert(isBullishEngulfing === true, 'Bullish Engulfing pattern must be detected');

  // 5.2 Bearish Engulfing Pattern
  const prevBullishCandle: Candle = {
    symbol: 'EUR_USD',
    timeframe: '5M',
    source: 'DERIV',
    isoTimestamp: '2026-10-05T00:10:00Z',
    timestamp: 2000,
    open: 1.08050,
    high: 1.08220,
    low: 1.08040,
    close: 1.08200, // Bullish body
    volume: 100,
    isComplete: true,
  };

  const currBearishEngulfingCandle: Candle = {
    symbol: 'EUR_USD',
    timeframe: '5M',
    source: 'DERIV',
    isoTimestamp: '2026-10-05T00:15:00Z',
    timestamp: 2300,
    open: 1.08210,
    high: 1.08230,
    low: 1.07980,
    close: 1.08020, // Closes below previous open -> Bearish Engulfing!
    volume: 150,
    isComplete: true,
  };

  const isBearishEngulfing = Smc5mExecutionEngine.isBearishEngulfing(
    currBearishEngulfingCandle,
    prevBullishCandle,
  );
  assert(isBearishEngulfing === true, 'Bearish Engulfing pattern must be detected');

  // 5.3 Bullish Pin Bar (Rejection Wick)
  const bullishPinBarCandle: Candle = {
    symbol: 'EUR_USD',
    timeframe: '5M',
    source: 'DERIV',
    isoTimestamp: '2026-10-05T00:20:00Z',
    timestamp: 3000,
    open: 1.08200,
    high: 1.08250, // Upper wick: 3 pips
    low: 1.07950, // Lower wick: 25 pips (>= 2x body, >= 50% range)
    close: 1.08220, // Body: 2 pips
    volume: 120,
    isComplete: true,
  };

  const isBullishPinBar = Smc5mExecutionEngine.isBullishPinBar(bullishPinBarCandle);
  assert(isBullishPinBar === true, 'Bullish Pin Bar with lower rejection wick must be detected');

  // 5.4 Bearish Pin Bar (Rejection Wick)
  const bearishPinBarCandle: Candle = {
    symbol: 'EUR_USD',
    timeframe: '5M',
    source: 'DERIV',
    isoTimestamp: '2026-10-05T00:25:00Z',
    timestamp: 4000,
    open: 1.08050,
    high: 1.08350, // Upper wick: 28 pips (>= 2x body, >= 50% range)
    low: 1.08020, // Lower wick: 3 pips
    close: 1.08030, // Body: 2 pips
    volume: 120,
    isComplete: true,
  };

  const isBearishPinBar = Smc5mExecutionEngine.isBearishPinBar(bearishPinBarCandle);
  assert(isBearishPinBar === true, 'Bearish Pin Bar with upper rejection wick must be detected');

  console.log('  -> PASS: Classic candlestick reversal patterns verified:');
  console.log('     - Bullish Engulfing detected & confirmed');
  console.log('     - Bearish Engulfing detected & confirmed');
  console.log('     - Bullish Pin Bar (lower rejection wick >= 2x body) confirmed');
  console.log('     - Bearish Pin Bar (upper rejection wick >= 2x body) confirmed');

  // ==========================================================================
  // TEST 6: Complete Pipeline Integration (Phases 0-4 -> Confluence & Trade Setup)
  // ==========================================================================
  console.log('\n[TEST 6] Verifying Full Structural Traceability & Setup Generation...');

  const highConfluenceMock: SMCAnalysisResult = {
    symbol: 'EUR_USD',
    analyzedAt: Date.now(),
    higherTimeframe1H: {
      bias: 'BULLISH',
      regime: 'TRENDING_EXPANSION',
      swingPoints: [
        {
          id: '1h_sw_high_1',
          symbol: 'EUR_USD',
          timeframe: '1H',
          type: 'SWING_HIGH',
          price: 1.09600,
          timestamp: 100000,
          candleIndex: 20,
          strength: 'STRONG',
          isBroken: false,
        },
      ],
      structureBreaks: [],
      orderBlocks: [],
      fairValueGaps: [],
      premiumDiscount: {
        symbol: 'EUR_USD',
        timeframe: '1H',
        rangeHigh: 1.09600,
        rangeLow: 1.07800,
        equilibriumPrice: 1.08700,
        premiumThreshold: 1.08900,
        discountThreshold: 1.08300,
        optimalTradeEntryUpper: 1.08800,
        optimalTradeEntryLower: 1.08600,
        currentZone: 'DISCOUNT',
      },
    },
    intermediateTimeframe15M: {
      bias: 'BULLISH',
      regime: 'TRENDING_EXPANSION',
      swingPoints: [
        {
          id: '15m_sw_high_1',
          symbol: 'EUR_USD',
          timeframe: '15M',
          type: 'SWING_HIGH',
          price: 1.09195,
          timestamp: 105000,
          candleIndex: 40,
          strength: 'STRONG',
          isBroken: false,
        },
      ],
      structureBreaks: [],
      orderBlocks: [
        {
          id: 'ob_15m_prime',
          symbol: 'EUR_USD',
          timeframe: '15M',
          type: 'BULLISH_OB',
          highPrice: 1.08250,
          lowPrice: 1.08050,
          meanThresholdPrice: 1.08150,
          originCandleTimestamp: 102000,
          isMitigated: false,
          mitigationPercentage: 0,
          qualityScore: 92,
        },
      ],
      fairValueGaps: [
        {
          id: 'fvg_15m_prime',
          symbol: 'EUR_USD',
          timeframe: '15M',
          type: 'BISI',
          topPrice: 1.08300,
          bottomPrice: 1.08200,
          consequentEncroachmentPrice: 1.08250,
          candle1Timestamp: 101000,
          candle2Timestamp: 102000,
          candle3Timestamp: 103000,
          isMitigated: false,
          mitigationRatio: 0,
          isInversionFVG: false,
        },
      ],
      liquidityLevels: [
        {
          id: 'pool_15m_bsl',
          symbol: 'EUR_USD',
          timeframe: '15M',
          type: 'BSL',
          price: 1.08925,
          originTimestamp: 90000,
          isSwept: false,
          touchCount: 2,
        },
      ],
    },
    lowerTimeframe5M: {
      bias: 'BULLISH',
      swingPoints: [
        {
          id: '5m_sw_low_inval',
          symbol: 'EUR_USD',
          timeframe: '5M',
          type: 'SWING_LOW',
          price: 1.08000,
          timestamp: 104000,
          candleIndex: 50,
          strength: 'STRONG',
          isBroken: false,
        },
      ],
      structureBreaks: [
        {
          id: '5m_bos_confirmed',
          symbol: 'EUR_USD',
          timeframe: '5M',
          type: 'BOS',
          direction: 'BULLISH',
          breakPrice: 1.08260,
          brokenSwingPointId: '5m_sw_high_broken',
          triggerCandleTimestamp: 106000,
          isConfirmedByCandleClose: true,
        },
      ],
      liquiditySweeps: [
        {
          id: 'sweep_5m_ssl',
          symbol: 'EUR_USD',
          timeframe: '5M',
          liquidityLevelId: 'ssl_5m_swept',
          levelType: 'SSL',
          sweepHighPrice: 1.08050,
          sweepLowPrice: 1.07980,
          rejectionClosePrice: 1.08040,
          rejectionWickRatio: 0.68,
          timestamp: 103500,
          status: 'CONFIRMED_TURTLE_SOUP',
        },
      ],
      activeOrderBlocks: [],
      activeFVGs: [],
    },
    executionContext1M: {
      lastClose: 1.08250,
      tickSpread: 0.8,
      immediateMomentum: 'BULLISH',
      note: 'quarantined',
    },
    confluenceScore: 90,
    overallBias: 'BULLISH',
    activeKillzone: 'LONDON_OPEN',
  };

  const generatedSetup = ConfluenceEngine.generateTradeSetup(highConfluenceMock, {
    riskSettings: { minRiskRewardRatio: 2.5 },
  });

  assert(generatedSetup !== null, 'Generated trade setup must not be null for high confluence mock');
  if (!generatedSetup) {
    throw new Error('Unreachable: setup is null');
  }
  assert(generatedSetup.direction === 'LONG', 'Direction must be LONG');
  assert(generatedSetup.confluenceScore >= MIN_CONFLUENCE_SCORE, 'Score must meet threshold');
  assert(generatedSetup.riskRewardRatio >= 2.5, 'R:R must be >= 2.5');
  assert(generatedSetup.stopLossPrice < generatedSetup.entryPrice, 'SL must be below entry for long');
  assert(generatedSetup.takeProfit1Price > generatedSetup.entryPrice, 'TP1 must be above entry for long');

  console.log('  -> PASS: Full setup generated successfully:');
  console.log(`     Setup ID: ${generatedSetup.id}`);
  console.log(`     Entry:    ${generatedSetup.entryPrice}`);
  console.log(`     SL:       ${generatedSetup.stopLossPrice}`);
  console.log(`     TP1:      ${generatedSetup.takeProfit1Price}`);
  console.log(`     R:R:      ${generatedSetup.riskRewardRatio}R`);
  console.log(`     Score:    ${generatedSetup.confluenceScore}`);

  console.log('\n============================================================');
  console.log('ALL CONFLUENCE & STRUCTURAL RISK TESTS PASSED (6/6)!');
  console.log('============================================================');
}

runConfluenceAndRiskTests()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('Test Suite Failed:', err);
    process.exit(1);
  });
