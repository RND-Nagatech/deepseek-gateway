import assert from 'node:assert/strict';
import test from 'node:test';
import { SseUsageSniffer } from './sse-usage-sniffer';

test('reads Chat Completions usage from a final SSE chunk split across network frames', () => {
  const sniffer = new SseUsageSniffer();
  sniffer.push(new TextEncoder().encode('data: {"id":"chat-1","usage":{"prompt_tokens":10,"prompt_cache_hit_tokens":4,"prompt_cache_miss_tokens":6,'));
  sniffer.push(new TextEncoder().encode('"completion_tokens":5,"total_tokens":15}}\n\ndata: [DONE]\n\n'));

  const result = sniffer.finish();
  assert.equal(result.id, 'chat-1');
  assert.equal(result.usage?.cacheHitTokens, 4);
  assert.equal(result.usage?.cacheMissTokens, 6);
  assert.equal(result.usage?.billableTokens, 15);
});

test('reads Responses API usage nested in the response.completed event', () => {
  const sniffer = new SseUsageSniffer();
  sniffer.push(new TextEncoder().encode('event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp-1","usage":{"input_tokens":8,"input_tokens_details":{"cached_tokens":2},"output_tokens":3,"total_tokens":11}}}\n\n'));

  const result = sniffer.finish();
  assert.equal(result.id, 'resp-1');
  assert.equal(result.usage?.cacheHitTokens, 2);
  assert.equal(result.usage?.cacheMissTokens, 6);
  assert.equal(result.usage?.billableTokens, 11);
});
