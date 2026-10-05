/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * OWNER-Only Administration REST Routes
 *
 * Implements minimal M40 user provisioning and governance restricted
 * exclusively to active OWNER sessions:
 * - POST /api/admin/create-user (and POST /api/admin/users)
 * - GET  /api/admin/users
 */

import express, { Response } from 'express';
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

/**
 * 1. OWNER-Only Create User Endpoint
 * Requires active session with role 'OWNER'.
 * Public registration or non-owner callers receive 401 / 403.
 */
router.post(
  ['/create-user', '/users'],
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

/**
 * 2. OWNER-Only List Users Endpoint
 * Returns sanitized user list for the owner management panel.
 */
router.get(
  '/users',
  accessGateway({ ownerOnly: true }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const usersList = await IdentitySessionService.getAllUsersForOwner();
      await respondAndLog(
        req,
        res,
        {
          success: true,
          users: usersList,
          total: usersList.length,
        },
        { action: 'OWNER_ADMIN_LIST_USERS' },
      );
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  },
);

export default router;
