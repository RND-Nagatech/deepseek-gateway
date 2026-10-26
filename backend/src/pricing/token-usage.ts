export interface NormalizedUsage {
  inputTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  outputTokens: number;
  totalTokens: number;
  billableTokens: number;
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' ? (value as UnknownRecord) : {};
}

function asTokenCount(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

export function normalizeDeepSeekUsage(value: unknown): NormalizedUsage | null {
  const usage = asRecord(value);
  if (Object.keys(usage).length === 0) return null;

  const promptDetails = asRecord(usage.prompt_tokens_details);
  const inputDetails = asRecord(usage.input_tokens_details);
  const inputTokens = asTokenCount(usage.prompt_tokens ?? usage.input_tokens);
  const outputTokens = asTokenCount(usage.completion_tokens ?? usage.output_tokens);
  const cacheHitTokens = Math.min(
    inputTokens,
    asTokenCount(
      usage.prompt_cache_hit_tokens ?? promptDetails.cached_tokens ?? inputDetails.cached_tokens,
    ),
  );
  const explicitMiss = usage.prompt_cache_miss_tokens;
  const cacheMissTokens = explicitMiss === undefined
    ? Math.max(0, inputTokens - cacheHitTokens)
    : Math.min(inputTokens, asTokenCount(explicitMiss));
  const totalTokens = inputTokens + outputTokens;

  return {
    inputTokens,
    cacheHitTokens,
    cacheMissTokens,
    outputTokens,
    totalTokens,
    billableTokens: totalTokens,
  };
}

export function calculateCostMicrosIdr(billableTokens: number, pricePerMillionIdr: number): string {
  const tokens = BigInt(Math.max(0, Math.floor(billableTokens)));
  const price = BigInt(Math.max(0, Math.floor(pricePerMillionIdr)));
  return (tokens * price).toString();
}

export function microsIdrToRupiah(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const decimal = typeof value === 'object' && 'toString' in value
    ? String(value)
    : String(value);
  return Number(decimal) / 1_000_000;
}

export function findUsageInPayload(value: unknown): NormalizedUsage | null {
  const payload = asRecord(value);
  const response = asRecord(payload.response);
  return normalizeDeepSeekUsage(payload.usage ?? response.usage);
}
