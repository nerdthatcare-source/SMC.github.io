/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Institutional Trading OS Relational Database
 *
 * Powered by Managed Cloud SQL (PostgreSQL) reachable from Cloud Run,
 * eliminating the risk of data loss from ephemeral container filesystems.
 *
 * Section 6 Monetization & Access Control Architecture Schema (All 9 Tables Preserved):
 * 1. users: Account identities, credentials, tiers (FREE, TRADER, INSTITUTIONAL), and status
 * 2. sessions: Authenticated tokens, device metadata, IP tracking, and expiry
 * 3. subscriptions: Recurring billing state, plan tiers, cycle periods, and cancellation flags
 * 4. access_profiles: Granular RBAC, allowed asset classes, max symbol quotas, order execution permissions
 * 5. instruments_master: The authoritative 43-symbol Deriv catalog with pip values, contract sizes, and ATR sources
 * 6. audit_log: Immutable audit journal recording user actions, resource mutations, and security events
 * 7. watchlists: Multi-asset persistent watchlist replacing legacy JSON / SQLite storage
 * 8. invoices: Monetization invoice ledger and billing records
 * 9. feature_entitlements: Tier-level feature gating for SMC analytical modules
 */

import fs from 'fs';
import path from 'path';
import initSqlJs from 'sql.js';
import { eq } from 'drizzle-orm';
import { db, pool } from './index.ts';
import * as schema from './schema.ts';
import { APPROVED_INSTRUMENTS_LIST } from '../engine/instrumentMarketConfiguration';

export interface UserRecord {
  readonly id: string;
  readonly email: string;
  readonly passwordHash: string | null;
  readonly fullName: string | null;
  readonly role: 'USER' | 'SUPPORT' | 'ADMIN' | 'OWNER';
  readonly tier: 'FREE' | 'TRADER' | 'INSTITUTIONAL';
  readonly status: 'ACTIVE' | 'SUSPENDED' | 'PENDING';
  readonly emailVerified: number;
  readonly twoFactorSecret: string | null;
  readonly twoFactorEnabled: number;
  readonly verificationToken: string | null;
  readonly resetToken: string | null;
  readonly resetTokenExpiresAt: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface SessionRecord {
  readonly id: string;
  readonly userId: string;
  readonly tokenHash: string;
  readonly deviceInfo: string | null;
  readonly ipAddress: string | null;
  readonly expiresAt: number;
  readonly createdAt: number;
  readonly lastActiveAt: number;
}

export interface SubscriptionRecord {
  readonly id: string;
  readonly userId: string;
  readonly planId: string;
  readonly status: 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'TRIALING';
  readonly currentPeriodStart: number;
  readonly currentPeriodEnd: number;
  readonly cancelAtPeriodEnd: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface AccessProfileRecord {
  readonly id: string;
  readonly userId: string;
  readonly role: 'ADMIN' | 'TRADER' | 'VIEWER';
  readonly allowedAssetClasses: readonly string[];
  readonly maxActiveWatchlistSymbols: number;
  readonly canExecuteOrders: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface InstrumentMasterRecord {
  readonly symbol: string;
  readonly derivSymbol: string;
  readonly displayName: string;
  readonly assetClass: string;
  readonly pipSize: number;
  readonly pipValue: number;
  readonly contractSize: number;
  readonly atrSource: string;
  readonly isActive: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface WatchlistDbRecord {
  readonly id: string;
  readonly userId: string | null;
  readonly derivSymbol: string;
  readonly canonicalSymbol: string;
  readonly displayName: string;
  readonly category: string;
  readonly subscriptionId: string | null;
  readonly status: 'INITIALIZING' | 'ACTIVE' | 'ERROR';
  readonly addedAt: number;
  readonly lastBackfillAt: number | null;
  readonly isStreaming: boolean;
}

export interface AuditLogRecord {
  readonly id: string;
  readonly userId: string | null;
  readonly action: string;
  readonly resource: string;
  readonly details: string | null;
  readonly ipAddress: string | null;
  readonly timestamp: number;
}

export interface InvoiceRecord {
  readonly id: string;
  readonly userId: string;
  readonly subscriptionId: string | null;
  readonly amountCents: number;
  readonly currency: string;
  readonly status: 'PAID' | 'OPEN' | 'VOID' | 'UNCOLLECTIBLE';
  readonly createdAt: number;
}

export interface FeatureEntitlementRecord {
  readonly id: string;
  readonly tier: 'FREE' | 'TRADER' | 'INSTITUTIONAL';
  readonly featureKey: string;
  readonly enabled: boolean;
}

export class DatabaseConnection {
  private static instance: DatabaseConnection | null = null;
  private isReady = false;
  private watchlistCache: Map<string, WatchlistDbRecord> = new Map();

  private constructor() {}

  public static async getInstance(): Promise<DatabaseConnection> {
    if (!this.instance) {
      this.instance = new DatabaseConnection();
      await this.instance.init();
    }
    return this.instance;
  }

  public static isInitialized(): boolean {
    return Boolean(this.instance && this.instance.isReady);
  }

  public static getSyncInstance(): DatabaseConnection {
    if (!this.instance || !this.instance.isReady) {
      throw new Error(
        'DatabaseConnection has not been initialized. Call await DatabaseConnection.getInstance() first.',
      );
    }
    return this.instance;
  }

  /**
   * Initializes Managed PostgreSQL (Cloud SQL) connection,
   * performs automatic migration from legacy SQLite if present,
   * seeds the authoritative instrument catalog, and loads the active watchlist.
   */
  public async init(): Promise<void> {
    if (this.isReady) return;

    try {
      // 1. Verify connection to Cloud SQL PostgreSQL
      await pool.query('SELECT 1;');
      console.info(
        '[DatabaseConnection] Verified connection to Cloud SQL PostgreSQL.',
      );

      // 2. Perform one-time migration from legacy SQLite if present
      await this.migrateFromLegacySqliteIfPresent();

      // 3. Ensure instruments_master has all approved catalog instruments
      await this.seedInstrumentsMaster();

      // 4. Load persistent watchlist from PostgreSQL into cache
      await this.reloadWatchlistCache();

      this.isReady = true;
      console.info(
        `[DatabaseConnection] Managed Cloud SQL PostgreSQL ready. Loaded ${this.watchlistCache.size} persistent watchlist symbol(s).`,
      );
    } catch (err) {
      console.error(
        '[DatabaseConnection] Error during Cloud SQL initialization:',
        err,
      );
      // Fallback cache readiness to allow application to operate
      this.isReady = true;
    }
  }

  /**
   * Reads from local data/trading_os.sqlite if it exists and migrates rows to Cloud SQL.
   */
  private async migrateFromLegacySqliteIfPresent(): Promise<void> {
    const sqlitePath = path.resolve(process.cwd(), 'data/trading_os.sqlite');
    if (!fs.existsSync(sqlitePath)) return;

    try {
      console.info(
        `[DatabaseConnection] Found legacy SQLite database at ${sqlitePath}. Inspecting for migration to Cloud SQL...`,
      );
      const SQL = await initSqlJs();
      const fileBuffer = fs.readFileSync(sqlitePath);
      const sqliteDb = new SQL.Database(fileBuffer);

      // Migrate watchlists
      try {
        const wlRows = sqliteDb.exec('SELECT * FROM watchlists');
        if (wlRows.length > 0 && wlRows[0].values.length > 0) {
          const cols = wlRows[0].columns;
          for (const row of wlRows[0].values) {
            const obj: Record<string, unknown> = {};
            cols.forEach((c, idx) => {
              obj[c] = row[idx];
            });
            await pool.query(
              `INSERT INTO watchlists (
                id, user_id, deriv_symbol, canonical_symbol, display_name,
                category, subscription_id, status, added_at, last_backfill_at, is_streaming
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
              ON CONFLICT (deriv_symbol) DO UPDATE SET
                canonical_symbol = EXCLUDED.canonical_symbol,
                display_name = EXCLUDED.display_name,
                category = EXCLUDED.category,
                status = EXCLUDED.status,
                last_backfill_at = EXCLUDED.last_backfill_at,
                is_streaming = EXCLUDED.is_streaming;`,
              [
                obj.id,
                obj.user_id,
                obj.deriv_symbol,
                obj.canonical_symbol,
                obj.display_name,
                obj.category,
                obj.subscription_id,
                obj.status,
                obj.added_at,
                obj.last_backfill_at,
                obj.is_streaming ? 1 : 0,
              ],
            );
          }
          console.info(
            `[DatabaseConnection] Migrated ${wlRows[0].values.length} watchlist item(s) from SQLite to Cloud SQL.`,
          );
        }
      } catch (e) {
        console.warn(
          '[DatabaseConnection] Note during watchlist SQLite migration:',
          e,
        );
      }

      // Migrate audit_log
      try {
        const auditRows = sqliteDb.exec('SELECT * FROM audit_log');
        if (auditRows.length > 0 && auditRows[0].values.length > 0) {
          const cols = auditRows[0].columns;
          for (const row of auditRows[0].values) {
            const obj: Record<string, unknown> = {};
            cols.forEach((c, idx) => {
              obj[c] = row[idx];
            });
            await pool.query(
              `INSERT INTO audit_log (id, user_id, action, resource, details, ip_address, timestamp)
               VALUES ($1, $2, $3, $4, $5, $6, $7)
               ON CONFLICT (id) DO NOTHING;`,
              [
                obj.id,
                obj.user_id,
                obj.action,
                obj.resource,
                obj.details,
                obj.ip_address,
                obj.timestamp,
              ],
            );
          }
        }
      } catch (e) {
        console.warn(
          '[DatabaseConnection] Note during audit_log SQLite migration:',
          e,
        );
      }

      sqliteDb.close();

      // Rename legacy SQLite file to indicate completed migration
      const backupPath = `${sqlitePath}.migrated`;
      fs.renameSync(sqlitePath, backupPath);
      console.info(
        `[DatabaseConnection] Migration complete. Archived local SQLite to ${backupPath}.`,
      );
    } catch (migErr) {
      console.warn(
        '[DatabaseConnection] SQLite migration completed with note:',
        migErr,
      );
    }
  }

  /**
   * Seeds the instruments_master table in Cloud SQL from the authoritative catalog registry.
   */
  private async seedInstrumentsMaster(): Promise<void> {
    const now = Date.now();
    for (const inst of APPROVED_INSTRUMENTS_LIST) {
      if ((pool as any).ending || (pool as any).ended) return;
      try {
        await pool.query(
          `INSERT INTO instruments_master (
            symbol, deriv_symbol, display_name, asset_class,
            pip_size, pip_value, contract_size, atr_source,
            is_active, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, $9, $10)
          ON CONFLICT(symbol) DO UPDATE SET
            deriv_symbol = EXCLUDED.deriv_symbol,
            display_name = EXCLUDED.display_name,
            asset_class = EXCLUDED.asset_class,
            pip_size = EXCLUDED.pip_size,
            pip_value = EXCLUDED.pip_value,
            contract_size = EXCLUDED.contract_size,
            atr_source = EXCLUDED.atr_source,
            updated_at = EXCLUDED.updated_at;`,
          [
            inst.symbol,
            inst.brokerSymbolMapping.derivSymbol,
            inst.name,
            inst.assetClass,
            inst.pipSize,
            inst.pipValue,
            inst.contractSize,
            inst.atrSource,
            now,
            now,
          ],
        );
      } catch (err) {
        console.warn(
          `[DatabaseConnection] Failed to seed instrument ${inst.symbol}:`,
          err,
        );
      }
    }

    // Clean up any unapproved symbols to keep DB strictly aligned with the authoritative catalog
    try {
      const approvedSymbols = APPROVED_INSTRUMENTS_LIST.map((i) => i.symbol);
      if (approvedSymbols.length > 0) {
        await pool.query(
          'DELETE FROM instruments_master WHERE symbol NOT IN (SELECT unnest($1::text[]));',
          [approvedSymbols],
        );
      }
    } catch (cleanErr) {
      console.warn(
        '[DatabaseConnection] Note during instruments_master catalog cleanup:',
        cleanErr,
      );
    }
  }

  /**
   * Reloads in-memory watchlist cache from Cloud SQL PostgreSQL.
   */
  private async reloadWatchlistCache(): Promise<void> {
    try {
      const res = await pool.query(
        'SELECT * FROM watchlists ORDER BY added_at ASC;',
      );
      this.watchlistCache.clear();
      for (const row of res.rows) {
        const record: WatchlistDbRecord = {
          id: String(row.id),
          userId: row.user_id ? String(row.user_id) : null,
          derivSymbol: String(row.deriv_symbol),
          canonicalSymbol: String(row.canonical_symbol),
          displayName: String(row.display_name),
          category: String(row.category),
          subscriptionId: row.subscription_id
            ? String(row.subscription_id)
            : null,
          status: row.status as 'INITIALIZING' | 'ACTIVE' | 'ERROR',
          addedAt: Number(row.added_at),
          lastBackfillAt: row.last_backfill_at
            ? Number(row.last_backfill_at)
            : null,
          isStreaming: Boolean(row.is_streaming),
        };
        this.watchlistCache.set(record.derivSymbol, record);
      }
    } catch (err) {
      console.warn(
        '[DatabaseConnection] Failed to reload watchlist cache from Cloud SQL:',
        err,
      );
    }
  }

  // ==========================================================================
  // WATCHLIST PERSISTENCE (SYNCHRONOUS CACHE + ASYNCHRONOUS POSTGRES WRITE)
  // ==========================================================================

  public getWatchlistRecords(): WatchlistDbRecord[] {
    return Array.from(this.watchlistCache.values()).sort(
      (a, b) => a.addedAt - b.addedAt,
    );
  }

  public upsertWatchlistEntry(entry: {
    derivSymbol: string;
    canonicalSymbol: string;
    displayName: string;
    category: string;
    subscriptionId: string | null;
    status: 'INITIALIZING' | 'ACTIVE' | 'ERROR';
    addedAt: number;
    lastBackfillAt?: number;
    isStreaming: boolean;
  }): void {
    const id = `wl_${entry.derivSymbol}`;
    const record: WatchlistDbRecord = {
      id,
      userId: null,
      derivSymbol: entry.derivSymbol,
      canonicalSymbol: entry.canonicalSymbol,
      displayName: entry.displayName,
      category: entry.category,
      subscriptionId: entry.subscriptionId,
      status: entry.status,
      addedAt: entry.addedAt,
      lastBackfillAt: entry.lastBackfillAt ?? null,
      isStreaming: entry.isStreaming,
    };

    // Update in-memory cache synchronously
    this.watchlistCache.set(entry.derivSymbol, record);

    // Asynchronously write to Cloud SQL PostgreSQL
    pool
      .query(
        `INSERT INTO watchlists (
          id, user_id, deriv_symbol, canonical_symbol, display_name,
          category, subscription_id, status, added_at, last_backfill_at, is_streaming
        ) VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT(deriv_symbol) DO UPDATE SET
          subscription_id = EXCLUDED.subscription_id,
          status = EXCLUDED.status,
          last_backfill_at = EXCLUDED.last_backfill_at,
          is_streaming = EXCLUDED.is_streaming;`,
        [
          id,
          entry.derivSymbol,
          entry.canonicalSymbol,
          entry.displayName,
          entry.category,
          entry.subscriptionId,
          entry.status,
          entry.addedAt,
          entry.lastBackfillAt ?? null,
          entry.isStreaming ? 1 : 0,
        ],
      )
      .catch((err) => {
        console.error(
          `[DatabaseConnection] Failed to upsert watchlist entry for ${entry.derivSymbol} to Cloud SQL:`,
          err,
        );
      });
  }

  public deleteWatchlistEntry(symbol: string): void {
    // Remove from in-memory cache synchronously
    for (const [key, val] of this.watchlistCache.entries()) {
      if (val.derivSymbol === symbol || val.canonicalSymbol === symbol) {
        this.watchlistCache.delete(key);
      }
    }

    // Asynchronously delete from Cloud SQL PostgreSQL
    pool
      .query(
        'DELETE FROM watchlists WHERE deriv_symbol = $1 OR canonical_symbol = $1;',
        [symbol],
      )
      .catch((err) => {
        console.error(
          `[DatabaseConnection] Failed to delete watchlist entry for ${symbol} from Cloud SQL:`,
          err,
        );
      });
  }

  // ==========================================================================
  // AUDIT LOG PERSISTENCE (MANAGED POSTGRESQL)
  // ==========================================================================

  public logAuditEvent(
    action: string,
    resource: string,
    details?: Record<string, unknown>,
    userId?: string,
    ipAddress?: string,
  ): void {
    if ((pool as any).ending || (pool as any).ended) return;
    const id = `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    pool
      .query(
        `INSERT INTO audit_log (id, user_id, action, resource, details, ip_address, timestamp)
         VALUES ($1, $2, $3, $4, $5, $6, $7);`,
        [
          id,
          userId ?? null,
          action,
          resource,
          details ? JSON.stringify(details) : null,
          ipAddress ?? null,
          Date.now(),
        ],
      )
      .catch((err) => {
        console.error(
          `[DatabaseConnection] Failed to persist audit event ${action} to Cloud SQL:`,
          err,
        );
      });
  }

  // ==========================================================================
  // DRIZZLE ORM ACCESSORS (ALL 9 PRESERVED ARCHITECTURAL TABLES)
  // ==========================================================================

  public async getUsers() {
    return db.select().from(schema.users);
  }

  public async getUserById(userId: string) {
    const res = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId));
    return res[0] ?? null;
  }

  public async getSessionsByUserId(userId: string) {
    return db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.userId, userId));
  }

  public async getSubscriptionsByUserId(userId: string) {
    return db
      .select()
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.userId, userId));
  }

  public async getAccessProfileByUserId(userId: string) {
    const res = await db
      .select()
      .from(schema.accessProfiles)
      .where(eq(schema.accessProfiles.userId, userId));
    return res[0] ?? null;
  }

  public async getInstrumentsCatalog() {
    return db.select().from(schema.instrumentsMaster);
  }

  public async getInvoicesByUserId(userId: string) {
    return db
      .select()
      .from(schema.invoices)
      .where(eq(schema.invoices.userId, userId));
  }

  public async getFeatureEntitlementsByTier(tier: string) {
    return db
      .select()
      .from(schema.featureEntitlements)
      .where(eq(schema.featureEntitlements.tier, tier));
  }

  public close(): void {
    // Cloud SQL pg.Pool connection lifecycle is managed globally
  }
}
