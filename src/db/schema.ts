/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Section 6 Monetization & Access Control Architecture Schema (PostgreSQL / Cloud SQL)
 *
 * Fully preserves the 9 authoritative tables:
 * 1. users: Account identities, credentials, tiers (FREE, TRADER, INSTITUTIONAL), and status
 * 2. sessions: Authenticated tokens, device metadata, IP tracking, and expiry
 * 3. subscriptions: Recurring billing state, plan tiers, cycle periods, and cancellation flags
 * 4. access_profiles: Granular RBAC, allowed asset classes, max symbol quotas, order execution permissions
 * 5. instruments_master: The authoritative 43-symbol Deriv catalog with pip values, contract sizes, and ATR sources
 * 6. audit_log: Immutable audit journal recording user actions, resource mutations, and security events
 * 7. watchlists: Multi-asset persistent watchlist replacing legacy JSON storage
 * 8. invoices: Monetization invoice ledger and billing records
 * 9. feature_entitlements: Tier-level feature gating for SMC analytical modules
 */

import { relations } from 'drizzle-orm';
import {
  bigint,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  unique,
} from 'drizzle-orm/pg-core';

// ============================================================================
// 1. USERS
// ============================================================================
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash'),
  fullName: text('full_name'),
  tier: text('tier').notNull().default('FREE'),
  status: text('status').notNull().default('ACTIVE'),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
});

// ============================================================================
// 2. SESSIONS
// ============================================================================
export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    deviceInfo: text('device_info'),
    ipAddress: text('ip_address'),
    expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    lastActiveAt: bigint('last_active_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    index('idx_sessions_user_id').on(table.userId),
  ],
);

// ============================================================================
// 3. SUBSCRIPTIONS
// ============================================================================
export const subscriptions = pgTable(
  'subscriptions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    planId: text('plan_id').notNull(),
    status: text('status').notNull().default('ACTIVE'),
    currentPeriodStart: bigint('current_period_start', { mode: 'number' }).notNull(),
    currentPeriodEnd: bigint('current_period_end', { mode: 'number' }).notNull(),
    cancelAtPeriodEnd: integer('cancel_at_period_end').notNull().default(0),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    index('idx_subscriptions_user_id').on(table.userId),
  ],
);

// ============================================================================
// 4. ACCESS PROFILES (RBAC)
// ============================================================================
export const accessProfiles = pgTable(
  'access_profiles',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('TRADER'),
    allowedAssetClasses: text('allowed_asset_classes').notNull(),
    maxActiveWatchlistSymbols: integer('max_active_watchlist_symbols')
      .notNull()
      .default(5),
    canExecuteOrders: integer('can_execute_orders').notNull().default(0),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    index('idx_access_profiles_user_id').on(table.userId),
  ],
);

// ============================================================================
// 5. INSTRUMENTS MASTER (43-Symbol Authoritative Deriv Catalog)
// ============================================================================
export const instrumentsMaster = pgTable(
  'instruments_master',
  {
    symbol: text('symbol').primaryKey(),
    derivSymbol: text('deriv_symbol').notNull(),
    displayName: text('display_name').notNull(),
    assetClass: text('asset_class').notNull(),
    pipSize: doublePrecision('pip_size').notNull(),
    pipValue: doublePrecision('pip_value').notNull(),
    contractSize: doublePrecision('contract_size').notNull(),
    atrSource: text('atr_source').notNull(),
    isActive: integer('is_active').notNull().default(1),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    index('idx_instruments_master_asset_class').on(table.assetClass),
  ],
);

// ============================================================================
// 6. AUDIT LOG (Immutable Security Journal)
// ============================================================================
export const auditLog = pgTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    userId: text('user_id'),
    action: text('action').notNull(),
    resource: text('resource').notNull(),
    details: text('details'),
    ipAddress: text('ip_address'),
    timestamp: bigint('timestamp', { mode: 'number' }).notNull(),
  },
  (table) => [
    index('idx_audit_log_user_id').on(table.userId),
  ],
);

// ============================================================================
// 7. WATCHLISTS (Persistent Multi-Asset Watchlist)
// ============================================================================
export const watchlists = pgTable(
  'watchlists',
  {
    id: text('id').primaryKey(),
    userId: text('user_id'),
    derivSymbol: text('deriv_symbol').notNull().unique(),
    canonicalSymbol: text('canonical_symbol').notNull(),
    displayName: text('display_name').notNull(),
    category: text('category').notNull(),
    subscriptionId: text('subscription_id'),
    status: text('status').notNull().default('ACTIVE'),
    addedAt: bigint('added_at', { mode: 'number' }).notNull(),
    lastBackfillAt: bigint('last_backfill_at', { mode: 'number' }),
    isStreaming: integer('is_streaming').notNull().default(0),
  },
  (table) => [
    index('idx_watchlists_deriv_symbol').on(table.derivSymbol),
  ],
);

// ============================================================================
// 8. INVOICES
// ============================================================================
export const invoices = pgTable('invoices', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  subscriptionId: text('subscription_id'),
  amountCents: integer('amount_cents').notNull(),
  currency: text('currency').notNull().default('USD'),
  status: text('status').notNull().default('PAID'),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
});

// ============================================================================
// 9. FEATURE ENTITLEMENTS
// ============================================================================
export const featureEntitlements = pgTable(
  'feature_entitlements',
  {
    id: text('id').primaryKey(),
    tier: text('tier').notNull(),
    featureKey: text('feature_key').notNull(),
    enabled: integer('enabled').notNull().default(1),
  },
  (table) => [
    unique('uniq_tier_feature').on(table.tier, table.featureKey),
  ],
);

// ============================================================================
// RELATIONS
// ============================================================================
export const usersRelations = relations(users, ({ many, one }) => ({
  sessions: many(sessions),
  subscriptions: many(subscriptions),
  accessProfile: one(accessProfiles, {
    fields: [users.id],
    references: [accessProfiles.userId],
  }),
  invoices: many(invoices),
}));

export const subscriptionsRelations = relations(subscriptions, ({ one }) => ({
  user: one(users, {
    fields: [subscriptions.userId],
    references: [users.id],
  }),
}));
