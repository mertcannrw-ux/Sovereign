'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Shield,
  Mail,
  Globe,
  GitBranch,
  Link,
  Clock,
  Plus,
  Trash2,
  Save,
  Loader2,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@app-builder/ui/utils';

/* ── Types ───────────────────────────────────────────────── */

interface RoleDef {
  name: string;
  description?: string;
}

interface PermissionDef {
  role: string;
  resource: string;
  action: 'create' | 'read' | 'update' | 'delete' | '*';
}

interface BrandingConfig {
  logoUrl?: string;
  primaryColor?: string;
  appName?: string;
}

interface AuthConfig {
  id: string;
  projectId: string;
  emailAuth: boolean;
  googleAuth: boolean;
  githubAuth: boolean;
  magicLinkAuth: boolean;
  sessionDuration: number;
  roles: RoleDef[];
  permissions: PermissionDef[];
  branding: BrandingConfig | null;
}

interface AppUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

/* ── Props ──────────────────────────────────────────────────── */

interface AuthSettingsProps {
  projectId: string;
}

/* ── Constants ──────────────────────────────────────────────── */

const RESOURCES = ['*', 'users', 'posts', 'comments', 'settings', 'files', 'analytics'];
const ACTIONS: PermissionDef['action'][] = ['create', 'read', 'update', 'delete', '*'];

/* ── Component ──────────────────────────────────────────────── */

export function AuthSettings({ projectId }: AuthSettingsProps) {
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [isLoadingConfig, setIsLoadingConfig] = useState(true);
  const [isLoadingUsers, setIsLoadingUsers] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{ success: boolean; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saveResultTimerRef = useRef<number | undefined>(undefined);

  // New user form
  const [showNewUser, setShowNewUser] = useState(false);
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserName, setNewUserName] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserRole, setNewUserRole] = useState('user');
  const [isCreatingUser, setIsCreatingUser] = useState(false);

  // Role management
  const [roles, setRoles] = useState<RoleDef[]>([]);
  const [permissions, setPermissions] = useState<PermissionDef[]>([]);
  const [branding, setBranding] = useState<BrandingConfig>({});

  // Delete user confirmation
  const [deleteUserId, setDeleteUserId] = useState<string | null>(null);

  useEffect(() => {
    loadConfig();
    loadUsers();
  }, [projectId]);

  useEffect(() => {
    return () => {
      clearTimeout(saveResultTimerRef.current);
    };
  }, []);

  const loadConfig = async () => {
    setIsLoadingConfig(true);
    try {
      const response = await fetch('/api/trpc/appAuth.getConfig', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      });
      const data = await response.json();
      if (data.result?.data) {
        const c = data.result.data as AuthConfig;
        setConfig(c);
        setRoles(c.roles as RoleDef[]);
        setPermissions(c.permissions as PermissionDef[]);
        setBranding(c.branding ?? {});
      } else {
        setError('Failed to load auth configuration');
      }
    } catch {
      setError('Failed to connect to server');
    } finally {
      setIsLoadingConfig(false);
    }
  };

  const loadUsers = async () => {
    setIsLoadingUsers(true);
    try {
      const response = await fetch('/api/trpc/appAuth.listUsers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      });
      const data = await response.json();
      if (data.result?.data) {
        setUsers(data.result.data as AppUser[]);
      }
    } catch {
      // silently fail
    } finally {
      setIsLoadingUsers(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveResult(null);
    try {
      const response = await fetch('/api/trpc/appAuth.updateConfig', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          config: {
            ...(config && {
              emailAuth: config.emailAuth,
              googleAuth: config.googleAuth,
              githubAuth: config.githubAuth,
              magicLinkAuth: config.magicLinkAuth,
              sessionDuration: config.sessionDuration,
            }),
            roles,
            permissions,
            branding,
          },
        }),
      });
      const data = await response.json();
      if (data.result?.data) {
        setConfig(data.result.data as AuthConfig);
        setSaveResult({ success: true, message: 'Auth settings saved successfully' });
        clearTimeout(saveResultTimerRef.current);
        saveResultTimerRef.current = window.setTimeout(() => setSaveResult(null), 3000);
      } else {
        const errorMessage = data.error?.message ?? 'Failed to save';
        setSaveResult({ success: false, message: errorMessage });
      }
    } catch {
      setSaveResult({ success: false, message: 'Failed to connect to server' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreateUser = async () => {
    if (!newUserEmail.trim()) return;
    setIsCreatingUser(true);
    try {
      const response = await fetch('/api/trpc/appAuth.createUser', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          email: newUserEmail.trim(),
          name: newUserName.trim() || undefined,
          password: newUserPassword || undefined,
          role: newUserRole,
        }),
      });
      const data = await response.json();
      if (data.result?.data) {
        setShowNewUser(false);
        setNewUserEmail('');
        setNewUserName('');
        setNewUserPassword('');
        setNewUserRole('user');
        await loadUsers();
      } else {
        const errorMessage = data.error?.message ?? 'Failed to create user';
        setError(errorMessage);
      }
    } catch {
      setError('Failed to create user');
    } finally {
      setIsCreatingUser(false);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    try {
      const response = await fetch('/api/trpc/appAuth.deleteUser', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, userId }),
      });
      const data = await response.json();
      if (data.result?.data?.success) {
        setDeleteUserId(null);
        await loadUsers();
      }
    } catch {
      // silently fail
    }
  };

  const addRole = () => {
    setRoles([...roles, { name: '', description: '' }]);
  };

  const updateRole = (index: number, field: keyof RoleDef, value: string) => {
    setRoles(roles.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
  };

  const removeRole = (index: number) => {
    setRoles(roles.filter((_, i) => i !== index));
  };

  const addPermission = () => {
    setPermissions([...permissions, { role: 'user', resource: '*', action: 'read' }]);
  };

  const updatePermission = (index: number, field: keyof PermissionDef, value: string) => {
    setPermissions(
      permissions.map((p, i) =>
        i === index ? { ...p, [field]: value as PermissionDef['action'] } : p,
      ),
    );
  };

  const removePermission = (index: number) => {
    setPermissions(permissions.filter((_, i) => i !== index));
  };

  const formatSessionDuration = (seconds: number): string => {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
    return `${Math.floor(seconds / 86400)}d`;
  };

  if (isLoadingConfig) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-foreground-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold text-foreground">Authentication</h2>
        <p className="mt-1 text-sm text-foreground-muted">
          Configure how users sign in and manage permissions for your generated app.
        </p>
      </div>

      <Separator />

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 rounded-md border border-error/30 bg-error-light p-3 text-sm text-error">
          <XCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Save result */}
      {saveResult && (
        <div
          className={cn(
            'flex items-center gap-2 rounded-md border p-3 text-sm',
            saveResult.success
              ? 'border-success/30 bg-success-light text-success'
              : 'border-error/30 bg-error-light text-error',
          )}
        >
          {saveResult.success ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          ) : (
            <XCircle className="h-4 w-4 shrink-0" />
          )}
          {saveResult.message}
        </div>
      )}

      {/* ── Auth Providers ────────────────────────────────── */}
      {config && (
        <>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-foreground-secondary">
                <Shield className="h-4 w-4" />
                Auth Providers
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-light text-primary">
                    <Mail className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">Email / Password</p>
                    <p className="text-xs text-foreground-muted">
                      Users sign in with email and password
                    </p>
                  </div>
                </div>
                <Switch
                  checked={config.emailAuth}
                  onCheckedChange={(checked) => setConfig({ ...config, emailAuth: checked })}
                />
              </div>

              <Separator />

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-background-muted">
                    <Globe className="h-4 w-4 text-foreground-secondary" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">Google OAuth</p>
                    <p className="text-xs text-foreground-muted">Sign in with Google accounts</p>
                  </div>
                </div>
                <Switch
                  checked={config.googleAuth}
                  onCheckedChange={(checked) => setConfig({ ...config, googleAuth: checked })}
                />
              </div>

              <Separator />

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-background-muted">
                    <GitBranch className="h-4 w-4 text-foreground-secondary" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">GitHub OAuth</p>
                    <p className="text-xs text-foreground-muted">Sign in with GitHub accounts</p>
                  </div>
                </div>
                <Switch
                  checked={config.githubAuth}
                  onCheckedChange={(checked) => setConfig({ ...config, githubAuth: checked })}
                />
              </div>

              <Separator />

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-background-muted">
                    <Link className="h-4 w-4 text-foreground-secondary" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">Magic Link</p>
                    <p className="text-xs text-foreground-muted">
                      Passwordless sign-in via email link
                    </p>
                  </div>
                </div>
                <Switch
                  checked={config.magicLinkAuth}
                  onCheckedChange={(checked) => setConfig({ ...config, magicLinkAuth: checked })}
                />
              </div>
            </CardContent>
          </Card>

          {/* ── Session Duration ───────────────────────────── */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-foreground-secondary">
                <Clock className="h-4 w-4" />
                Session Duration
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3">
                <Input
                  type="number"
                  min={60}
                  max={2592000}
                  value={config.sessionDuration}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (!isNaN(val)) {
                      setConfig({ ...config, sessionDuration: val });
                    }
                  }}
                  className="h-8 w-32 text-sm"
                />
                <span className="text-sm text-foreground-muted">
                  seconds ({formatSessionDuration(config.sessionDuration)})
                </span>
              </div>
              <p className="mt-1.5 text-xs text-foreground-muted">
                How long a session remains valid before requiring re-authentication. Min: 60s, Max:
                30 days.
              </p>
            </CardContent>
          </Card>

          {/* ── Roles & Permissions ────────────────────────── */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center justify-between text-sm font-medium text-foreground-secondary">
                <span className="flex items-center gap-2">
                  <Shield className="h-4 w-4" />
                  Roles &amp; Permissions
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Roles */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <Label>Roles</Label>
                  <Button variant="outline" size="sm" onClick={addRole} className="gap-1">
                    <Plus className="h-3 w-3" />
                    Add Role
                  </Button>
                </div>
                <div className="space-y-2">
                  {roles.length === 0 && (
                    <p className="py-2 text-xs text-foreground-muted">
                      No custom roles defined. Default roles: admin, user.
                    </p>
                  )}
                  {roles.map((role, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <Input
                        placeholder="Role name"
                        value={role.name}
                        onChange={(e) => updateRole(idx, 'name', e.target.value)}
                        className="h-8 w-40 text-sm"
                      />
                      <Input
                        placeholder="Description (optional)"
                        value={role.description ?? ''}
                        onChange={(e) => updateRole(idx, 'description', e.target.value)}
                        className="h-8 flex-1 text-sm"
                      />
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => removeRole(idx)}
                        className="shrink-0 text-foreground-muted hover:text-error"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>

              <Separator />

              {/* Permissions */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <Label>Permissions</Label>
                  <Button variant="outline" size="sm" onClick={addPermission} className="gap-1">
                    <Plus className="h-3 w-3" />
                    Add Permission
                  </Button>
                </div>
                <div className="space-y-2">
                  {permissions.length === 0 && (
                    <p className="py-2 text-xs text-foreground-muted">
                      No custom permissions. All authenticated users have full access by default.
                    </p>
                  )}
                  {permissions.map((perm, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <Input
                        placeholder="Role"
                        value={perm.role}
                        onChange={(e) => updatePermission(idx, 'role', e.target.value)}
                        className="h-8 w-32 text-sm"
                      />
                      <select
                        value={perm.resource}
                        onChange={(e) => updatePermission(idx, 'resource', e.target.value)}
                        className="focus-visible:ring-focus-ring h-8 rounded-md border border-border bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2"
                      >
                        {RESOURCES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                      <select
                        value={perm.action}
                        onChange={(e) => updatePermission(idx, 'action', e.target.value)}
                        className="focus-visible:ring-focus-ring h-8 rounded-md border border-border bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2"
                      >
                        {ACTIONS.map((a) => (
                          <option key={a} value={a}>
                            {a}
                          </option>
                        ))}
                      </select>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => removePermission(idx)}
                        className="shrink-0 text-foreground-muted hover:text-error"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ── Branding ───────────────────────────────────── */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-foreground-secondary">
                Branding
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>App Name</Label>
                <Input
                  placeholder="My App"
                  value={branding.appName ?? ''}
                  onChange={(e) => setBranding({ ...branding, appName: e.target.value })}
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-2">
                <Label>Logo URL</Label>
                <Input
                  placeholder="https://example.com/logo.png"
                  value={branding.logoUrl ?? ''}
                  onChange={(e) => setBranding({ ...branding, logoUrl: e.target.value })}
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-2">
                <Label>Primary Color</Label>
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="#2563EB"
                    value={branding.primaryColor ?? ''}
                    onChange={(e) => setBranding({ ...branding, primaryColor: e.target.value })}
                    className="h-8 w-32 font-mono text-sm"
                  />
                  <div
                    className="h-8 w-8 rounded-md border border-border"
                    style={{
                      backgroundColor: branding.primaryColor || '#2563EB',
                    }}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ── Save Button ────────────────────────────────── */}
          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={isSaving} className="gap-1.5">
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Save Settings
            </Button>
          </div>
        </>
      )}

      <Separator className="my-2" />

      {/* ── App Users ──────────────────────────────────────── */}
      <div>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-foreground">App Users</h3>
            <p className="text-sm text-foreground-muted">
              Manage users registered in your generated app.
            </p>
          </div>
          <Button
            variant="default"
            size="sm"
            onClick={() => setShowNewUser(!showNewUser)}
            className="gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            Add User
          </Button>
        </div>

        {/* New user form */}
        {showNewUser && (
          <Card className="mb-4 border-primary/30">
            <CardContent className="p-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Email *</Label>
                  <Input
                    placeholder="user@example.com"
                    value={newUserEmail}
                    onChange={(e) => setNewUserEmail(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Name</Label>
                  <Input
                    placeholder="Full name"
                    value={newUserName}
                    onChange={(e) => setNewUserName(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Password</Label>
                  <Input
                    type="password"
                    placeholder="Leave blank for magic link"
                    value={newUserPassword}
                    onChange={(e) => setNewUserPassword(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Role</Label>
                  <select
                    value={newUserRole}
                    onChange={(e) => setNewUserRole(e.target.value)}
                    className="focus-visible:ring-focus-ring h-8 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2"
                  >
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                    {roles.map((r) => (
                      <option key={r.name} value={r.name}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setShowNewUser(false);
                    setNewUserEmail('');
                    setNewUserName('');
                    setNewUserPassword('');
                    setNewUserRole('user');
                  }}
                >
                  Cancel
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  onClick={handleCreateUser}
                  disabled={isCreatingUser || !newUserEmail.trim()}
                >
                  {isCreatingUser ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                  Create User
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Users list */}
        <Card>
          <CardContent className="p-0">
            {isLoadingUsers ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-foreground-muted" />
              </div>
            ) : users.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8">
                <Shield className="h-8 w-8 text-foreground-muted" />
                <p className="text-sm text-foreground-muted">
                  No users yet. Users appear here once they sign up.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                <div className="grid grid-cols-5 gap-4 px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-foreground-muted">
                  <span>Email</span>
                  <span>Name</span>
                  <span>Role</span>
                  <span>Status</span>
                  <span className="text-right">Actions</span>
                </div>
                {users.map((user) => (
                  <div
                    key={user.id}
                    className="grid grid-cols-5 items-center gap-4 px-4 py-3 text-sm"
                  >
                    <span className="truncate text-foreground">{user.email}</span>
                    <span className="truncate text-foreground-secondary">{user.name ?? '-'}</span>
                    <span>
                      <Badge
                        variant={user.role === 'admin' ? 'default' : 'secondary'}
                        className="text-xs"
                      >
                        {user.role}
                      </Badge>
                    </span>
                    <span>
                      <Badge variant={user.isActive ? 'success' : 'secondary'}>
                        {user.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </span>
                    <span className="flex justify-end">
                      {deleteUserId === user.id ? (
                        <div className="flex items-center gap-1">
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => handleDeleteUser(user.id)}
                            className="h-7 px-2 text-xs"
                          >
                            Confirm
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeleteUserId(null)}
                            className="h-7 px-2 text-xs"
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => setDeleteUserId(user.id)}
                          className="text-foreground-muted hover:text-error"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
