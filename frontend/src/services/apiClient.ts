const DEFAULT_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api';

export type DataSourceMode = 'DEMO_MOCK' | 'LIVE_BACKEND';

const MODE_STORAGE_KEY = 'rtoguard_combined_data_source_mode_v1';

export function getDataSourceMode(): DataSourceMode {
  try {
    const saved = localStorage.getItem(MODE_STORAGE_KEY);
    if (saved === 'LIVE_BACKEND' || saved === 'DEMO_MOCK') return saved;
  } catch {
    // localStorage may be unavailable in restricted browser contexts.
  }

  // Fresh installs use the mode configured in .env. The combined project ships
  // with LIVE_BACKEND so the UI talks to the included FastAPI service by default.
  return import.meta.env.VITE_DEFAULT_DATA_MODE === 'LIVE_BACKEND'
    ? 'LIVE_BACKEND'
    : 'DEMO_MOCK';
}

export function setDataSourceMode(mode: DataSourceMode): void {
  try {
    localStorage.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    // ignore
  }
}

export class ApiError extends Error {
  public status?: number;
  public details?: any;

  constructor(message: string, status?: number, details?: any) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

export async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${DEFAULT_BASE_URL}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  try {
    const res = await fetch(url, { ...options, headers });
    if (!res.ok) {
      let errorBody = {};
      try {
        errorBody = await res.json();
      } catch {
        // ignore
      }
      const body = errorBody as { message?: string; detail?: unknown };
      const detail = typeof body.detail === 'string'
        ? body.detail
        : body.detail !== undefined
          ? JSON.stringify(body.detail)
          : undefined;
      throw new ApiError(
        body.message || detail || `HTTP ${res.status}: Failed request to ${endpoint}`,
        res.status,
        errorBody
      );
    }
    return (await res.json()) as T;
  } catch (err: any) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(
      `Network connection failed to backend at ${url}. ${err.message || ''}`,
      0,
      err
    );
  }
}
