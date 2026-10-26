import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateCostMicrosIdr,
  findUsageInPayload,
  microsIdrToRupiah,
  normalizeDeepSeekUsage,
} from './token-usage';

test('cache hit and miss break down input without inflating the billed total', () => {
  const usage = normalizeDeepSeekUsage({
    prompt_tokens: 100_000,
    prompt_cache_hit_tokens: 20_000,
    prompt_cache_miss_tokens: 80_000,
    completion_tokens: 100_000,
    total_tokens: 200_000,
  });

  assert.deepEqual(usage, {
    inputTokens: 100_000,
    cacheHitTokens: 20_000,
    cacheMissTokens: 80_000,
    outputTokens: 100_000,
    totalTokens: 200_000,
    billableTokens: 200_000,
  });
  assert.equal(microsIdrToRupiah(calculateCostMicrosIdr(usage!.billableTokens, 50_000)), 10_000);
});

test('Responses API cached input is a breakdown and cache miss is derived', () => {
  const usage = findUsageInPayload({
    response: {
      usage: {
        input_tokens: 10,
        input_tokens_details: { cached_tokens: 3 },
        output_tokens: 5,
        total_tokens: 15,
      },
    },
  });

  assert.equal(usage?.cacheHitTokens, 3);
  assert.equal(usage?.cacheMissTokens, 7);
  assert.equal(usage?.billableTokens, 15);
});

test('missing usage is not treated as zero token usage', () => {
  assert.equal(normalizeDeepSeekUsage(null), null);
  assert.equal(findUsageInPayload({ id: 'request-1', choices: [] }), null);
});
