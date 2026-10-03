/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Drizzle Kit Configuration for Cloud SQL PostgreSQL Schema Management
 */

import { defineConfig } from 'drizzle-kit';
import * as dotenv from 'dotenv';

dotenv.config();

const sqlHost = process.env.SQL_HOST || '127.0.0.1';
const sqlDbName = process.env.SQL_DB_NAME || 'postgres';
const user = process.env.SQL_ADMIN_USER || process.env.SQL_USER || 'postgres';
const password = process.env.SQL_ADMIN_PASSWORD || process.env.SQL_PASSWORD || '';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  schemaFilter: ['public'],
  dbCredentials: {
    host: sqlHost,
    user: user,
    password: password,
    database: sqlDbName,
    ssl: false,
  },
  verbose: true,
});
