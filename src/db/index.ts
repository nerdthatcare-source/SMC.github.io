/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Cloud SQL PostgreSQL Connection Pool & Drizzle ORM Instance
 *
 * Configured via Object Method per Cloud SQL architecture guidelines.
 * Supports platform environment variables (SQL_HOST, SQL_USER, SQL_PASSWORD, SQL_DB_NAME)
 * as well as Secret Manager connection strings (DATABASE_URL).
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool, PoolConfig } from 'pg';
import * as schema from './schema.ts';

declare global {
  var _postgresPool: Pool | undefined;
}

export const createPool = (): Pool => {
  if (!global._postgresPool) {
    const poolConfig: PoolConfig = {
      max: 10,
      connectionTimeoutMillis: 15000,
      idleTimeoutMillis: 30000,
    };

    // If connection string is provided by Secret Manager / environment
    if (process.env.DATABASE_URL) {
      poolConfig.connectionString = process.env.DATABASE_URL;
    } else {
      // Standard Cloud SQL runtime environment variables
      poolConfig.host = process.env.SQL_HOST || '127.0.0.1';
      poolConfig.user = process.env.SQL_USER || 'postgres';
      poolConfig.password = process.env.SQL_PASSWORD || '';
      poolConfig.database = process.env.SQL_DB_NAME || 'postgres';
      if (process.env.SQL_PORT) {
        poolConfig.port = parseInt(process.env.SQL_PORT, 10);
      }
    }

    global._postgresPool = new Pool(poolConfig);

    // Prevent unhandled pool-level errors from crashing the application
    global._postgresPool.on('error', (err) => {
      console.error('Unexpected error on idle SQL pool client:', err);
    });
  }
  return global._postgresPool;
};

export const pool = createPool();
export const db = drizzle(pool, { schema });
