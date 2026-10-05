/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Authentication & Identity REST Routes
 *
 * Exposes M34 Identity & Session endpoints:
 * - POST /api/auth/register
 * - POST /api/auth/login
 * - POST /api/auth/logout
 * - GET  /api/auth/me
 * - POST /api/auth/verify-email
 * - POST /api/auth/forgot-password
 * - POST /api/auth/reset-password
 * - POST /api/auth/2fa/setup
 * - POST /api/auth/2fa/verify
 */

import express, { Request, Response } from 'express';
import {
  IdentitySessionService,
  UserRole,
} from '../services/identitySessionService';
import {
  accessGateway,
  AuthenticatedRequest,
  respondAndLog,
} from '../services/accessGateway';

const router = express.Router();

// 1. User Registration
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { email, password, fullName } = req.body;
    const ipAddress = req.ip || (req.headers['x-forwarded-for'] as string);

    // SECURITY HARDENING: Public registration strictly hardcodes role: 'USER'.
    // Any role field provided in req.body is completely ignored to prevent privilege escalation.
    const result = await IdentitySessionService.register({
      email,
      password,
      fullName,
      role: 'USER',
      ipAddress,
    });

    // SECURITY HARDENING: verificationToken is removed from response body entirely.
    // Tokens are dispatched strictly out-of-band via email.
    res.status(201).json({
      success: true,
      user: result.user,
      message:
        'Registration successful. Please verify your email to activate full privileges.',
    });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 2. User Login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password, twoFactorCode } = req.body;
    const deviceInfo = req.headers['user-agent'] as string;
    const ipAddress = req.ip || (req.headers['x-forwarded-for'] as string);

    const result = await IdentitySessionService.login({
      email,
      password,
      twoFactorCode,
      deviceInfo,
      ipAddress,
    });

    res.json({
      success: true,
      user: result.user,
      sessionToken: result.sessionToken,
      expiresAt: result.expiresAt,
      profile: result.profile,
    });
  } catch (err: any) {
    const message = err.message || 'Login failed';
    if (message.includes('2FA_REQUIRED')) {
      res.status(401).json({
        success: false,
        requires2FA: true,
        error: message,
      });
    } else if (message.includes('Too many failed')) {
      res.status(429).json({ success: false, error: message });
    } else if (message.includes('suspended')) {
      res.status(403).json({ success: false, error: message });
    } else {
      res.status(401).json({ success: false, error: message });
    }
  }
});

// 3. User Logout
router.post('/logout', async (req: Request, res: Response) => {
  let token: string | undefined;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  }

  if (token) {
    await IdentitySessionService.logout(token, req.ip);
  }

  res.json({ success: true, message: 'Logged out successfully' });
});

// 4. Current User Profile
router.get(
  '/me',
  accessGateway(),
  async (req: AuthenticatedRequest, res: Response) => {
    await respondAndLog(
      req,
      res,
      {
        user: req.user,
        session: req.session,
        profile: req.profile,
      },
      { action: 'AUTH_ME' },
    );
  },
);

// 5. Verify Email
router.post('/verify-email', async (req: Request, res: Response) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res
        .status(400)
        .json({ success: false, error: 'Verification token is required' });
    }

    const verified = await IdentitySessionService.verifyEmail(token);
    if (!verified) {
      return res
        .status(400)
        .json({ success: false, error: 'Invalid or expired verification token' });
    }

    res.json({
      success: true,
      message: 'Email successfully verified.',
    });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 6. Request Password Reset (Forgot Password)
router.post('/forgot-password', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res
        .status(400)
        .json({ success: false, error: 'Email is required' });
    }

    await IdentitySessionService.requestPasswordReset(email);

    // SECURITY HARDENING: resetToken is strictly removed from the response body.
    // Password reset links must only be delivered out-of-band to the user's verified email.
    res.json({
      success: true,
      message:
        'If the email exists, a password reset link has been dispatched to your email address.',
    });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 7. Reset Password
router.post('/reset-password', async (req: Request, res: Response) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) {
      return res.status(400).json({
        success: false,
        error: 'Reset token and new password are required',
      });
    }

    await IdentitySessionService.resetPassword(token, newPassword);
    res.json({
      success: true,
      message:
        'Password has been reset successfully. Please log in with your new password.',
    });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 8. 2FA Setup
router.post(
  '/2fa/setup',
  accessGateway(),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await IdentitySessionService.setup2FA(req.user!.id);
      await respondAndLog(
        req,
        res,
        {
          secret: result.secret,
          message:
            'Use this secret code to configure your authenticator app or submit to /api/auth/2fa/verify to enable.',
        },
        { action: '2FA_SETUP' },
      );
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  },
);

// 9. 2FA Verify & Enable
router.post(
  '/2fa/verify',
  accessGateway(),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { code } = req.body;
      if (!code) {
        return res
          .status(400)
          .json({ success: false, error: '2FA code is required' });
      }

      const verified = await IdentitySessionService.verifyAndEnable2FA(
        req.user!.id,
        code,
      );
      if (!verified) {
        return res
          .status(400)
          .json({ success: false, error: 'Invalid two-factor code' });
      }

      await respondAndLog(
        req,
        res,
        {
          success: true,
          message: 'Two-factor authentication has been successfully enabled.',
        },
        { action: '2FA_ENABLED' },
      );
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  },
);

// 10. OWNER-Only User Creation (Minimal M40 Provisioning)
router.post(
  '/admin/create-user',
  accessGateway({ ownerOnly: true }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { email, role, password, fullName } = req.body;

      if (!email || typeof email !== 'string') {
        return res
          .status(400)
          .json({ success: false, error: 'Email address is required' });
      }

      if (!role || (role !== 'USER' && role !== 'SUPPORT' && role !== 'ADMIN')) {
        return res.status(400).json({
          success: false,
          error: 'Valid role is required (USER, SUPPORT, ADMIN)',
        });
      }

      const result = await IdentitySessionService.createOwnerAdminUser({
        email,
        role: role as 'USER' | 'SUPPORT' | 'ADMIN',
        password,
        fullName,
        creatorUserId: req.user!.id,
      });

      await respondAndLog(
        req,
        res,
        {
          success: true,
          user: result.user,
          profile: result.profile,
          temporaryPassword: result.temporaryPassword,
          message: `User ${result.user.email} successfully provisioned as ${result.user.role}.`,
        },
        { action: 'OWNER_ADMIN_CREATE_USER', statusCode: 201 },
      );
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  },
);

export default router;
