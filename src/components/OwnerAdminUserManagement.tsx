/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * OWNER-Only "Create User" Admin Screen (Minimal M40 User Provisioning)
 *
 * Features:
 * - Requires active OWNER session (Bearer token)
 * - Allows Owner to create accounts with roles: USER, SUPPORT, ADMIN
 * - Directly queries Cloud SQL directory to confirm active accounts
 * - Rejects any unauthenticated or non-OWNER operations
 */

import React, { useState, useEffect } from 'react';
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  UserPlus,
  Users,
  Lock,
  Key,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  Mail,
  User,
  Eye,
  EyeOff,
  LogOut,
  Sparkles,
} from 'lucide-react';
import { SanitizedUser } from '../services/identitySessionService';
import { MarketDataApiClient } from '../services/marketDataApiClient';

export function OwnerAdminUserManagement() {
  const [currentUser, setCurrentUser] = useState<SanitizedUser | null>(null);
  const [token, setToken] = useState<string | null>(MarketDataApiClient.getAuthToken());

  // Login form state
  const [adminEmail, setAdminEmail] = useState('admin@smctrading.io');
  const [adminPassword, setAdminPassword] = useState('');
  const [admin2faCode, setAdmin2faCode] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // Create User form state
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<'USER' | 'SUPPORT' | 'ADMIN'>('ADMIN');
  const [newFullName, setNewFullName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [createLoading, setCreateLoading] = useState(false);
  const [createSuccess, setCreateSuccess] = useState<{
    user: SanitizedUser;
    temporaryPassword?: string;
  } | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  // Users Directory state
  const [usersList, setUsersList] = useState<SanitizedUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Check current session on mount
  useEffect(() => {
    checkCurrentUser();
  }, [token]);

  const checkCurrentUser = async () => {
    const activeToken = MarketDataApiClient.getAuthToken();
    if (!activeToken) {
      setCurrentUser(null);
      return;
    }

    try {
      const res = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${activeToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setCurrentUser(data.user);
        if (data.user?.role === 'OWNER') {
          fetchUsers(activeToken);
        }
      } else {
        setCurrentUser(null);
      }
    } catch {
      setCurrentUser(null);
    }
  };

  const fetchUsers = async (activeToken?: string) => {
    const t = activeToken || MarketDataApiClient.getAuthToken();
    if (!t) return;
    setUsersLoading(true);
    try {
      const res = await fetch('/api/admin/users', {
        headers: { Authorization: `Bearer ${t}` },
      });
      if (res.ok) {
        const data = await res.json();
        setUsersList(data.users || []);
      }
    } catch (err) {
      console.error('Failed to load users', err);
    } finally {
      setUsersLoading(false);
    }
  };

  const handleOwnerLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginLoading(true);
    setLoginError(null);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: adminEmail,
          password: adminPassword,
          twoFactorCode: admin2faCode || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        if (data.requires2FA) {
          throw new Error('2FA code is required for the Institutional Owner account.');
        }
        throw new Error(data.error || 'Login failed');
      }

      if (data.user.role !== 'OWNER') {
        throw new Error('Access denied: You must log in as the Institutional OWNER.');
      }

      MarketDataApiClient.setAuthToken(data.sessionToken);
      setToken(data.sessionToken);
      setCurrentUser(data.user);
      setAdminPassword('');
      setAdmin2faCode('');
      fetchUsers(data.sessionToken);
    } catch (err: any) {
      setLoginError(err.message || 'Login failed');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = async () => {
    const t = MarketDataApiClient.getAuthToken();
    if (t) {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${t}` },
        });
      } catch (err) {
        console.error(err);
      }
    }
    MarketDataApiClient.setAuthToken(null);
    setToken(null);
    setCurrentUser(null);
    setUsersList([]);
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail || !newEmail.includes('@')) {
      setCreateError('Please enter a valid email address');
      return;
    }

    const t = MarketDataApiClient.getAuthToken();
    if (!t) {
      setCreateError('Active OWNER session required to create users');
      return;
    }

    setCreateLoading(true);
    setCreateError(null);
    setCreateSuccess(null);

    try {
      const res = await fetch('/api/admin/create-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${t}`,
        },
        body: JSON.stringify({
          email: newEmail.trim(),
          role: newRole,
          fullName: newFullName.trim() || undefined,
          password: newPassword.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to create user');
      }

      setCreateSuccess({
        user: data.user,
        temporaryPassword: data.temporaryPassword,
      });

      setNewEmail('');
      setNewFullName('');
      setNewPassword('');
      fetchUsers(t);
    } catch (err: any) {
      setCreateError(err.message || 'Failed to provision user');
    } finally {
      setCreateLoading(false);
    }
  };

  const generateRandomPassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
    let pwd = 'SMC#';
    for (let i = 0; i < 8; i++) {
      pwd += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    pwd += '2026!';
    setNewPassword(pwd);
  };

  const isOwner = currentUser?.role === 'OWNER';

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header Banner */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-6 backdrop-blur-md shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center space-x-4">
          <div className="h-12 w-12 rounded-xl bg-gradient-to-tr from-indigo-600 via-purple-600 to-cyan-500 flex items-center justify-center shadow-lg shadow-indigo-950/50">
            <ShieldCheck className="h-6 w-6 text-white" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-xl font-bold tracking-tight text-white uppercase">
                Owner Administration • User Provisioning
              </h2>
              <span className="px-2.5 py-0.5 rounded text-[11px] font-semibold bg-indigo-950/80 border border-indigo-700/60 text-indigo-300 font-mono flex items-center gap-1">
                <Lock className="h-3 w-3" />
                OWNER SESSION ONLY
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Authoritative privilege management console. Protected against public registration privilege escalation.
            </p>
          </div>
        </div>

        {/* Current Auth Status */}
        <div className="flex items-center gap-3">
          {currentUser ? (
            <div className="flex items-center gap-3 bg-slate-950/80 border border-slate-800 px-4 py-2 rounded-lg">
              <div className="text-right text-xs">
                <div className="font-semibold text-slate-200">{currentUser.email}</div>
                <div className="text-[10px] text-emerald-400 font-mono uppercase">
                  {currentUser.role} • {currentUser.tier}
                </div>
              </div>
              <button
                onClick={handleLogout}
                className="p-1.5 rounded bg-slate-800 hover:bg-rose-950/60 text-slate-400 hover:text-rose-300 transition-colors"
                title="Sign Out"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <span className="px-3 py-1.5 rounded text-xs font-semibold bg-amber-950/60 border border-amber-800/60 text-amber-300 flex items-center gap-1.5 font-mono">
              <ShieldAlert className="h-3.5 w-3.5" />
              NOT AUTHENTICATED AS OWNER
            </span>
          )}
        </div>
      </div>

      {!isOwner ? (
        /* OWNER Login Required Card */
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-8 backdrop-blur-md shadow-xl max-w-lg mx-auto">
          <div className="text-center mb-6">
            <div className="h-12 w-12 rounded-full bg-indigo-950 border border-indigo-800 flex items-center justify-center mx-auto mb-3 text-indigo-400">
              <Lock className="h-6 w-6" />
            </div>
            <h3 className="text-lg font-bold text-white">Owner Authentication Required</h3>
            <p className="text-xs text-slate-400 mt-1">
              Please authenticate with the Institutional Owner credentials to access user provisioning controls.
            </p>
          </div>

          {loginError && (
            <div className="mb-4 p-3 bg-rose-950/80 border border-rose-800 text-rose-200 text-xs rounded-lg flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
              <span>{loginError}</span>
            </div>
          )}

          <form onSubmit={handleOwnerLogin} className="space-y-4 text-xs">
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Owner Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                <input
                  type="email"
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                  placeholder="admin@smctrading.io"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">Owner Password</label>
              <div className="relative">
                <Key className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  className="w-full pl-9 pr-10 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                  placeholder="Enter rotated Owner password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-2.5 text-slate-500 hover:text-slate-300"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">
                6-Digit TOTP 2FA Code <span className="text-slate-500 font-normal">(RFC 6238)</span>
              </label>
              <div className="relative">
                <Shield className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                <input
                  type="text"
                  maxLength={6}
                  value={admin2faCode}
                  onChange={(e) => setAdmin2faCode(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 font-mono tracking-widest placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                  placeholder="e.g. 123456"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loginLoading}
              className="w-full mt-2 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 font-semibold text-white transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loginLoading ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Authenticating...
                </>
              ) : (
                <>
                  <Lock className="h-4 w-4" />
                  Authenticate as OWNER
                </>
              )}
            </button>
          </form>
        </div>
      ) : (
        /* OWNER Active Console: 2-Column User Provisioning & Directory */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Column 1: Create User Form (5 Cols) */}
          <div className="lg:col-span-5 bg-slate-900/90 border border-slate-800 rounded-xl p-6 backdrop-blur-md shadow-xl flex flex-col justify-between">
            <div>
              <div className="flex items-center space-x-2 pb-4 mb-4 border-b border-slate-800">
                <UserPlus className="h-5 w-5 text-indigo-400" />
                <h3 className="text-sm font-bold tracking-tight text-white uppercase">
                  Provision New Account
                </h3>
              </div>

              {createSuccess && (
                <div className="mb-4 p-4 bg-emerald-950/80 border border-emerald-800 text-emerald-200 text-xs rounded-lg space-y-2">
                  <div className="flex items-center gap-2 font-bold text-emerald-300">
                    <CheckCircle className="h-4 w-4" />
                    Account Provisioned Successfully!
                  </div>
                  <div className="font-mono text-[11px] bg-slate-950 p-2 rounded border border-emerald-900/60 space-y-1">
                    <div>
                      <span className="text-slate-400">Email:</span> {createSuccess.user.email}
                    </div>
                    <div>
                      <span className="text-slate-400">Assigned Role:</span>{' '}
                      <span className="text-amber-300 font-bold">{createSuccess.user.role}</span>
                    </div>
                    {createSuccess.temporaryPassword && (
                      <div>
                        <span className="text-slate-400">Temporary Password:</span>{' '}
                        <span className="text-cyan-300 font-bold selection:bg-cyan-500">
                          {createSuccess.temporaryPassword}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {createError && (
                <div className="mb-4 p-3 bg-rose-950/80 border border-rose-800 text-rose-200 text-xs rounded-lg flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
                  <span>{createError}</span>
                </div>
              )}

              <form onSubmit={handleCreateUser} className="space-y-4 text-xs">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    Target Email Address <span className="text-rose-400">*</span>
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                    <input
                      type="email"
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                      placeholder="e.g. analyst@smctrading.io"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    Assign Institutional Role <span className="text-rose-400">*</span>
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {(['USER', 'SUPPORT', 'ADMIN'] as const).map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setNewRole(r)}
                        className={`py-2 px-3 rounded-lg border text-center font-mono font-semibold transition-all ${
                          newRole === r
                            ? r === 'ADMIN'
                              ? 'bg-amber-950 border-amber-600 text-amber-200 shadow-sm'
                              : r === 'SUPPORT'
                                ? 'bg-cyan-950 border-cyan-600 text-cyan-200 shadow-sm'
                                : 'bg-indigo-950 border-indigo-600 text-indigo-200 shadow-sm'
                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                        }`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-slate-500 mt-1">
                    {newRole === 'ADMIN' && 'ADMIN: Institutional privileges, multi-asset execution, and administrative operations.'}
                    {newRole === 'SUPPORT' && 'SUPPORT: Elevated diagnostics and query privileges.'}
                    {newRole === 'USER' && 'USER: Standard retail trader access with personal workspace.'}
                  </p>
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Full Name</label>
                  <div className="relative">
                    <User className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                    <input
                      type="text"
                      value={newFullName}
                      onChange={(e) => setNewFullName(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                      placeholder="e.g. Institutional Analyst"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-slate-300 font-semibold">Temporary Password</label>
                    <button
                      type="button"
                      onClick={generateRandomPassword}
                      className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 font-mono"
                    >
                      <Sparkles className="h-3 w-3" /> Auto-generate
                    </button>
                  </div>
                  <div className="relative">
                    <Key className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                    <input
                      type="text"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 font-mono placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                      placeholder="Leave blank to generate automatically"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={createLoading}
                  className="w-full py-2.5 mt-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 font-semibold text-white transition-colors flex items-center justify-center gap-2 shadow-lg shadow-indigo-950/50 disabled:opacity-50"
                >
                  {createLoading ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      Provisioning Account...
                    </>
                  ) : (
                    <>
                      <UserPlus className="h-4 w-4" />
                      Provision Account as {newRole}
                    </>
                  )}
                </button>
              </form>
            </div>

            <div className="mt-6 pt-4 border-t border-slate-800/80 text-[10px] text-slate-500">
              <span className="font-semibold text-slate-400">Institutional Rule:</span> Public registration is strictly locked to USER. Roles can only be provisioned by authenticated OWNER actions.
            </div>
          </div>

          {/* Column 2: Users Directory & Identity Ledger (7 Cols) */}
          <div className="lg:col-span-7 bg-slate-900/90 border border-slate-800 rounded-xl p-6 backdrop-blur-md shadow-xl flex flex-col">
            <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-800">
              <div className="flex items-center space-x-2">
                <Users className="h-5 w-5 text-cyan-400" />
                <h3 className="text-sm font-bold tracking-tight text-white uppercase">
                  Managed Identity Ledger ({usersList.length})
                </h3>
              </div>
              <button
                onClick={() => fetchUsers()}
                disabled={usersLoading}
                className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 font-mono flex items-center gap-1.5 transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`h-3 w-3 ${usersLoading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>

            {usersLoading && usersList.length === 0 ? (
              <div className="flex-1 flex items-center justify-center py-12 text-slate-500 text-xs">
                <RefreshCw className="h-5 w-5 animate-spin mr-2" />
                Loading ledger from Cloud SQL...
              </div>
            ) : usersList.length === 0 ? (
              <div className="flex-1 flex items-center justify-center py-12 text-slate-500 text-xs">
                No users found.
              </div>
            ) : (
              <div className="overflow-x-auto flex-1">
                <table className="w-full text-left text-xs font-mono">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 text-[10px] uppercase">
                      <th className="pb-2 font-semibold">User / Email</th>
                      <th className="pb-2 font-semibold">Role</th>
                      <th className="pb-2 font-semibold">Tier</th>
                      <th className="pb-2 font-semibold">Status</th>
                      <th className="pb-2 font-semibold text-right">Created</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {usersList.map((u) => {
                      const isOwnerUser = u.role === 'OWNER';
                      const isAdminUser = u.role === 'ADMIN';
                      const isSupportUser = u.role === 'SUPPORT';
                      return (
                        <tr key={u.id} className="hover:bg-slate-800/30 transition-colors">
                          <td className="py-2.5 pr-2">
                            <div className="font-sans font-semibold text-slate-200">
                              {u.fullName || u.email.split('@')[0]}
                            </div>
                            <div className="text-[11px] text-slate-400">{u.email}</div>
                          </td>
                          <td className="py-2.5 pr-2">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                                isOwnerUser
                                  ? 'bg-purple-950/80 border-purple-700/80 text-purple-300'
                                  : isAdminUser
                                    ? 'bg-amber-950/80 border-amber-700/80 text-amber-300'
                                    : isSupportUser
                                      ? 'bg-cyan-950/80 border-cyan-700/80 text-cyan-300'
                                      : 'bg-slate-800 border-slate-700 text-slate-300'
                              }`}
                            >
                              {u.role}
                            </span>
                          </td>
                          <td className="py-2.5 pr-2 text-slate-400 text-[11px]">{u.tier}</td>
                          <td className="py-2.5 pr-2">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] ${
                                u.status === 'ACTIVE'
                                  ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                                  : 'bg-rose-950 text-rose-400 border border-rose-800'
                              }`}
                            >
                              {u.status}
                            </span>
                          </td>
                          <td className="py-2.5 text-right text-[10px] text-slate-500">
                            {new Date(u.createdAt).toLocaleDateString()}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
export default OwnerAdminUserManagement;
