const API_BASE = '/api';

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiRequest<T>(
  path: string,
  adminToken: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      'X-Admin-Token': adminToken,
      ...init.headers,
    },
  });

  const payload = await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    const message = payload && typeof payload === 'object' && 'message' in payload
      ? String((payload as { message: unknown }).message)
      : payload && typeof payload === 'object' && 'error' in payload
        ? String(((payload as { error?: { message?: unknown } }).error?.message) ?? 'Request failed.')
        : 'Request failed. Check the backend and admin token.';
    throw new ApiError(message, response.status);
  }
  return payload as T;
}

export async function checkHealth() {
  const response = await fetch(`${API_BASE}/health`);
  return await response.json();
}
