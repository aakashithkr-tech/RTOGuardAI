/**
 * Merchant Authentication, API Key Management & Billing Service.
 * Supports:
 * - 1-Click Judge & Demo Login (instant session + real keys for hackathon judges)
 * - Merchant Sign Up & Sign In
 * - Secure API Key Lifecycle: One-time secret reveal, rotation with overlap, instant revocation
 * - Metering & Quotas: Free vs Premium subscription status & usage tracking
 * - Decoupled Billing: Order creation & verification
 * - Security invariant: Full secret keys are NEVER persisted in localStorage!
 */

const RAW_API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api';
const V1_BASE_URL = RAW_API_BASE.replace(/\/api\/?$/, '') + '/v1';

const TOKEN_KEY = 'rtoguard_auth_token';
const USER_KEY = 'rtoguard_auth_user';
const KEYS_KEY = 'rtoguard_auth_keys';

export interface MerchantUser {
  id: string;
  name: string;
  email: string;
  merchant_id: string;
}

export interface ApiKeyItem {
  id: string;
  type: 'public' | 'secret';
  key?: string; // Masked for secret keys (e.g. sk_test_••••••••••••1234)
  prefix: string;
  name?: string;
  created_at: string;
  expires_at?: string | null;
  revoked_at?: string | null;
  revoked?: boolean;
  last_used_at?: string | null;
  is_revealed?: boolean;
}

export interface MerchantProfile {
  id: string;
  name: string;
  allowed_domains: string[];
  created_at: string;
  active: boolean;
  plan?: string;
  monthly_quota?: number;
  plan_expires_at?: string | null;
  billing_status?: string;
  keys: ApiKeyItem[];
}

export interface AuthSession {
  token: string;
  user: MerchantUser;
  merchant: MerchantProfile;
  keys?: ApiKeyItem[];
  secret_key_revealed?: string | null;
  warning?: string;
}

export interface BillingUsage {
  plan: string;
  plan_name: string;
  monthly_quota: number;
  used_this_month: number;
  remaining: number;
  quota_percentage: number;
  reset_at: string;
  days_until_reset: number;
  status: string;
  keys_count: number;
  max_keys: number;
  can_rotate_with_overlap: boolean;
}

export interface AuditLogItem {
  id: string;
  merchant_id: string;
  action: string;
  key_id?: string | null;
  details?: Record<string, any>;
  ip_address?: string;
  created_at: string;
}

export interface PlanDetails {
  id: string;
  name: string;
  price_inr: number;
  price_display: string;
  monthly_quota: number;
  max_key_pairs: number;
  rate_limit_per_min: number;
  rotation_overlap_hours: number;
  features: string[];
}

export function getStoredAuthToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredAuthToken(token: string | null): void {
  try {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  } catch {
    // ignore
  }
}

export function getStoredUser(): MerchantUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setStoredUser(user: MerchantUser | null): void {
  try {
    if (user) {
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(USER_KEY);
    }
  } catch {
    // ignore
  }
}

/**
 * Sanitize keys before saving to localStorage to prevent storing
 * full unmasked plaintext secret keys in browser storage.
 */
function sanitizeKeysForStorage(keys: ApiKeyItem[]): ApiKeyItem[] {
  return keys.map((k) => {
    if (k.type === 'secret') {
      const isPlaintext = k.key && !k.key.includes('•') && k.key.length > 20;
      return {
        ...k,
        key: isPlaintext
          ? `${k.prefix}••••••••••••${k.key?.slice(-4) || 'xxxx'}`
          : k.key || `${k.prefix}••••••••••••••••`,
        is_revealed: false,
      };
    }
    return k;
  });
}

export function getStoredKeys(): ApiKeyItem[] | null {
  try {
    const raw = localStorage.getItem(KEYS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setStoredKeys(keys: ApiKeyItem[] | null): void {
  try {
    if (keys) {
      const sanitized = sanitizeKeysForStorage(keys);
      localStorage.setItem(KEYS_KEY, JSON.stringify(sanitized));
    } else {
      localStorage.removeItem(KEYS_KEY);
    }
  } catch {
    // ignore
  }
}

export function clearAuth(): void {
  setStoredAuthToken(null);
  setStoredUser(null);
  setStoredKeys(null);
}

function handleAuthResponse(data: AuthSession): AuthSession {
  if (data.token) {
    setStoredAuthToken(data.token);
  }
  if (data.user) {
    setStoredUser(data.user);
  }
  if (data.keys && data.keys.length > 0) {
    setStoredKeys(data.keys);
  }
  return data;
}

export async function signupMerchant(payload: {
  name: string;
  email: string;
  password: string;
  store_name?: string;
  allowed_domains?: string[];
}): Promise<AuthSession> {
  const res = await fetch(`${V1_BASE_URL}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const body = await res.json();
  if (!res.ok) {
    const msg = body?.error?.message || 'Failed to create merchant account.';
    throw new Error(msg);
  }

  return handleAuthResponse(body);
}

export async function loginMerchant(payload: {
  email: string;
  password: string;
}): Promise<AuthSession> {
  const res = await fetch(`${V1_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const body = await res.json();
  if (!res.ok) {
    const msg = body?.error?.message || 'Invalid email or password.';
    throw new Error(msg);
  }

  return handleAuthResponse(body);
}

export async function demoJudgeLogin(): Promise<AuthSession> {
  const res = await fetch(`${V1_BASE_URL}/auth/demo-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });

  const body = await res.json();
  if (!res.ok) {
    const msg = body?.error?.message || '1-Click Judge login failed.';
    throw new Error(msg);
  }

  return handleAuthResponse(body);
}

export async function fetchCurrentUser(): Promise<{
  user: MerchantUser;
  merchant: MerchantProfile;
} | null> {
  const token = getStoredAuthToken();
  if (!token) return null;

  try {
    const res = await fetch(`${V1_BASE_URL}/auth/me`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      if (res.status === 401) {
        clearAuth();
      }
      return null;
    }

    const body = await res.json();
    if (body?.user) {
      setStoredUser(body.user);
    }
    if (body?.merchant?.keys) {
      setStoredKeys(body.merchant.keys);
    }
    return body;
  } catch {
    return null;
  }
}

/**
 * Generate a new API key pair. Returns the list of keys, plus the revealed secret key
 * which is shown ONCE to the user.
 */
export async function generateNewKeys(payload?: {
  key_type?: string;
  name?: string;
}): Promise<{
  keys: ApiKeyItem[];
  secret_key_revealed?: string;
  warning?: string;
}> {
  const token = getStoredAuthToken();
  if (!token) {
    throw new Error('Please sign in to generate keys.');
  }

  const res = await fetch(`${V1_BASE_URL}/auth/keys`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload || {}),
  });

  const body = await res.json();
  if (!res.ok) {
    const msg = body?.error?.message || 'Failed to generate API keys.';
    throw new Error(msg);
  }

  const keys: ApiKeyItem[] = body.keys || [];
  setStoredKeys(keys);
  return {
    keys,
    secret_key_revealed: body.secret_key_revealed,
    warning: body.warning,
  };
}

/**
 * Rotate an existing key pair with an optional overlap grace period.
 */
export async function rotateApiKey(payload: {
  old_key_id: string;
  overlap_hours?: number;
  name?: string;
}): Promise<{
  keys: ApiKeyItem[];
  new_secret_key?: string;
  secret_key_revealed?: string;
  overlap_expires_at?: string;
  message?: string;
}> {
  const token = getStoredAuthToken();
  if (!token) {
    throw new Error('Please sign in to rotate keys.');
  }

  const res = await fetch(`${V1_BASE_URL}/auth/keys/rotate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  const body = await res.json();
  if (!res.ok) {
    const msg = body?.error?.message || 'Failed to rotate API key.';
    throw new Error(msg);
  }

  const keys: ApiKeyItem[] = body.keys || [];
  setStoredKeys(keys);
  return {
    keys,
    new_secret_key: body.new_secret_key || body.secret_key_revealed,
    secret_key_revealed: body.secret_key_revealed || body.new_secret_key,
    overlap_expires_at: body.overlap_expires_at,
    message: body.message,
  };
}

/**
 * Permanently revoke an API key.
 */
export async function revokeApiKey(keyId: string): Promise<{
  ok: boolean;
  revoked_key_id: string;
  message: string;
}> {
  const token = getStoredAuthToken();
  if (!token) {
    throw new Error('Please sign in to revoke keys.');
  }

  const res = await fetch(`${V1_BASE_URL}/auth/keys/${encodeURIComponent(keyId)}/revoke`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });

  const body = await res.json();
  if (!res.ok) {
    const msg = body?.error?.message || 'Failed to revoke API key.';
    throw new Error(msg);
  }

  return body;
}

/**
 * Fetch merchant security audit logs.
 */
export async function fetchAuditLogs(): Promise<AuditLogItem[]> {
  const token = getStoredAuthToken();
  if (!token) return [];

  try {
    const res = await fetch(`${V1_BASE_URL}/auth/audit-logs`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) return [];
    const body = await res.json();
    return body.audit_logs || [];
  } catch {
    return [];
  }
}

/**
 * Fetch billing usage & quota status.
 */
export async function fetchBillingUsage(): Promise<BillingUsage | null> {
  const token = getStoredAuthToken();
  if (!token) return null;

  try {
    const res = await fetch(`${V1_BASE_URL}/billing/usage`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Fetch available billing plans.
 */
export async function fetchBillingPlans(): Promise<PlanDetails[]> {
  try {
    const res = await fetch(`${V1_BASE_URL}/billing/plans`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!res.ok) return [];
    const body = await res.json();
    return body.plans || [];
  } catch {
    return [];
  }
}

/**
 * Create a billing subscription order.
 */
export async function createBillingOrder(plan: string = 'premium'): Promise<{
  order_id: string;
  amount: number;
  currency: string;
  plan: string;
  key_id?: string;
  provider: string;
}> {
  const token = getStoredAuthToken();
  if (!token) {
    throw new Error('Please sign in to upgrade subscription.');
  }

  const res = await fetch(`${V1_BASE_URL}/billing/create-order`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ plan }),
  });

  const body = await res.json();
  if (!res.ok) {
    const msg = body?.error?.message || 'Failed to create subscription order.';
    throw new Error(msg);
  }

  return body;
}

/**
 * Verify subscription payment signature and activate plan.
 */
export async function verifyBillingPayment(payload: {
  order_id: string;
  payment_id: string;
  signature?: string;
  plan: string;
}): Promise<{
  ok: boolean;
  plan: string;
  monthly_quota: number;
  message: string;
}> {
  const token = getStoredAuthToken();
  if (!token) {
    throw new Error('Please sign in to verify payment.');
  }

  const res = await fetch(`${V1_BASE_URL}/billing/verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  const body = await res.json();
  if (!res.ok) {
    const msg = body?.error?.message || 'Payment verification failed.';
    throw new Error(msg);
  }

  return body;
}
