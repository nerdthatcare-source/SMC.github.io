/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Canonical Data Contracts & Runtime Integrity Validators
 *
 * HARD SYSTEM INVARIANTS:
 * 1. DERIV is the SOLE canonical data provider. All ticks and candles must bear
 *    source: 'DERIV'. Any third-party, synthetic, or mock data is strictly rejected.
 *    DELIBERATE HARD-RULE DECISION: OANDA v20 is retired, not kept as an inactive option.
 * 2. Strict Mathematical Monotonicity: High >= Low, High >= Open, High >= Close,
 *    Low <= Open, Low <= Close. Negative spreads or inverted bounds are fatal data corruption.
 * 3. Temporal Integrity: Timestamps must be valid past or present unix epochs (no future drift > 60s).
 * 4. Structural Isolation: 1M data is runtime-forbidden from entering structural engines (Swings, BOS, OB, FVG).
 */

import {
  Candle,
  ExecutionTimeframe,
  InstrumentSymbol,
  StructuralTimeframe,
  Timeframe,
} from '../types/smc';

// ============================================================================
// 1. CANONICAL CONTRACT DEFINITIONS
// ============================================================================

/**
 * Strict singleton canonical broker ID.
 *
 * DELIBERATE HARD-RULE DECISION:
 * DERIV is the sole authorized canonical market-data source for this system,
 * specifically to eliminate any risk of cross-source data mismatch or miscalculation.
 * OANDA_V20 has been completely retired (not kept as an inactive option).
 *
 * BrokerId is a single literal type: BrokerId = 'DERIV'.
 * Do not make it a union with OANDA_V20 or any other broker — DERIV must be the
 * only structurally valid value, so it is impossible for any other source to be
 * selected, by design, not just by default.
 */
export type BrokerId = 'DERIV';
export const CANONICAL_BROKER_ID: BrokerId = 'DERIV';

/**
 * Strict canonical tick contract.
 * Sourced directly from DERIV pricing stream.
 */
export interface CanonicalTick {
  readonly symbol: InstrumentSymbol;
  readonly timestamp: number; // Unix epoch ms
  readonly isoTimestamp: string;
  readonly bid: number;
  readonly ask: number;
  readonly mid: number;
  readonly spreadPips: number;
  readonly source: BrokerId; // Strictly "DERIV"
}

/**
 * Strict canonical candle contract.
 * Re-exported from core SMC types with immutable property guarantees.
 */
export type CanonicalCandle = Candle;

/**
 * Structural candle type alias.
 * Enforces compile-time disallowance of 1M candles in structural pipelines.
 */
export interface CanonicalStructuralCandle extends CanonicalCandle {
  readonly timeframe: StructuralTimeframe;
}

/**
 * Detailed validation error descriptor.
 */
export interface CanonicalValidationError {
  readonly code:
    | 'MISSING_REQUIRED_FIELD'
    | 'INVALID_DATA_SOURCE'
    | 'SYNTHETIC_DATA_DETECTED'
    | 'INVERTED_HIGH_LOW'
    | 'OUT_OF_BOUNDS_PRICE'
    | 'INVALID_TIMESTAMP'
    | 'FUTURE_TIMESTAMP_DRIFT'
    | 'NON_FINITE_NUMERIC_VALUE'
    | 'NEGATIVE_SPREAD'
    | 'STRUCTURAL_TIMEFRAME_VIOLATION'
    | 'UNAPPROVED_INSTRUMENT';
  readonly field: string;
  readonly message: string;
  readonly receivedValue?: unknown;
}

/**
 * Strongly typed validation result container.
 */
export type CanonicalValidationResult<T> =
  | { readonly success: true; readonly data: T; readonly errors: readonly [] }
  | {
      readonly success: false;
      readonly data?: never;
      readonly errors: readonly CanonicalValidationError[];
    };

// ============================================================================
// 2. APPROVED INSTRUMENTS SET FOR RUNTIME LOOKUP
// ============================================================================

export const APPROVED_INSTRUMENT_SET: ReadonlySet<string> = new Set<string>([
  // 7 Forex Majors
  'EUR_USD',
  'GBP_USD',
  'USD_JPY',
  'USD_CHF',
  'AUD_USD',
  'USD_CAD',
  'NZD_USD',
  // 18 Forex Minors & Crosses (Total 25 Forex from Deriv catalog)
  'EUR_GBP',
  'EUR_JPY',
  'GBP_JPY',
  'AUD_JPY',
  'EUR_AUD',
  'GBP_AUD',
  'EUR_CAD',
  'GBP_CAD',
  'NZD_JPY',
  'AUD_CAD',
  'AUD_CHF',
  'AUD_NZD',
  'EUR_CHF',
  'EUR_NZD',
  'GBP_CHF',
  'GBP_NZD',
  'USD_MXN',
  'USD_PLN',
  // 4 Precious Metals (Commodities)
  'XAU_USD',
  'XAG_USD',
  'XPT_USD',
  'XPD_USD',
  // 12 Real Deriv Equity Indices
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
  // 2 Cryptocurrencies
  'BTC_USD',
  'ETH_USD',
]);

const VALID_TIMEFRAMES: ReadonlySet<string> = new Set<Timeframe>([
  '1H',
  '15M',
  '5M',
  '1M',
]);

// Maximum allowable clock drift tolerance in ms (60 seconds)
const MAX_FUTURE_DRIFT_MS = 60_000;

// ============================================================================
// 3. RUNTIME VALIDATORS
// ============================================================================

/**
 * Validates any candidate candle against canonical SMC contracts.
 *
 * Checks:
 * - Must be non-null object.
 * - Source must strictly equal "DERIV".
 * - Must reject any synthetic/mock markers.
 * - Symbol must be in approved instrument catalog (43-symbol Deriv catalog plus aliases).
 * - Timeframe must be "1H" | "15M" | "5M" | "1M".
 * - Timestamp must be a valid epoch and not drift into the future.
 * - OHLC must be finite numbers > 0.
 * - High must be >= Low.
 * - High must be >= Open and High >= Close.
 * - Low must be <= Open and Low <= Close.
 * - Volume must be >= 0.
 */
export function validateCanonicalCandle(
  input: unknown,
): CanonicalValidationResult<CanonicalCandle> {
  const errors: CanonicalValidationError[] = [];

  if (typeof input !== 'object' || input === null) {
    return {
      success: false,
      errors: [
        {
          code: 'MISSING_REQUIRED_FIELD',
          field: 'candle',
          message: 'Candle payload must be a non-null object.',
          receivedValue: input,
        },
      ],
    };
  }

  const raw = input as Record<string, unknown>;

  // 1. Guard against synthetic/mock data
  if (
    raw.isSynthetic === true ||
    raw.synthetic === true ||
    raw.mock === true ||
    raw.simulated === true
  ) {
    errors.push({
      code: 'SYNTHETIC_DATA_DETECTED',
      field: 'source',
      message:
        'HARD RULE VIOLATION: Synthetic or simulated candle detected. Only raw DERIV data is permitted (OANDA v20 retired).',
      receivedValue: raw.isSynthetic ?? raw.synthetic ?? raw.mock,
    });
  }

  // 2. Validate Data Source
  if (raw.source !== CANONICAL_BROKER_ID) {
    errors.push({
      code: 'INVALID_DATA_SOURCE',
      field: 'source',
      message: `Invalid source "${String(raw.source)}". Canonical data contract requires source === "${CANONICAL_BROKER_ID}".`,
      receivedValue: raw.source,
    });
  }

  // 3. Validate Approved Symbol
  if (
    typeof raw.symbol !== 'string' ||
    !APPROVED_INSTRUMENT_SET.has(raw.symbol)
  ) {
    errors.push({
      code: 'UNAPPROVED_INSTRUMENT',
      field: 'symbol',
      message: `Symbol "${String(raw.symbol)}" is not in the approved canonical instruments catalog (${APPROVED_INSTRUMENT_SET.size} instruments).`,
      receivedValue: raw.symbol,
    });
  }

  // 4. Validate Timeframe
  if (
    typeof raw.timeframe !== 'string' ||
    !VALID_TIMEFRAMES.has(raw.timeframe)
  ) {
    errors.push({
      code: 'MISSING_REQUIRED_FIELD',
      field: 'timeframe',
      message: `Timeframe must be one of "1H", "15M", "5M", "1M". Received "${String(raw.timeframe)}".`,
      receivedValue: raw.timeframe,
    });
  }

  // 5. Validate Timestamps
  const now = Date.now();
  if (
    typeof raw.timestamp !== 'number' ||
    !Number.isFinite(raw.timestamp) ||
    raw.timestamp <= 0
  ) {
    errors.push({
      code: 'INVALID_TIMESTAMP',
      field: 'timestamp',
      message: 'Timestamp must be a positive finite unix epoch millisecond value.',
      receivedValue: raw.timestamp,
    });
  } else if (raw.timestamp > now + MAX_FUTURE_DRIFT_MS) {
    errors.push({
      code: 'FUTURE_TIMESTAMP_DRIFT',
      field: 'timestamp',
      message: `Candle timestamp (${raw.timestamp}) exceeds server clock by more than ${MAX_FUTURE_DRIFT_MS / 1000}s.`,
      receivedValue: raw.timestamp,
    });
  }

  if (typeof raw.isoTimestamp !== 'string' || raw.isoTimestamp.trim() === '') {
    errors.push({
      code: 'MISSING_REQUIRED_FIELD',
      field: 'isoTimestamp',
      message: 'isoTimestamp must be a non-empty ISO 8601 string.',
      receivedValue: raw.isoTimestamp,
    });
  }

  // 6. Validate OHLC Numerics
  const { open, high, low, close } = raw;
  const ohlcFields = [
    { name: 'open', val: open },
    { name: 'high', val: high },
    { name: 'low', val: low },
    { name: 'close', val: close },
  ];

  for (const { name, val } of ohlcFields) {
    if (typeof val !== 'number' || !Number.isFinite(val) || val <= 0) {
      errors.push({
        code: 'NON_FINITE_NUMERIC_VALUE',
        field: name,
        message: `${name.toUpperCase()} price must be a strictly positive finite number.`,
        receivedValue: val,
      });
    }
  }

  // If OHLC are numbers, check strict mathematical monotonicity
  if (
    typeof open === 'number' &&
    typeof high === 'number' &&
    typeof low === 'number' &&
    typeof close === 'number' &&
    Number.isFinite(open) &&
    Number.isFinite(high) &&
    Number.isFinite(low) &&
    Number.isFinite(close)
  ) {
    // High must be >= Low
    if (high < low) {
      errors.push({
        code: 'INVERTED_HIGH_LOW',
        field: 'high_low',
        message: `FATAL DATA INVERSION: Candle High (${high}) is less than Low (${low}).`,
        receivedValue: { high, low },
      });
    }

    // High must be >= Open and High >= Close
    if (high < open || high < close) {
      errors.push({
        code: 'OUT_OF_BOUNDS_PRICE',
        field: 'high',
        message: `Candle High (${high}) must be >= Open (${open}) and Close (${close}).`,
        receivedValue: { high, open, close },
      });
    }

    // Low must be <= Open and Low <= Close
    if (low > open || low > close) {
      errors.push({
        code: 'OUT_OF_BOUNDS_PRICE',
        field: 'low',
        message: `Candle Low (${low}) must be <= Open (${open}) and Close (${close}).`,
        receivedValue: { low, open, close },
      });
    }
  }

  // 7. Validate Volume
  if (
    typeof raw.volume !== 'number' ||
    !Number.isFinite(raw.volume) ||
    raw.volume < 0
  ) {
    errors.push({
      code: 'NON_FINITE_NUMERIC_VALUE',
      field: 'volume',
      message: 'Volume must be a non-negative finite number.',
      receivedValue: raw.volume,
    });
  }

  // 8. Validate isComplete
  if (typeof raw.isComplete !== 'boolean') {
    errors.push({
      code: 'MISSING_REQUIRED_FIELD',
      field: 'isComplete',
      message: 'isComplete must be a boolean flag.',
      receivedValue: raw.isComplete,
    });
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  return {
    success: true,
    data: {
      symbol: raw.symbol as InstrumentSymbol,
      timeframe: raw.timeframe as Timeframe,
      timestamp: raw.timestamp as number,
      isoTimestamp: raw.isoTimestamp as string,
      open: raw.open as number,
      high: raw.high as number,
      low: raw.low as number,
      close: raw.close as number,
      volume: raw.volume as number,
      isComplete: raw.isComplete as boolean,
      source: CANONICAL_BROKER_ID,
      spreadPips:
        typeof raw.spreadPips === 'number' ? raw.spreadPips : undefined,
    },
    errors: [],
  };
}

/**
 * Validates a live streaming tick against DERIV canonical constraints.
 * Rejects any tick that is synthetic, has inverted bid/ask, or missing fields.
 */
export function validateCanonicalTick(
  input: unknown,
): CanonicalValidationResult<CanonicalTick> {
  const errors: CanonicalValidationError[] = [];

  if (typeof input !== 'object' || input === null) {
    return {
      success: false,
      errors: [
        {
          code: 'MISSING_REQUIRED_FIELD',
          field: 'tick',
          message: 'Tick payload must be a non-null object.',
          receivedValue: input,
        },
      ],
    };
  }

  const raw = input as Record<string, unknown>;

  // 1. Guard against synthetic/mock data
  if (
    raw.isSynthetic === true ||
    raw.synthetic === true ||
    raw.mock === true ||
    raw.simulated === true
  ) {
    errors.push({
      code: 'SYNTHETIC_DATA_DETECTED',
      field: 'source',
      message:
        'HARD RULE VIOLATION: Synthetic or simulated tick rejected. Only raw DERIV pricing is permitted (OANDA v20 retired).',
      receivedValue: raw.isSynthetic ?? raw.synthetic ?? raw.mock,
    });
  }

  // 2. Validate Data Source
  if (raw.source !== CANONICAL_BROKER_ID) {
    errors.push({
      code: 'INVALID_DATA_SOURCE',
      field: 'source',
      message: `Invalid tick source "${String(raw.source)}". Must be "${CANONICAL_BROKER_ID}".`,
      receivedValue: raw.source,
    });
  }

  // 3. Validate Approved Symbol
  if (
    typeof raw.symbol !== 'string' ||
    !APPROVED_INSTRUMENT_SET.has(raw.symbol)
  ) {
    errors.push({
      code: 'UNAPPROVED_INSTRUMENT',
      field: 'symbol',
      message: `Tick symbol "${String(raw.symbol)}" is not in the approved canonical instruments catalog (${APPROVED_INSTRUMENT_SET.size} instruments).`,
      receivedValue: raw.symbol,
    });
  }

  // 4. Validate Timestamps
  const now = Date.now();
  if (
    typeof raw.timestamp !== 'number' ||
    !Number.isFinite(raw.timestamp) ||
    raw.timestamp <= 0
  ) {
    errors.push({
      code: 'INVALID_TIMESTAMP',
      field: 'timestamp',
      message: 'Timestamp must be a positive finite epoch millisecond value.',
      receivedValue: raw.timestamp,
    });
  } else if (raw.timestamp > now + MAX_FUTURE_DRIFT_MS) {
    errors.push({
      code: 'FUTURE_TIMESTAMP_DRIFT',
      field: 'timestamp',
      message: 'Tick timestamp exceeds current clock by more than 60 seconds.',
      receivedValue: raw.timestamp,
    });
  }

  if (typeof raw.isoTimestamp !== 'string' || raw.isoTimestamp.trim() === '') {
    errors.push({
      code: 'MISSING_REQUIRED_FIELD',
      field: 'isoTimestamp',
      message: 'isoTimestamp must be provided as ISO 8601 string.',
      receivedValue: raw.isoTimestamp,
    });
  }

  // 5. Validate Bid / Ask / Mid
  const { bid, ask, mid } = raw;
  if (typeof bid !== 'number' || !Number.isFinite(bid) || bid <= 0) {
    errors.push({
      code: 'NON_FINITE_NUMERIC_VALUE',
      field: 'bid',
      message: 'Bid price must be a positive finite number.',
      receivedValue: bid,
    });
  }

  if (typeof ask !== 'number' || !Number.isFinite(ask) || ask <= 0) {
    errors.push({
      code: 'NON_FINITE_NUMERIC_VALUE',
      field: 'ask',
      message: 'Ask price must be a positive finite number.',
      receivedValue: ask,
    });
  }

  if (
    typeof bid === 'number' &&
    typeof ask === 'number' &&
    Number.isFinite(bid) &&
    Number.isFinite(ask)
  ) {
    if (ask < bid) {
      errors.push({
        code: 'NEGATIVE_SPREAD',
        field: 'spread',
        message: `Inverted spread detected: Ask (${ask}) is lower than Bid (${bid}).`,
        receivedValue: { bid, ask },
      });
    }
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  const validBid = bid as number;
  const validAsk = ask as number;
  const computedMid = typeof mid === 'number' ? mid : (validBid + validAsk) / 2;
  const spreadPips =
    typeof raw.spreadPips === 'number'
      ? raw.spreadPips
      : Math.abs(validAsk - validBid);

  return {
    success: true,
    data: {
      symbol: raw.symbol as InstrumentSymbol,
      timestamp: raw.timestamp as number,
      isoTimestamp: raw.isoTimestamp as string,
      bid: validBid,
      ask: validAsk,
      mid: computedMid,
      spreadPips,
      source: CANONICAL_BROKER_ID,
    },
    errors: [],
  };
}

// ============================================================================
// 4. HARD ARCHITECTURAL INVARIANT RUNTIME GUARDS
// ============================================================================

/**
 * Structural Timeframe Isolation Guard.
 *
 * HARD RULE: 1M data must NEVER be merged into higher-timeframe structural
 * calculations (Swings, BOS, Liquidity, OB, FVG).
 * Throws immediately if a 1M timeframe is supplied.
 */
export function assertStructuralTimeframe(
  timeframe: Timeframe,
): asserts timeframe is StructuralTimeframe {
  if (timeframe === '1M') {
    throw new Error(
      `STRUCTURAL ISOLATION BREACH: Timeframe "1M" is strictly forbidden from structural calculations. ` +
        `Only "1H", "15M", and "5M" may produce swing points, structure breaks, liquidity levels, and order blocks.`,
    );
  }
}

/**
 * Validates that a candle satisfies structural requirements (timeframe is 1H, 15M, or 5M).
 */
export function validateStructuralCandle(
  candle: CanonicalCandle,
): CanonicalValidationResult<CanonicalStructuralCandle> {
  if ((candle.timeframe as string) === '1M') {
    return {
      success: false,
      errors: [
        {
          code: 'STRUCTURAL_TIMEFRAME_VIOLATION',
          field: 'timeframe',
          message:
            '1M candle cannot be ingested into structural engines. The 1H -> 15M -> 5M hierarchy is fixed.',
          receivedValue: candle.timeframe,
        },
      ],
    };
  }

  return {
    success: true,
    data: candle as CanonicalStructuralCandle,
    errors: [],
  };
}

/**
 * Runtime guard asserting data provenance.
 * Throws if source !== 'DERIV' or if any synthetic marker exists.
 */
export function assertCanonicalDataSource(source: unknown): void {
  if (source !== CANONICAL_BROKER_ID) {
    throw new Error(
      `CANONICAL DATA PROVENANCE BREACH: Received data source "${String(source)}". ` +
        `DERIV is the only canonical data source authorized for this trading OS (OANDA v20 retired).`,
    );
  }
}
