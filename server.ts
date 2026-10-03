/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SMC Trading OS - Server-Side Market Data Backend
 *
 * Runs Express server hosting:
 * 1. Server-side Deriv WebSocket connection, token auth, & live streaming pipeline.
 *    (DERIV_API_TOKEN runs strictly server-side, never exposed to client).
 * 2. Canonical market data ingestion, backfill recovery, and lineage store.
 * 3. REST API & Server-Sent Events (SSE) routes for the React frontend.
 * 4. Vite middleware integration for port 3000.
 */

import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';

// Load server-side environment variables
dotenv.config();

import { CanonicalDataEngine } from './src/engine/canonicalDataEngine';
import { DatabaseConnection } from './src/db/database';
import { DerivCatalogEngine } from './src/engine/derivCatalogEngine';
import { WatchlistEngine } from './src/engine/watchlistEngine';
import { SymbolMappingEngine } from './src/engine/symbolMappingEngine';
import { APPROVED_INSTRUMENTS_LIST } from './src/engine/instrumentMarketConfiguration';
import {
  CanonicalCandle,
  CanonicalTick,
  CANONICAL_BROKER_ID,
} from './src/engine/canonicalDataContracts';
import {
  InstrumentSymbol,
  Timeframe,
} from './src/types/smc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

// ============================================================================
// SERVER-SIDE CANONICAL DATA ENGINE INITIALIZATION
// ============================================================================

const derivAppId = process.env.DERIV_APP_ID || '1089';
const derivApiToken = process.env.DERIV_API_TOKEN;

console.info(
  `[Server] Initializing CanonicalDataEngine with AppId: ${derivAppId}, Token: ${
    derivApiToken ? 'PRESENT (Server-Secured)' : 'NONE (Public Mode)'
  }`,
);

const engine = new CanonicalDataEngine({
  appId: derivAppId,
  apiToken: derivApiToken,
});

const watchlistEngine = new WatchlistEngine(engine);

// ============================================================================
// SERVER-SENT EVENTS (SSE) FOR REAL-TIME CLIENT UPDATES
// ============================================================================

const sseClients = new Set<express.Response>();

engine.subscribeCandles((candle) => {
  const data = JSON.stringify({ type: 'candle', candle });
  for (const client of sseClients) {
    try {
      client.write(`data: ${data}\n\n`);
    } catch {
      sseClients.delete(client);
    }
  }
});

engine.subscribeTicks((tick) => {
  const data = JSON.stringify({ type: 'tick', tick });
  for (const client of sseClients) {
    try {
      client.write(`data: ${data}\n\n`);
    } catch {
      sseClients.delete(client);
    }
  }
});

engine.healthEngine.subscribe((status, metrics) => {
  const data = JSON.stringify({ type: 'health', status, metrics });
  for (const client of sseClients) {
    try {
      client.write(`data: ${data}\n\n`);
    } catch {
      sseClients.delete(client);
    }
  }
});

watchlistEngine.subscribe((watchlist) => {
  const data = JSON.stringify({ type: 'watchlist', watchlist });
  for (const client of sseClients) {
    try {
      client.write(`data: ${data}\n\n`);
    } catch {
      sseClients.delete(client);
    }
  }
});

// ============================================================================
// REST API ROUTES (/api/*)
// ============================================================================

// 1. Health & Server-Managed Connection Status
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    feedStatus: engine.healthEngine.getStatus(),
    metrics: engine.healthEngine.getMetrics(),
    hasToken: Boolean(process.env.DERIV_API_TOKEN),
    appId: derivAppId,
    serverTime: Date.now(),
    lastCloseDetails: engine.derivAdapter.getLastCloseDetails(),
    lastErrorDetails: engine.derivAdapter.getLastErrorDetails(),
  });
});

// 2. Real-Time SSE Stream Endpoint
app.get('/api/market/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  sseClients.add(res);

  // Send initial snapshot
  const initial = JSON.stringify({
    type: 'init',
    status: engine.healthEngine.getStatus(),
    metrics: engine.healthEngine.getMetrics(),
    serverTime: Date.now(),
  });
  res.write(`data: ${initial}\n\n`);

  req.on('close', () => {
    sseClients.delete(res);
  });
});

// 3. Active Tradeable Symbols Catalog Verification
app.get('/api/market/active-symbols', async (req, res) => {
  try {
    const rawActive = await engine.derivAdapter.getActiveSymbols();
    const report = SymbolMappingEngine.verifyAgainstActiveSymbols(rawActive);
    res.json(report);
  } catch (err: any) {
    // If Deriv endpoint is unreachable, synthesize verification from catalog
    const report = SymbolMappingEngine.verifyAgainstActiveSymbols([]);
    res.json(report);
  }
});

// 4. Query Canonical Candles for Symbol and Timeframe
app.get('/api/market/candles', (req, res) => {
  const symbol = (req.query.symbol as InstrumentSymbol) || 'EUR_USD';
  const timeframe = (req.query.timeframe as Timeframe) || '15M';
  const limit = req.query.limit ? Number(req.query.limit) : 100;

  const candles = engine.getCandles(symbol, timeframe, { limit });
  res.json(candles);
});

// 5. Query All Timeframes at Once (1H, 15M, 5M, 1M)
app.get('/api/market/all-candles', (req, res) => {
  const symbol = (req.query.symbol as InstrumentSymbol) || 'EUR_USD';

  res.json({
    '1H': engine.getCandles(symbol, '1H', { limit: 100 }),
    '15M': engine.getCandles(symbol, '15M', { limit: 100 }),
    '5M': engine.getCandles(symbol, '5M', { limit: 100 }),
    '1M': engine.getCandles(symbol, '1M', { limit: 100 }),
  });
});

// 6. Latest Canonical Tick
app.get('/api/market/latest-tick', (req, res) => {
  const symbol = (req.query.symbol as InstrumentSymbol) || 'EUR_USD';
  const tick = engine.getLatestTick(symbol);
  res.json(tick || null);
});

// 7. Safety Gates & "Why Not Trade" Active Blocks
app.get('/api/market/safety', (req, res) => {
  const symbol = (req.query.symbol as InstrumentSymbol) || 'EUR_USD';
  const decision = engine.safetyEngine.canAnalyze(symbol);
  res.json({
    allowed: decision.allowed,
    blocks: engine.safetyEngine.getAllActiveBlocks(),
  });
});

// 8. Data Lineage Audit Trail
app.get('/api/market/lineage', (req, res) => {
  const symbol = (req.query.symbol as InstrumentSymbol) || 'EUR_USD';
  const limit = req.query.limit ? Number(req.query.limit) : 30;

  res.json({
    records: engine.lineageEngine.getRecentLineage(symbol, limit),
    summary: engine.lineageEngine.getAuditSummary(),
  });
});

// 9. Start Streaming Subscriptions on Deriv Adapter
app.post('/api/market/stream/start', async (req, res) => {
  const symbols = (req.body.symbols as InstrumentSymbol[]) || ['EUR_USD'];
  try {
    await engine.startStreaming(symbols);
    res.json({ success: true, streaming: true, symbols });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 10. Stop Streaming Subscriptions
app.post('/api/market/stream/stop', async (req, res) => {
  try {
    await engine.stopStreaming();
    res.json({ success: true, streaming: false });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 11. Trigger Backfill Recovery across 1H, 15M, 5M, 1M
app.post('/api/market/backfill', async (req, res) => {
  const symbol = (req.body.symbol as InstrumentSymbol) || 'EUR_USD';
  try {
    const results = await engine.backfillSymbol(symbol);
    res.json({ success: true, results });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 12. Fetch Live frxEURUSD / Instrument from Deriv
app.post('/api/market/fetch-live', async (req, res) => {
  const symbol = (req.body.symbol as InstrumentSymbol) || 'EUR_USD';
  try {
    await engine.marketDataEngine.ingestHistoricalFromDeriv(symbol, '1H', 50);
    await engine.marketDataEngine.ingestHistoricalFromDeriv(symbol, '15M', 50);
    await engine.marketDataEngine.ingestHistoricalFromDeriv(symbol, '5M', 50);
    await engine.marketDataEngine.ingestHistoricalFromDeriv(symbol, '1M', 50);
    await engine.startStreaming([symbol]);

    const latestTick = engine.getLatestTick(symbol);
    const latestCandle = engine.getLatestCandle(symbol, '15M');
    const candlesCount = engine.getCandles(symbol, '15M').length;

    res.json({
      success: true,
      symbol,
      latestTick,
      latestCandle,
      candlesCount,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 13. Filtered Browsable Catalog (Browse-only: 4 confirmed categories, no subscriptions)
app.get(['/api/market/catalog', '/api/catalog'], async (req, res) => {
  try {
    const force = req.query.refresh === 'true';
    const catalog = await DerivCatalogEngine.getCatalog(engine.derivAdapter, force);
    res.json(catalog);
  } catch (err: any) {
    console.error('[Server] Error fetching catalog:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 14. Query Current Watchlist
app.get(['/api/market/watchlist', '/api/watchlist'], (req, res) => {
  res.json(watchlistEngine.getWatchlist());
});

// 15. Add Instrument to Watchlist (Multiplexed WebSocket + Staggered Backfill)
app.post(['/api/market/watchlist/add', '/api/watchlist/add'], async (req, res) => {
  const rawSymbol = req.body.symbol;
  if (!rawSymbol) {
    return res.status(400).json({ success: false, error: 'Symbol is required' });
  }
  try {
    const entry = await watchlistEngine.addInstrument(rawSymbol);
    res.json({ success: true, entry });
  } catch (err: any) {
    console.error(`[Server] Failed to add ${rawSymbol} to watchlist:`, err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 16. Remove Instrument from Watchlist (Unsubscribe + Full State Teardown)
app.post(['/api/market/watchlist/remove', '/api/watchlist/remove'], async (req, res) => {
  const rawSymbol = req.body.symbol;
  if (!rawSymbol) {
    return res.status(400).json({ success: false, error: 'Symbol is required' });
  }
  try {
    const removed = await watchlistEngine.removeInstrument(rawSymbol);
    res.json({ success: removed });
  } catch (err: any) {
    console.error(`[Server] Failed to remove ${rawSymbol} from watchlist:`, err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// VITE MIDDLEWARE & STATIC ASSET SERVING
// ============================================================================

const isProduction = process.env.NODE_ENV === 'production';

async function startServer() {
  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  const PORT = 3000;
  app.listen(PORT, '0.0.0.0', async () => {
    console.log(`[SMC Trading OS Server] Listening on http://0.0.0.0:${PORT}`);
    try {
      await DatabaseConnection.getInstance();
      console.info('[Server] Managed PostgreSQL (Cloud SQL) database connection established & Section 6 schema verified.');
    } catch (dbErr) {
      console.error('[Server] Database initialization failed:', dbErr);
    }
    // Initialize watchlist asynchronously in background
    watchlistEngine.initializeOnStartup(['frxEURUSD']).catch((err) => {
      console.warn('[Server] Watchlist startup warning:', err);
    });
  });
}

startServer().catch((err) => {
  console.error('[SMC Server] Startup failed:', err);
  process.exit(1);
});
