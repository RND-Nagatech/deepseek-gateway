export type View = 'overview' | 'clients' | 'usage' | 'pricing';

export interface ClientKey {
  id: string;
  keyHint: string;
  status: 'active' | 'revoked';
  lastUsedAt: string | null;
  createdAt?: string;
  balanceIdr: number;
  topUpCount: number;
  lastTopUp: { amountIdr: number; createdAt: string } | null;
}

export interface Client {
  id: string;
  name: string;
  status: 'active' | 'paused';
  createdAt: string;
  requests: number;
  billableTokens: number;
  costIdr: number;
  keys: ClientKey[];
}

export interface UsageRow {
  id: string;
  requestId: string;
  clientId: string;
  clientName: string;
  keyId: string;
  keyHint: string | null;
  path: string;
  method: string;
  model: string | null;
  statusCode: number | null;
  usageStatus: 'pending' | 'confirmed' | 'unavailable' | 'not_metered' | 'insufficient_balance';
  inputTokens: number | null;
  cacheHitTokens: number | null;
  cacheMissTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  billableTokens: number | null;
  costIdr: number;
  pricePerMillionIdr: number | null;
  startedAt: string;
  finishedAt: string | null;
  latencyMs: number | null;
}

export interface Overview {
  periodDays: number;
  totals: { requests: number; errors: number; tokens: number; costIdr: number };
  series: Array<{ date: string; tokens: number; costIdr: number }>;
  topClients: Array<{ id: string; name: string; requests: number; tokens: number; costIdr: number }>;
  latest: UsageRow[];
}

export interface Pricing {
  currency: 'IDR';
  pricePerMillionIdr: number;
  updatedAt?: string;
}

export interface Health {
  status: 'ok' | 'degraded';
  mongodb: 'connected' | 'disconnected';
  time: string;
}
