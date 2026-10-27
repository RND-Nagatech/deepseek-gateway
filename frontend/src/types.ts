export type View = 'overview' | 'clients' | 'usage' | 'pricing';
export type TopUpStatus = 'creating' | 'pending' | 'paid' | 'expired' | 'failed' | 'needs_review';
export type TopUpMethod = 'qris' | 'va';
export type SingaPayVaBankCode = 'BCA' | 'BNI' | 'BRI' | 'MANDIRI' | 'PERMATA' | 'MAYBANK' | 'CIMB' | 'BSI' | 'MUAMALAT' | 'BNC' | 'OCBC' | 'DANAMON';

export interface TopUp {
  amountIdr: number;
  currency: 'IDR';
  method: TopUpMethod;
  status: TopUpStatus;
  source: 'manual' | 'singapay';
  merchantRef: string | null;
  providerReference: string | null;
  qrData: string | null;
  vaNumber: string | null;
  bankCode: SingaPayVaBankCode | null;
  bankName: string | null;
  expiresAt: string | null;
  createdAt: string;
  paidAt: string | null;
  reviewReason: string | null;
}

export interface ClientKey {
  id: string;
  keyHint: string;
  status: 'active' | 'revoked';
  lastUsedAt: string | null;
  createdAt?: string;
  balanceIdr: number;
  topUpCount: number;
  lastTopUp: {
    amountIdr: number;
    createdAt: string;
    source?: 'manual' | 'singapay';
    status?: TopUpStatus;
    method?: TopUpMethod | null;
    merchantRef?: string | null;
    expiresAt?: string | null;
    paidAt?: string | null;
    reviewReason?: string | null;
    reason?: string | null;
  } | null;
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
