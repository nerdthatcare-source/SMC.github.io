/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Time Formatting & Staleness Calculation Utilities
 */

/**
 * Returns human-readable relative time string (e.g. "4s ago", "2m ago", "1h ago").
 */
export function formatTimeSince(timestampMs: number | null | undefined): string {
  if (!timestampMs || !Number.isFinite(timestampMs)) return 'No timestamp';
  const elapsedSec = Math.max(0, Math.floor((Date.now() - timestampMs) / 1000));
  if (elapsedSec < 60) return `${elapsedSec}s ago`;
  const elapsedMin = Math.floor(elapsedSec / 60);
  if (elapsedMin < 60) return `${elapsedMin}m ago`;
  const elapsedHours = Math.floor(elapsedMin / 60);
  if (elapsedHours < 24) return `${elapsedHours}h ago`;
  const elapsedDays = Math.floor(elapsedHours / 24);
  return `${elapsedDays}d ago`;
}

/**
 * Formats unix epoch millisecond timestamp to compact UTC date-time string.
 * e.g. "2026-09-28 07:34:12 UTC"
 */
export function formatUtcDateTime(timestampMs: number | null | undefined): string {
  if (!timestampMs || !Number.isFinite(timestampMs)) return '--:--:-- UTC';
  const d = new Date(timestampMs);
  return `${d.toISOString().replace('T', ' ').substring(0, 19)} UTC`;
}

/**
 * Formats a price with its candle timestamp and time elapsed since last update.
 * e.g. "1.08542 • 2026-09-28 07:34:00 UTC (4s ago)"
 */
export function formatPriceWithTimestamp(
  price: number | null | undefined,
  timestampMs: number | null | undefined,
  precision = 5,
): string {
  if (price === null || price === undefined || !Number.isFinite(price)) {
    return '--';
  }
  const formattedPrice = price.toFixed(precision);
  if (!timestampMs) return formattedPrice;
  return `${formattedPrice} • ${formatUtcDateTime(timestampMs)} (${formatTimeSince(timestampMs)})`;
}
