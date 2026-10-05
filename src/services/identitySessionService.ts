/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * M34: Identity & Session Service (Phase 1)
 *
 * Provides:
 * - User Registration, Login, Logout
 * - Email Verification & Password Reset
 * - Cryptographically Signed Sessions (HMAC-SHA256)
 * - Strict Roles: 'USER' | 'SUPPORT' | 'ADMIN' | 'OWNER'
 * - Account Status: 'ACTIVE' | 'SUSPENDED'
 * - 2FA Enforcement for ADMIN/OWNER and Paid Users (TRADER, INSTITUTIONAL)
 * - PBKDF2 Secure Password Hashing
 * - Brute-Force Login Rate Limiting (5 attempts / 15 minutes)
 * - Empty Workspace Creation per New User (no pre-filled watchlists)
 */

import crypto from 'crypto';
import { Request } from 'express';
import { eq, and, gt } from 'drizzle-orm';
import { db, pool } from '../db/index.ts';
import * as schema from '../db/schema.ts';
import { DatabaseConnection } from '../db/database';

export type UserRole = 'USER' | 'SUPPORT' | 'ADMIN' | 'OWNER';
export type UserStatus = 'ACTIVE' | 'SUSPENDED';
export type UserTier = 'FREE' | 'TRADER' | 'INSTITUTIONAL';

export interface SanitizedUser {
  readonly id: string;
  readonly email: string;
  readonly fullName: string | null;
  readonly role: UserRole;
  readonly tier: UserTier;
  readonly status: UserStatus;
  readonly emailVerified: boolean;
  readonly twoFactorEnabled: boolean;
  readonly createdAt: number;
}

export interface UserAccessProfile {
  readonly id: string;
  readonly userId: string;
  readonly role: UserRole;
  readonly allowedAssetClasses: readonly string[];
  readonly maxActiveWatchlistSymbols: number;
  readonly canExecuteOrders: boolean;
}

export interface AuthSession {
  readonly id: string;
  readonly userId: string;
  readonly expiresAt: number;
  readonly createdAt: number;
}

interface RateLimitEntry {
  attempts: number;
  firstAttemptAt: number;
  lockedUntil?: number;
}

export class IdentitySessionService {
  /**
   * Retrieves the HMAC-SHA256 session signing secret from the environment.
   * If unset or empty, throws a critical security error and refuses to run.
   * NEVER falls back to a hardcoded string.
   */
  public static getSessionSecret(): string {
    const secret = process.env.SESSION_SECRET;
    if (!secret || secret.trim() === '') {
      throw new Error(
        'CRITICAL SECURITY ERROR: SESSION_SECRET environment variable is required and must not be empty. Server refusing to start with an insecure or missing secret.',
      );
    }
    return secret.trim();
  }

  private static readonly MAX_LOGIN_ATTEMPTS = 5;
  private static readonly RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
  private static readonly SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
  private static readonly RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

  // In-memory rate limiting tracker (keyed by IP + email)
  private static loginAttempts: Map<string, RateLimitEntry> = new Map();

  // ==========================================================================
  // PASSWORD HASHING & CRYPTOGRAPHY
  // ==========================================================================

  public static hashPassword(password: string): string {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto
      .pbkdf2Sync(password, salt, 100000, 64, 'sha512')
      .toString('hex');
    return `${salt}:${hash}`;
  }

  public static verifyPassword(password: string, storedHash: string): boolean {
    try {
      const [salt, originalHash] = storedHash.split(':');
      if (!salt || !originalHash) return false;
      const hash = crypto
        .pbkdf2Sync(password, salt, 100000, 64, 'sha512')
        .toString('hex');
      return crypto.timingSafeEqual(
        Buffer.from(hash, 'hex'),
        Buffer.from(originalHash, 'hex'),
      );
    } catch {
      return false;
    }
  }

  private static signSessionToken(rawToken: string): string {
    const signature = crypto
      .createHmac('sha256', this.getSessionSecret())
      .update(rawToken)
      .digest('hex');
    return `${rawToken}.${signature}`;
  }

  private static verifyAndUnsignToken(signedToken: string): string | null {
    const parts = signedToken.split('.');
    if (parts.length !== 2) return null;
    const [rawToken, signature] = parts;
    const expectedSignature = crypto
      .createHmac('sha256', this.getSessionSecret())
      .update(rawToken)
      .digest('hex');

    try {
      const match = crypto.timingSafeEqual(
        Buffer.from(signature, 'hex'),
        Buffer.from(expectedSignature, 'hex'),
      );
      return match ? rawToken : null;
    } catch {
      return null;
    }
  }

  private static hashToken(rawToken: string): string {
    return crypto.createHash('sha256').update(rawToken).digest('hex');
  }

  // ==========================================================================
  // RATE LIMITING
  // ==========================================================================

  private static getRateLimitKey(identifier: string, ip?: string): string {
    return `${(ip || '0.0.0.0').trim()}:${identifier.trim().toLowerCase()}`;
  }

  public static checkLoginRateLimit(
    identifier: string,
    ip?: string,
  ): { allowed: boolean; retryAfterMs?: number } {
    const key = this.getRateLimitKey(identifier, ip);
    const entry = this.loginAttempts.get(key);
    const now = Date.now();

    if (!entry) return { allowed: true };

    if (entry.lockedUntil && entry.lockedUntil > now) {
      return { allowed: false, retryAfterMs: entry.lockedUntil - now };
    }

    if (now - entry.firstAttemptAt > this.RATE_LIMIT_WINDOW_MS) {
      this.loginAttempts.delete(key);
      return { allowed: true };
    }

    if (entry.attempts >= this.MAX_LOGIN_ATTEMPTS) {
      entry.lockedUntil = now + this.RATE_LIMIT_WINDOW_MS;
      return { allowed: false, retryAfterMs: this.RATE_LIMIT_WINDOW_MS };
    }

    return { allowed: true };
  }

  public static recordFailedLoginAttempt(identifier: string, ip?: string): void {
    const key = this.getRateLimitKey(identifier, ip);
    const now = Date.now();
    const entry = this.loginAttempts.get(key);

    if (!entry || now - entry.firstAttemptAt > this.RATE_LIMIT_WINDOW_MS) {
      this.loginAttempts.set(key, { attempts: 1, firstAttemptAt: now });
    } else {
      entry.attempts += 1;
      if (entry.attempts >= this.MAX_LOGIN_ATTEMPTS) {
        entry.lockedUntil = now + this.RATE_LIMIT_WINDOW_MS;
      }
    }
  }

  public static resetLoginRateLimit(identifier: string, ip?: string): void {
    const key = this.getRateLimitKey(identifier, ip);
    this.loginAttempts.delete(key);
  }

  // ==========================================================================
  // 2FA VERIFICATION LOGIC
  // ==========================================================================

  public static is2FARequired(user: {
    role: UserRole;
    tier: UserTier;
  }): boolean {
    return (
      user.role === 'ADMIN' ||
      user.role === 'OWNER' ||
      user.tier === 'TRADER' ||
      user.tier === 'INSTITUTIONAL'
    );
  }

  public static get BOOTSTRAP_ADMIN_PASSWORD(): string {
    const pwd = process.env.ADMIN_BOOTSTRAP_PASSWORD;
    if (!pwd || pwd.trim() === '') {
      throw new Error(
        'CRITICAL SECURITY ERROR: ADMIN_BOOTSTRAP_PASSWORD environment variable is required and must not be empty. Refusing to run with missing or empty password.',
      );
    }
    return pwd.trim();
  }

  public static get BOOTSTRAP_ADMIN_2FA_SECRET(): string {
    const secret = process.env.ADMIN_BOOTSTRAP_2FA_SECRET;
    if (!secret || secret.trim() === '') {
      throw new Error(
        'CRITICAL SECURITY ERROR: ADMIN_BOOTSTRAP_2FA_SECRET environment variable is required and must not be empty.',
      );
    }
    return secret.trim();
  }

  /**
   * Generates a 6-digit TOTP code per RFC 6238 (30-second time-step, HMAC-SHA1).
   */
  public static generateTOTPCode(
    secret: string,
    timestampMs = Date.now(),
    digits = 6,
  ): string {
    const timeStep = Math.floor(timestampMs / 1000 / 30);
    const buffer = Buffer.alloc(8);
    buffer.writeBigInt64BE(BigInt(timeStep));

    let key: Buffer;
    if (/^[0-9a-fA-F]+$/.test(secret) && secret.length % 2 === 0) {
      key = Buffer.from(secret, 'hex');
    } else {
      key = Buffer.from(secret, 'utf-8');
    }

    const hmac = crypto.createHmac('sha1', key).update(buffer).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const binary =
      ((hmac[offset] & 0x7f) << 24) |
      ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) << 8) |
      (hmac[offset + 3] & 0xff);

    const otp = binary % Math.pow(10, digits);
    return otp.toString().padStart(digits, '0');
  }

  /**
   * Enforces standard TOTP (RFC 6238) time-step verification ONLY.
   * Completely removes any static secret-match bypass branch.
   */
  public static verify2FACode(
    secret: string | null,
    providedCode: string,
    windowSteps = 1,
  ): boolean {
    if (!secret || !providedCode) return false;
    const cleanCode = providedCode.trim();

    // Strict 6-digit numeric TOTP verification
    if (!/^\d{6}$/.test(cleanCode)) {
      return false;
    }

    const now = Date.now();
    // RFC 6238 time-step window: [T - window, T + window] (skew tolerance)
    for (let i = -windowSteps; i <= windowSteps; i++) {
      const stepTimestamp = now + i * 30000;
      const expected = this.generateTOTPCode(secret, stepTimestamp, 6);
      if (
        crypto.timingSafeEqual(
          Buffer.from(cleanCode, 'utf-8'),
          Buffer.from(expected, 'utf-8'),
        )
      ) {
        return true;
      }
    }

    return false;
  }

  // ==========================================================================
  // CORE AUTHENTICATION FLOWS (REGISTER, LOGIN, LOGOUT)
  // ==========================================================================

  public static sanitizeUser(user: any): SanitizedUser {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName || null,
      role: (user.role as UserRole) || 'USER',
      tier: (user.tier as UserTier) || 'FREE',
      status: (user.status as UserStatus) || 'ACTIVE',
      emailVerified: Boolean(user.emailVerified),
      twoFactorEnabled: Boolean(user.twoFactorEnabled),
      createdAt: Number(user.createdAt),
    };
  }

  /**
   * Registers a new user.
   * Creates an EMPTY workspace per new user (no pre-filled data or watchlists).
   */
  public static async register(params: {
    email: string;
    password: string;
    fullName?: string;
    role?: UserRole;
    ipAddress?: string;
  }): Promise<{ user: SanitizedUser; verificationToken: string }> {
    const email = params.email.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error('Invalid email format');
    }
    if (!params.password || params.password.length < 8) {
      throw new Error('Password must be at least 8 characters long');
    }

    // Check duplicate
    const existing = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email));
    if (existing.length > 0) {
      throw new Error('Email address is already registered');
    }

    const userId = `usr_${crypto.randomBytes(12).toString('hex')}`;
    const passwordHash = this.hashPassword(params.password);
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const role: UserRole = params.role || 'USER';
    const now = Date.now();

    // 1. Insert user
    await db.insert(schema.users).values({
      id: userId,
      email,
      passwordHash,
      fullName: params.fullName?.trim() || null,
      role,
      tier: 'FREE',
      status: 'ACTIVE',
      emailVerified: 0,
      twoFactorEnabled: 0,
      twoFactorSecret: null,
      verificationToken,
      resetToken: null,
      resetTokenExpiresAt: null,
      createdAt: now,
      updatedAt: now,
    });

    // 2. Insert Access Profile
    const profileId = `prof_${userId}`;
    await db.insert(schema.accessProfiles).values({
      id: profileId,
      userId,
      role,
      allowedAssetClasses: JSON.stringify(['forex']),
      maxActiveWatchlistSymbols: 5,
      canExecuteOrders: 0,
      createdAt: now,
      updatedAt: now,
    });

    // NOTE: Empty workspace requirement:
    // No watchlist items are inserted for this user. The user's personal workspace starts completely empty.

    DatabaseConnection.getInstance().then((conn) => {
      conn.logAuditEvent(
        'USER_REGISTER',
        userId,
        { email, role },
        userId,
        params.ipAddress,
      );
    });

    const userRecord = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId));
    return {
      user: this.sanitizeUser(userRecord[0]),
      verificationToken,
    };
  }

  /**
   * Authenticates user credentials with rate-limiting and 2FA enforcement.
   */
  public static async login(params: {
    email: string;
    password: string;
    twoFactorCode?: string;
    deviceInfo?: string;
    ipAddress?: string;
  }): Promise<{
    user: SanitizedUser;
    sessionToken: string;
    expiresAt: number;
    profile: UserAccessProfile;
  }> {
    const email = params.email.trim().toLowerCase();
    const rateCheck = this.checkLoginRateLimit(email, params.ipAddress);
    if (!rateCheck.allowed) {
      const waitMinutes = Math.ceil(
        (rateCheck.retryAfterMs || this.RATE_LIMIT_WINDOW_MS) / 60000,
      );
      throw new Error(
        `Too many failed login attempts. Account locked for ${waitMinutes} minute(s).`,
      );
    }

    const rows = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email));
    if (rows.length === 0) {
      this.recordFailedLoginAttempt(email, params.ipAddress);
      throw new Error('Invalid email or password');
    }

    const user = rows[0];

    // Check account status
    if (user.status === 'SUSPENDED') {
      throw new Error('Account is suspended. Please contact support.');
    }

    // Verify password
    if (
      !user.passwordHash ||
      !this.verifyPassword(params.password, user.passwordHash)
    ) {
      this.recordFailedLoginAttempt(email, params.ipAddress);
      throw new Error('Invalid email or password');
    }

    // 2FA Enforcement
    const role = (user.role as UserRole) || 'USER';
    const tier = (user.tier as UserTier) || 'FREE';
    const requires2FA = this.is2FARequired({ role, tier });

    if (requires2FA && user.twoFactorEnabled) {
      if (!params.twoFactorCode) {
        throw new Error(
          '2FA_REQUIRED: Two-factor authentication code is required for this account.',
        );
      }
      const is2FAValid = this.verify2FACode(
        user.twoFactorSecret,
        params.twoFactorCode,
      );
      if (!is2FAValid) {
        this.recordFailedLoginAttempt(email, params.ipAddress);
        throw new Error('Invalid two-factor authentication code');
      }
    }

    // Reset rate limit on successful credentials
    this.resetLoginRateLimit(email, params.ipAddress);

    // Create cryptographically signed session
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const signedToken = this.signSessionToken(rawToken);
    const sessionId = `sess_${crypto.randomBytes(16).toString('hex')}`;
    const now = Date.now();
    const expiresAt = now + this.SESSION_TTL_MS;

    await db.insert(schema.sessions).values({
      id: sessionId,
      userId: user.id,
      tokenHash,
      deviceInfo: params.deviceInfo || null,
      ipAddress: params.ipAddress || null,
      expiresAt,
      createdAt: now,
      lastActiveAt: now,
    });

    // Fetch user access profile
    const profileRows = await db
      .select()
      .from(schema.accessProfiles)
      .where(eq(schema.accessProfiles.userId, user.id));

    let profile: UserAccessProfile;
    if (profileRows.length > 0) {
      const p = profileRows[0];
      let classes: string[] = ['forex'];
      try {
        classes = JSON.parse(p.allowedAssetClasses);
      } catch {
        classes = ['forex'];
      }
      profile = {
        id: p.id,
        userId: p.userId,
        role: (p.role as UserRole) || role,
        allowedAssetClasses: classes,
        maxActiveWatchlistSymbols: p.maxActiveWatchlistSymbols,
        canExecuteOrders: Boolean(p.canExecuteOrders),
      };
    } else {
      profile = {
        id: `prof_${user.id}`,
        userId: user.id,
        role,
        allowedAssetClasses: ['forex', 'indices', 'commodities', 'crypto'],
        maxActiveWatchlistSymbols: 50,
        canExecuteOrders: role === 'ADMIN' || role === 'OWNER',
      };
    }

    DatabaseConnection.getInstance().then((conn) => {
      conn.logAuditEvent(
        'USER_LOGIN',
        user.id,
        { role, tier },
        user.id,
        params.ipAddress,
      );
    });

    return {
      user: this.sanitizeUser(user),
      sessionToken: signedToken,
      expiresAt,
      profile,
    };
  }

  /**
   * Destroys a session (Logout).
   */
  public static async logout(
    signedToken: string,
    ipAddress?: string,
  ): Promise<boolean> {
    const rawToken = this.verifyAndUnsignToken(signedToken);
    if (!rawToken) return false;

    const tokenHash = this.hashToken(rawToken);
    const sessionRows = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.tokenHash, tokenHash));

    if (sessionRows.length > 0) {
      const session = sessionRows[0];
      await db
        .delete(schema.sessions)
        .where(eq(schema.sessions.id, session.id));

      DatabaseConnection.getInstance().then((conn) => {
        conn.logAuditEvent(
          'USER_LOGOUT',
          session.userId,
          {},
          session.userId,
          ipAddress,
        );
      });
      return true;
    }
    return false;
  }

  /**
   * Validates a signed session token, checking signature, database validity,
   * expiration, and user suspension status.
   */
  public static async validateSession(signedToken: string): Promise<{
    user: SanitizedUser;
    session: AuthSession;
    profile: UserAccessProfile;
  } | null> {
    if (!signedToken) return null;

    const rawToken = this.verifyAndUnsignToken(signedToken);
    if (!rawToken) return null;

    const tokenHash = this.hashToken(rawToken);
    const now = Date.now();

    // Query session
    const sessionRows = await db
      .select()
      .from(schema.sessions)
      .where(
        and(
          eq(schema.sessions.tokenHash, tokenHash),
          gt(schema.sessions.expiresAt, now),
        ),
      );

    if (sessionRows.length === 0) return null;

    const session = sessionRows[0];

    // Fetch user
    const userRows = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, session.userId));

    if (userRows.length === 0) return null;

    const user = userRows[0];
    if (user.status === 'SUSPENDED') {
      return null;
    }

    // Refresh lastActiveAt asynchronously
    pool
      .query('UPDATE sessions SET last_active_at = $1 WHERE id = $2;', [
        now,
        session.id,
      ])
      .catch(() => {});

    // Fetch access profile
    const profileRows = await db
      .select()
      .from(schema.accessProfiles)
      .where(eq(schema.accessProfiles.userId, user.id));

    const role = (user.role as UserRole) || 'USER';
    let profile: UserAccessProfile;
    if (profileRows.length > 0) {
      const p = profileRows[0];
      let classes: string[] = ['forex'];
      try {
        classes = JSON.parse(p.allowedAssetClasses);
      } catch {
        classes = ['forex'];
      }
      profile = {
        id: p.id,
        userId: p.userId,
        role: (p.role as UserRole) || role,
        allowedAssetClasses: classes,
        maxActiveWatchlistSymbols: p.maxActiveWatchlistSymbols,
        canExecuteOrders: Boolean(p.canExecuteOrders),
      };
    } else {
      profile = {
        id: `prof_${user.id}`,
        userId: user.id,
        role,
        allowedAssetClasses: ['forex', 'indices', 'commodities', 'crypto'],
        maxActiveWatchlistSymbols: 50,
        canExecuteOrders: role === 'ADMIN' || role === 'OWNER',
      };
    }

    return {
      user: this.sanitizeUser(user),
      session: {
        id: session.id,
        userId: session.userId,
        expiresAt: Number(session.expiresAt),
        createdAt: Number(session.createdAt),
      },
      profile,
    };
  }

  // ==========================================================================
  // EMAIL VERIFICATION & PASSWORD RESET
  // ==========================================================================

  public static async verifyEmail(token: string): Promise<boolean> {
    if (!token) return false;
    const rows = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.verificationToken, token));

    if (rows.length === 0) return false;

    const user = rows[0];
    await db
      .update(schema.users)
      .set({
        emailVerified: 1,
        verificationToken: null,
        updatedAt: Date.now(),
      })
      .where(eq(schema.users.id, user.id));

    DatabaseConnection.getInstance().then((conn) => {
      conn.logAuditEvent('EMAIL_VERIFIED', user.id, {}, user.id);
    });

    return true;
  }

  public static async requestPasswordReset(
    email: string,
  ): Promise<{ success: boolean; resetToken?: string }> {
    const cleanEmail = email.trim().toLowerCase();
    const rows = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, cleanEmail));

    if (rows.length === 0) {
      // Return success to avoid email enumeration
      return { success: true };
    }

    const user = rows[0];
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpiresAt = Date.now() + this.RESET_TOKEN_TTL_MS;

    await db
      .update(schema.users)
      .set({
        resetToken,
        resetTokenExpiresAt,
        updatedAt: Date.now(),
      })
      .where(eq(schema.users.id, user.id));

    DatabaseConnection.getInstance().then((conn) => {
      conn.logAuditEvent('PASSWORD_RESET_REQUESTED', user.id, {}, user.id);
    });

    return { success: true, resetToken };
  }

  public static async resetPassword(
    token: string,
    newPassword: string,
  ): Promise<boolean> {
    if (!token || !newPassword || newPassword.length < 8) {
      throw new Error(
        'Invalid reset token or password length (minimum 8 characters)',
      );
    }

    const now = Date.now();
    const rows = await db
      .select()
      .from(schema.users)
      .where(
        and(
          eq(schema.users.resetToken, token),
          gt(schema.users.resetTokenExpiresAt, now),
        ),
      );

    if (rows.length === 0) {
      throw new Error('Reset token is invalid or has expired');
    }

    const user = rows[0];
    const passwordHash = this.hashPassword(newPassword);

    await db
      .update(schema.users)
      .set({
        passwordHash,
        resetToken: null,
        resetTokenExpiresAt: null,
        updatedAt: now,
      })
      .where(eq(schema.users.id, user.id));

    // Revoke all active sessions for security
    await db
      .delete(schema.sessions)
      .where(eq(schema.sessions.userId, user.id));

    DatabaseConnection.getInstance().then((conn) => {
      conn.logAuditEvent('PASSWORD_RESET_COMPLETED', user.id, {}, user.id);
    });

    return true;
  }

  // ==========================================================================
  // 2FA SETUP & TOGGLE
  // ==========================================================================

  public static async setup2FA(userId: string): Promise<{ secret: string }> {
    const secret = crypto.randomBytes(20).toString('hex');
    await db
      .update(schema.users)
      .set({
        twoFactorSecret: secret,
        updatedAt: Date.now(),
      })
      .where(eq(schema.users.id, userId));

    return { secret };
  }

  public static async verifyAndEnable2FA(
    userId: string,
    code: string,
  ): Promise<boolean> {
    const rows = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId));
    if (rows.length === 0) return false;
    const user = rows[0];
    if (!user.twoFactorSecret) return false;

    const valid = this.verify2FACode(user.twoFactorSecret, code);
    if (!valid) return false;

    await db
      .update(schema.users)
      .set({
        twoFactorEnabled: 1,
        updatedAt: Date.now(),
      })
      .where(eq(schema.users.id, userId));

    DatabaseConnection.getInstance().then((conn) => {
      conn.logAuditEvent('2FA_ENABLED', userId, {}, userId);
    });

    return true;
  }

  // ==========================================================================
  // BOOTSTRAP INITIAL USERS (INSTITUTIONAL OWNER ONLY)
  // ==========================================================================

  public static async ensureDefaultUsers(): Promise<void> {
    try {
      // Ensure Institutional Owner / Admin user ONLY
      const adminRows = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, 'admin@smctrading.io'));

      if (adminRows.length === 0) {
        console.info(
          '[IdentitySessionService] Bootstrapping institutional admin user: admin@smctrading.io',
        );
        const adminId = 'usr_institutional_admin';
        const passwordHash = this.hashPassword(this.BOOTSTRAP_ADMIN_PASSWORD);
        const now = Date.now();

        await db.insert(schema.users).values({
          id: adminId,
          email: 'admin@smctrading.io',
          passwordHash,
          fullName: 'Institutional System Admin',
          role: 'OWNER',
          tier: 'INSTITUTIONAL',
          status: 'ACTIVE',
          emailVerified: 1,
          twoFactorEnabled: 1,
          twoFactorSecret: this.BOOTSTRAP_ADMIN_2FA_SECRET,
          verificationToken: null,
          resetToken: null,
          resetTokenExpiresAt: null,
          createdAt: now,
          updatedAt: now,
        });

        await db.insert(schema.accessProfiles).values({
          id: `prof_${adminId}`,
          userId: adminId,
          role: 'OWNER',
          allowedAssetClasses: JSON.stringify([
            'forex',
            'indices',
            'commodities',
            'crypto',
          ]),
          maxActiveWatchlistSymbols: 100,
          canExecuteOrders: 1,
          createdAt: now,
          updatedAt: now,
        });
      } else {
        // Enforce rotated credentials on existing bootstrap admin
        const adminUser = adminRows[0];
        const newPasswordHash = this.hashPassword(this.BOOTSTRAP_ADMIN_PASSWORD);
        await db
          .update(schema.users)
          .set({
            passwordHash: newPasswordHash,
            twoFactorSecret: this.BOOTSTRAP_ADMIN_2FA_SECRET,
            twoFactorEnabled: 1,
            status: 'ACTIVE',
            updatedAt: Date.now(),
          })
          .where(eq(schema.users.id, adminUser.id));
        console.info(
          '[IdentitySessionService] Successfully rotated credentials for admin@smctrading.io.',
        );
      }
    } catch (err) {
      console.warn(
        '[IdentitySessionService] Note during default users bootstrap:',
        err,
      );
    }
  }

  // ==========================================================================
  // OWNER-ONLY USER CREATION & MANAGEMENT (MINIMAL M40 PROVISIONING)
  // ==========================================================================

  /**
   * Allows an authenticated OWNER session to provision a new user with a designated role
   * (USER, SUPPORT, ADMIN). Strictly unavailable to public unauthenticated callers.
   */
  public static async createOwnerAdminUser(params: {
    email: string;
    role: 'USER' | 'SUPPORT' | 'ADMIN';
    password?: string;
    fullName?: string;
    creatorUserId: string;
  }): Promise<{
    user: SanitizedUser;
    profile: UserAccessProfile;
    temporaryPassword?: string;
  }> {
    const { email, role, fullName, creatorUserId } = params;
    if (!email || !email.includes('@')) {
      throw new Error('Valid email address is required');
    }
    const cleanEmail = email.trim().toLowerCase();

    // Check existing
    const existing = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, cleanEmail));
    if (existing.length > 0) {
      throw new Error('A user with this email address already exists');
    }

    // Role validation: Only USER, SUPPORT, ADMIN permitted for new accounts
    if (role !== 'USER' && role !== 'SUPPORT' && role !== 'ADMIN') {
      throw new Error('Invalid role specified. Permitted roles: USER, SUPPORT, ADMIN');
    }

    const tempPassword =
      params.password && params.password.trim().length >= 8
        ? params.password.trim()
        : `SMC#${crypto.randomBytes(6).toString('hex')}!2026`;
    const passwordHash = this.hashPassword(tempPassword);
    const userId = `usr_${crypto.randomBytes(12).toString('hex')}`;
    const now = Date.now();
    const tier: UserTier =
      role === 'ADMIN' ? 'INSTITUTIONAL' : role === 'SUPPORT' ? 'TRADER' : 'FREE';

    await db.insert(schema.users).values({
      id: userId,
      email: cleanEmail,
      passwordHash,
      fullName:
        fullName ||
        (role === 'ADMIN'
          ? 'Institutional Administrator'
          : role === 'SUPPORT'
            ? 'Support Specialist'
            : 'Standard Trader'),
      role,
      tier,
      status: 'ACTIVE',
      emailVerified: 1,
      twoFactorEnabled: 0,
      twoFactorSecret: null,
      verificationToken: null,
      resetToken: null,
      resetTokenExpiresAt: null,
      createdAt: now,
      updatedAt: now,
    });

    const allowedClasses =
      role === 'ADMIN'
        ? ['forex', 'indices', 'commodities', 'crypto']
        : role === 'SUPPORT'
          ? ['forex', 'indices']
          : ['forex'];

    const profileId = `prof_${userId}`;
    await db.insert(schema.accessProfiles).values({
      id: profileId,
      userId,
      role,
      allowedAssetClasses: JSON.stringify(allowedClasses),
      maxActiveWatchlistSymbols: role === 'ADMIN' ? 100 : role === 'SUPPORT' ? 20 : 5,
      canExecuteOrders: role === 'ADMIN' ? 1 : 0,
      createdAt: now,
      updatedAt: now,
    });

    DatabaseConnection.getInstance().then((conn) => {
      conn.logAuditEvent(
        'OWNER_ADMIN_CREATE_USER',
        `user_${userId}`,
        { email: cleanEmail, role, tier },
        creatorUserId,
      );
    });

    return {
      user: {
        id: userId,
        email: cleanEmail,
        fullName: fullName || null,
        role,
        tier,
        status: 'ACTIVE',
        emailVerified: true,
        twoFactorEnabled: false,
        createdAt: now,
      },
      profile: {
        id: profileId,
        userId,
        role,
        allowedAssetClasses: allowedClasses,
        maxActiveWatchlistSymbols: role === 'ADMIN' ? 100 : role === 'SUPPORT' ? 20 : 5,
        canExecuteOrders: role === 'ADMIN',
      },
      temporaryPassword: tempPassword,
    };
  }

  /**
   * Retrieves all users for the OWNER administration dashboard.
   */
  public static async getAllUsersForOwner(): Promise<SanitizedUser[]> {
    const rows = await db
      .select({
        id: schema.users.id,
        email: schema.users.email,
        fullName: schema.users.fullName,
        role: schema.users.role,
        tier: schema.users.tier,
        status: schema.users.status,
        emailVerified: schema.users.emailVerified,
        twoFactorEnabled: schema.users.twoFactorEnabled,
        createdAt: schema.users.createdAt,
      })
      .from(schema.users);

    return rows.map((u) => ({
      id: u.id,
      email: u.email,
      fullName: u.fullName || null,
      role: (u.role as UserRole) || 'USER',
      tier: (u.tier as UserTier) || 'FREE',
      status: (u.status as UserStatus) || 'ACTIVE',
      emailVerified: Boolean(u.emailVerified),
      twoFactorEnabled: Boolean(u.twoFactorEnabled),
      createdAt: Number(u.createdAt),
    }));
  }
}
