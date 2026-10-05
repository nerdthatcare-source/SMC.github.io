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

import authRoutes from './src/routes/authRoutes';
import adminRoutes from './src/routes/adminRoutes';
import {
  accessGateway,
  respondAndLog,
  AuthenticatedRequest,
} from './src/services/accessGateway';
import { IdentitySessionService } from './src/services/identitySessionService';
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

// Mount M34 Authentication & Identity Routes
app.use('/api/auth', authRoutes);

// Mount OWNER-Only Administration Routes
app.use('/api/admin', adminRoutes);

// 1. Health & Server-Managed Connection Status (Public Health Monitor)
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

// 2. Real-Time SSE Stream Endpoint (M38 Gateway Protected)
app.get('/api/market/events', accessGateway(), (req: AuthenticatedRequest, res) => {
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

  // Log SSE client connection
  DatabaseConnection.getInstance().then((conn) => {
    conn.logAuditEvent(
      'SSE_STREAM_CONNECT',
      '/api/market/events',
      { userId: req.user?.id, email: req.user?.email },
      req.user?.id,
      req.ip,
    );
  });

  req.on('close', () => {
    sseClients.delete(res);
  });
});

// 3. Active Tradeable Symbols Catalog Verification (M38 Gateway Protected)
app.get('/api/market/active-symbols', accessGateway(), async (req: AuthenticatedRequest, res) => {
  try {
    const rawActive = await engine.derivAdapter.getActiveSymbols();
    const report = SymbolMappingEngine.verifyAgainstActiveSymbols(rawActive);
    await respondAndLog(req, res, report, { action: 'MARKET_ACTIVE_SYMBOLS' });
  } catch (err: any) {
    const report = SymbolMappingEngine.verifyAgainstActiveSymbols([]);
    await respondAndLog(req, res, report, { action: 'MARKET_ACTIVE_SYMBOLS' });
  }
});

// 4. Query Canonical Candles for Symbol and Timeframe (M38 Gateway Protected)
app.get('/api/market/candles', accessGateway(), async (req: AuthenticatedRequest, res) => {
  const symbol = (req.query.symbol as InstrumentSymbol) || 'EUR_USD';
  const timeframe = (req.query.timeframe as Timeframe) || '15M';
  const limit = req.query.limit ? Number(req.query.limit) : 100;

  const candles = engine.getCandles(symbol, timeframe, { limit });
  await respondAndLog(req, res, candles, {
    action: 'MARKET_CANDLES',
    resource: `${symbol}_${timeframe}`,
  });
});

// 5. Query All Timeframes at Once (Section 7.1 ADMIN ONLY)
app.get(
  '/api/market/all-candles',
  accessGateway({ adminOnly: true }),
  async (req: AuthenticatedRequest, res) => {
    const symbol = (req.query.symbol as InstrumentSymbol) || 'EUR_USD';
    const allCandles = {
      '1H': engine.getCandles(symbol, '1H', { limit: 100 }),
      '15M': engine.getCandles(symbol, '15M', { limit: 100 }),
      '5M': engine.getCandles(symbol, '5M', { limit: 100 }),
      '1M': engine.getCandles(symbol, '1M', { limit: 100 }),
    };

    await respondAndLog(req, res, allCandles, {
      action: 'MARKET_ALL_CANDLES',
      resource: symbol,
    });
  },
);

// 6. Latest Canonical Tick (M38 Gateway Protected)
app.get('/api/market/latest-tick', accessGateway(), async (req: AuthenticatedRequest, res) => {
  const symbol = (req.query.symbol as InstrumentSymbol) || 'EUR_USD';
  const tick = engine.getLatestTick(symbol);
  await respondAndLog(req, res, tick || null, {
    action: 'MARKET_LATEST_TICK',
    resource: symbol,
  });
});

// 7. Safety Gates & "Why Not Trade" Active Blocks (M38 Gateway Protected)
app.get('/api/market/safety', accessGateway(), async (req: AuthenticatedRequest, res) => {
  const symbol = (req.query.symbol as InstrumentSymbol) || 'EUR_USD';
  const decision = engine.safetyEngine.canAnalyze(symbol);
  await respondAndLog(
    req,
    res,
    {
      allowed: decision.allowed,
      blocks: engine.safetyEngine.getAllActiveBlocks(),
    },
    { action: 'MARKET_SAFETY', resource: symbol },
  );
});

// 8. Data Lineage Audit Trail (Section 7.1 ADMIN ONLY)
app.get(
  '/api/market/lineage',
  accessGateway({ adminOnly: true }),
  async (req: AuthenticatedRequest, res) => {
    const symbol = (req.query.symbol as InstrumentSymbol) || 'EUR_USD';
    const limit = req.query.limit ? Number(req.query.limit) : 30;

    const data = {
      records: engine.lineageEngine.getRecentLineage(symbol, limit),
      summary: engine.lineageEngine.getAuditSummary(),
    };

    await respondAndLog(req, res, data, {
      action: 'MARKET_LINEAGE',
      resource: symbol,
    });
  },
);

// 9. Start Streaming Subscriptions on Deriv Adapter (Section 7.1 ADMIN ONLY)
app.post(
  '/api/market/stream/start',
  accessGateway({ adminOnly: true }),
  async (req: AuthenticatedRequest, res) => {
    const symbols = (req.body.symbols as InstrumentSymbol[]) || ['EUR_USD'];
    try {
      await engine.startStreaming(symbols);
      await respondAndLog(
        req,
        res,
        { success: true, streaming: true, symbols },
        { action: 'STREAM_START' },
      );
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  },
);

// 10. Stop Streaming Subscriptions (Section 7.1 ADMIN ONLY)
app.post(
  '/api/market/stream/stop',
  accessGateway({ adminOnly: true }),
  async (req: AuthenticatedRequest, res) => {
    try {
      await engine.stopStreaming();
      await respondAndLog(
        req,
        res,
        { success: true, streaming: false },
        { action: 'STREAM_STOP' },
      );
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  },
);

// 11. Trigger Backfill Recovery across 1H, 15M, 5M, 1M (Section 7.1 ADMIN ONLY)
app.post(
  '/api/market/backfill',
  accessGateway({ adminOnly: true }),
  async (req: AuthenticatedRequest, res) => {
    const symbol = (req.body.symbol as InstrumentSymbol) || 'EUR_USD';
    try {
      const results = await engine.backfillSymbol(symbol);
      await respondAndLog(
        req,
        res,
        { success: true, results },
        { action: 'MARKET_BACKFILL', resource: symbol },
      );
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  },
);

// 12. Fetch Live frxEURUSD / Instrument from Deriv (Section 7.1 ADMIN ONLY)
app.post(
  '/api/market/fetch-live',
  accessGateway({ adminOnly: true }),
  async (req: AuthenticatedRequest, res) => {
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

      await respondAndLog(
        req,
        res,
        {
          success: true,
          symbol,
          latestTick,
          latestCandle,
          candlesCount,
        },
        { action: 'MARKET_FETCH_LIVE', resource: symbol },
      );
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  },
);

// 13. Filtered Browsable Catalog (M38 Gateway Protected)
app.get(
  ['/api/market/catalog', '/api/catalog'],
  accessGateway(),
  async (req: AuthenticatedRequest, res) => {
    try {
      const force = req.query.refresh === 'true';
      const catalog = await DerivCatalogEngine.getCatalog(
        engine.derivAdapter,
        force,
      );
      await respondAndLog(req, res, catalog, { action: 'MARKET_CATALOG' });
    } catch (err: any) {
      console.error('[Server] Error fetching catalog:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  },
);

// 14. Query Current Watchlist (M38 Gateway Protected)
app.get(
  ['/api/market/watchlist', '/api/watchlist'],
  accessGateway(),
  async (req: AuthenticatedRequest, res) => {
    await respondAndLog(req, res, watchlistEngine.getWatchlist(), {
      action: 'MARKET_WATCHLIST',
    });
  },
);

// 15. Add Instrument to Watchlist (Section 7.1 ADMIN ONLY)
app.post(
  ['/api/market/watchlist/add', '/api/watchlist/add'],
  accessGateway({ adminOnly: true }),
  async (req: AuthenticatedRequest, res) => {
    const rawSymbol = req.body.symbol;
    if (!rawSymbol) {
      return res
        .status(400)
        .json({ success: false, error: 'Symbol is required' });
    }
    try {
      const entry = await watchlistEngine.addInstrument(rawSymbol);
      await respondAndLog(
        req,
        res,
        { success: true, entry },
        { action: 'WATCHLIST_ADD', resource: rawSymbol },
      );
    } catch (err: any) {
      console.error(`[Server] Failed to add ${rawSymbol} to watchlist:`, err);
      res.status(500).json({ success: false, error: err.message });
    }
  },
);

// 16. Remove Instrument from Watchlist (Section 7.1 ADMIN ONLY)
app.post(
  ['/api/market/watchlist/remove', '/api/watchlist/remove'],
  accessGateway({ adminOnly: true }),
  async (req: AuthenticatedRequest, res) => {
    const rawSymbol = req.body.symbol;
    if (!rawSymbol) {
      return res
        .status(400)
        .json({ success: false, error: 'Symbol is required' });
    }
    try {
      const removed = await watchlistEngine.removeInstrument(rawSymbol);
      await respondAndLog(
        req,
        res,
        { success: removed },
        { action: 'WATCHLIST_REMOVE', resource: rawSymbol },
      );
    } catch (err: any) {
      console.error(
        `[Server] Failed to remove ${rawSymbol} from watchlist:`,
        err,
      );
      res.status(500).json({ success: false, error: err.message });
    }
  },
);

// ============================================================================
// VITE MIDDLEWARE & STATIC ASSET SERVING
// ============================================================================

const isProduction = process.env.NODE_ENV === 'production';

async function startServer() {
  // CRITICAL SECURITY VALIDATION: Fail-closed on missing SESSION_SECRET
  IdentitySessionService.getSessionSecret();

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
      await IdentitySessionService.ensureDefaultUsers();
      console.info('[Server] M34 Identity & Session roles initialized (Admin/Owner & Standard Trader).');
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
