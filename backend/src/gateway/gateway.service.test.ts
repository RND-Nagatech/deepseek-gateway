import assert from 'node:assert/strict';
import test from 'node:test';
import { Types } from 'mongoose';
import { FastifyReply, FastifyRequest } from 'fastify';
import { ClientsService } from '../clients/clients.service';
import { PricingService } from '../pricing/pricing.service';
import { UsageService } from '../usage/usage.service';
import { GatewayService } from './gateway.service';

function requestWithBalance(balanceMicrosIdr: string) {
  return {
    headers: { authorization: 'Bearer sk-test-key-1234' },
    method: 'POST',
    body: { model: 'deepseek-chat', messages: [{ role: 'user', content: 'hello' }] },
    raw: { url: '/api/proxy/chat/completions' },
    url: '/api/proxy/chat/completions',
    registeredKey: {
      _id: new Types.ObjectId(),
      balanceMicrosIdr: Types.Decimal128.fromString(balanceMicrosIdr),
    },
  };
}

function createReply() {
  const result: { statusCode: number; body: unknown; headers: Record<string, string>; sent: boolean } = {
    statusCode: 200,
    body: undefined,
    headers: {},
    sent: false,
  };
  const reply = {
    get sent() { return result.sent; },
    code(statusCode: number) { result.statusCode = statusCode; return this; },
    send(body: unknown) { result.body = body; result.sent = true; return this; },
    header(name: string, value: string) { result.headers[name] = value; return this; },
    hijack() { return this; },
    raw: {
      writeHead(statusCode: number) { result.statusCode = statusCode; },
      end(body?: Buffer) { result.body = body; result.sent = true; },
    },
  };
  return { reply: reply as unknown as FastifyReply, result };
}

test('rejects a key below Rp10 before contacting DeepSeek', async () => {
  const request = requestWithBalance('9000000');
  const rejected: unknown[] = [];
  let upstreamCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    upstreamCalled = true;
    throw new Error('The upstream must not be called.');
  };
  const clients = {
    findActiveKey: async () => ({ key: request.registeredKey, client: { _id: new Types.ObjectId() } }),
  } as unknown as ClientsService;
  const usage = {
    rejectInsufficientBalance: async (input: unknown) => { rejected.push(input); },
    start: async () => { throw new Error('Usage should not start for a denied request.'); },
  } as unknown as UsageService;
  const pricing = { getCurrent: async () => ({ pricePerMillionIdr: 50_000 }) } as unknown as PricingService;
  const { reply, result } = createReply();

  try {
    await new GatewayService(clients, usage, pricing).handle(request as unknown as FastifyRequest, reply);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(result.statusCode, 402);
  assert.deepEqual(result.body, {
    error: {
      message: 'API key balance is below Rp10. Top up this key to at least Rp10 before retrying.',
      type: 'insufficient_balance',
      code: 'INSUFFICIENT_PREPAID_BALANCE',
    },
  });
  assert.equal(rejected.length, 1);
  assert.equal(upstreamCalled, false);
});

test('deducts confirmed usage from the key balance before returning the response', async () => {
  const request = requestWithBalance('10000000');
  const deductions: Array<{ keyId: unknown; costMicrosIdr: string }> = [];
  const originalFetch = globalThis.fetch;
  const originalBaseUrl = process.env.DEEPSEEK_BASE_URL;
  process.env.DEEPSEEK_BASE_URL = 'https://mock.deepseek.invalid/v1';
  globalThis.fetch = async () => new Response(JSON.stringify({
    id: 'chatcmpl-test',
    usage: { prompt_tokens: 120, prompt_cache_hit_tokens: 40, prompt_cache_miss_tokens: 80, completion_tokens: 80 },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  const clients = {
    findActiveKey: async () => ({ key: request.registeredKey, client: { _id: new Types.ObjectId() } }),
    touchKey: async () => undefined,
    deductBalance: async (keyId: unknown, costMicrosIdr: string) => deductions.push({ keyId, costMicrosIdr }),
  } as unknown as ClientsService;
  const usage = {
    start: async () => undefined,
    finish: async () => '10000000',
  } as unknown as UsageService;
  const pricing = { getCurrent: async () => ({ pricePerMillionIdr: 50_000 }) } as unknown as PricingService;
  const { reply, result } = createReply();

  try {
    await new GatewayService(clients, usage, pricing).handle(request as unknown as FastifyRequest, reply);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBaseUrl === undefined) delete process.env.DEEPSEEK_BASE_URL;
    else process.env.DEEPSEEK_BASE_URL = originalBaseUrl;
  }

  assert.equal(result.statusCode, 200);
  assert.equal(deductions.length, 1);
  assert.equal(deductions[0].keyId, request.registeredKey._id);
  assert.equal(deductions[0].costMicrosIdr, '10000000');
  assert.match(Buffer.from(result.body as Buffer).toString('utf8'), /chatcmpl-test/);
});

test('allows a request to overdraw the key balance by its confirmed charge', async () => {
  const request = requestWithBalance('100000000');
  let balanceMicrosIdr = BigInt(request.registeredKey.balanceMicrosIdr.toString());
  const originalFetch = globalThis.fetch;
  const originalBaseUrl = process.env.DEEPSEEK_BASE_URL;
  process.env.DEEPSEEK_BASE_URL = 'https://mock.deepseek.invalid/v1';
  globalThis.fetch = async () => new Response(JSON.stringify({ id: 'chatcmpl-overdraw', usage: {} }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
  const clients = {
    findActiveKey: async () => ({ key: request.registeredKey, client: { _id: new Types.ObjectId() } }),
    touchKey: async () => undefined,
    deductBalance: async (_keyId: unknown, costMicrosIdr: string) => {
      balanceMicrosIdr -= BigInt(costMicrosIdr);
    },
  } as unknown as ClientsService;
  const usage = {
    start: async () => undefined,
    finish: async () => '120000000',
  } as unknown as UsageService;
  const pricing = { getCurrent: async () => ({ pricePerMillionIdr: 50_000 }) } as unknown as PricingService;
  const { reply, result } = createReply();

  try {
    await new GatewayService(clients, usage, pricing).handle(request as unknown as FastifyRequest, reply);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBaseUrl === undefined) delete process.env.DEEPSEEK_BASE_URL;
    else process.env.DEEPSEEK_BASE_URL = originalBaseUrl;
  }

  assert.equal(result.statusCode, 200);
  assert.equal(balanceMicrosIdr.toString(), '-20000000');
});
