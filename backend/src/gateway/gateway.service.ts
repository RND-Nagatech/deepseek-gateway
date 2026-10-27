import { Injectable } from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { ClientsService } from '../clients/clients.service';
import { MINIMUM_BALANCE_MICROS_IDR } from '../clients/balance';
import { PricingService } from '../pricing/pricing.service';
import { findUsageInPayload } from '../pricing/token-usage';
import { UsageService } from '../usage/usage.service';
import { SseUsageSniffer } from './sse-usage-sniffer';

const REQUEST_HOP_HEADERS = new Set([
  'host', 'connection', 'content-length', 'transfer-encoding', 'accept-encoding',
  'expect', 'x-admin-token', 'origin', 'referer', 'cookie', 'proxy-authorization',
]);
const RESPONSE_HOP_HEADERS = new Set([
  'connection', 'keep-alive', 'transfer-encoding', 'content-length', 'content-encoding',
  'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'upgrade',
]);
function headerString(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value.join(', ') : value;
}

function isUsageEndpoint(path: string): boolean {
  return /\/(chat\/completions|responses|completions)\/?(?:\?.*)?$/i.test(path);
}

function extractModel(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const model = (body as Record<string, unknown>).model;
  return typeof model === 'string' ? model : null;
}

function responseIdentifier(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  const response = record.response && typeof record.response === 'object'
    ? record.response as Record<string, unknown>
    : undefined;
  const id = record.id ?? response?.id;
  return typeof id === 'string' ? id : null;
}

@Injectable()
export class GatewayService {
  constructor(
    private readonly clients: ClientsService,
    private readonly usage: UsageService,
    private readonly pricing: PricingService,
  ) {}

  async handle(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const bearer = headerString(request.headers.authorization);
    const alternateKey = headerString(request.headers['x-api-key']);
    const rawKey = bearer?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? alternateKey?.trim();
    if (!rawKey) {
      reply.code(401).send({ error: { message: 'A registered DeepSeek API key is required.' } });
      return;
    }

    let registered;
    try {
      registered = await this.clients.findActiveKey(rawKey);
    } catch {
      reply.code(503).send({ error: { message: 'The monitoring database is unavailable.' } });
      return;
    }
    if (!registered) {
      reply.code(401).send({ error: { message: 'This DeepSeek API key is not registered or is inactive.' } });
      return;
    }

    const startedAt = new Date();
    const requestId = randomUUID();
    const originalUrl = request.raw.url ?? request.url;
    const pathAndQuery = originalUrl.replace(/^\/api\/proxy(?=\/|\?|$)/, '') || '/';
    const path = pathAndQuery.split('?')[0] || '/';
    const requestBody = request.body;
    const model = extractModel(requestBody);
    const startEvent = {
      requestId,
      clientId: registered.client._id,
      keyId: registered.key._id,
      path,
      method: request.method,
      model,
      startedAt,
    };

    const balanceMicrosIdr = BigInt(registered.key.balanceMicrosIdr?.toString() ?? '0');
    if (balanceMicrosIdr < MINIMUM_BALANCE_MICROS_IDR) {
      try {
        await this.usage.rejectInsufficientBalance(startEvent);
      } catch {
        reply.code(503).send({ error: { message: 'The request could not be recorded; DeepSeek was not called.' } });
        return;
      }
      reply.code(402).send({
        error: {
          message: 'API key balance is below Rp10. Top up this key to at least Rp10 before retrying.',
          type: 'insufficient_balance',
          code: 'INSUFFICIENT_PREPAID_BALANCE',
        },
      });
      return;
    }

    let currentPrice = 50_000;

    try {
      const setting = await this.pricing.getCurrent();
      currentPrice = setting.pricePerMillionIdr;
      await this.usage.start(startEvent);
      await this.clients.touchKey(registered.key._id);
    } catch {
      reply.code(503).send({ error: { message: 'The request could not be recorded; DeepSeek was not called.' } });
      return;
    }

    try {
      const upstreamUrl = this.makeUpstreamUrl(pathAndQuery);
      const headers = this.forwardRequestHeaders(request.headers, rawKey);
      const body = this.serializeBody(requestBody, request.method);
      const upstream = await fetch(upstreamUrl, {
        method: request.method,
        headers,
        body,
        signal: AbortSignal.timeout(180_000),
      });

      const isStream = upstream.headers.get('content-type')?.includes('text/event-stream') ?? false;
      if (isStream && upstream.body) {
          await this.forwardStream(
            upstream,
            reply,
            requestId,
            registered.key._id.toString(),
            startedAt,
            currentPrice,
            isUsageEndpoint(path),
          );
        return;
      }

      const bytes = upstream.body ? Buffer.from(await upstream.arrayBuffer()) : Buffer.alloc(0);
      const payload = this.parseJson(bytes, upstream.headers.get('content-type'));
      const usage = findUsageInPayload(payload);
        const chargeMicrosIdr = await this.usage.finish(
        requestId,
        upstream.status,
        startedAt,
        usage,
        currentPrice,
        responseIdentifier(payload),
        isUsageEndpoint(path),
      );
        if (chargeMicrosIdr !== null) {
          await this.clients.deductBalance(registered.key._id, chargeMicrosIdr);
        }
      this.writeUpstreamResponse(upstream, reply, bytes);
    } catch {
      await this.usage.fail(requestId, startedAt).catch(() => undefined);
      if (!reply.sent) {
        reply.code(502).send({ error: { message: 'Unable to reach DeepSeek. The request has been recorded.' } });
      }
    }
  }

  private makeUpstreamUrl(pathAndQuery: string): string {
    const base = new URL(process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com');
    const basePath = base.pathname.replace(/\/$/, '');
    const path = pathAndQuery.startsWith('/') ? pathAndQuery : `/${pathAndQuery}`;
    base.pathname = `${basePath}${path.split('?')[0]}`;
    base.search = path.includes('?') ? path.slice(path.indexOf('?')) : '';
    return base.toString();
  }

  private forwardRequestHeaders(
    incoming: FastifyRequest['headers'],
    rawKey: string,
  ): Headers {
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming)) {
      const normalized = name.toLowerCase();
      if (REQUEST_HOP_HEADERS.has(normalized) || normalized === 'authorization' || normalized === 'x-api-key') continue;
      const text = headerString(value);
      if (text !== undefined) headers.set(normalized, text);
    }
    headers.set('authorization', `Bearer ${rawKey}`);
    return headers;
  }

  private serializeBody(body: unknown, method: string): BodyInit | undefined {
    if (method === 'GET' || method === 'HEAD' || body === undefined) return undefined;
    if (typeof body === 'string') return body;
    if (body instanceof Uint8Array) {
      const copy = Uint8Array.from(body);
      return new Blob([copy.buffer as ArrayBuffer]);
    }
    return JSON.stringify(body);
  }

  private parseJson(bytes: Buffer, contentType: string | null): unknown {
    if (!contentType?.includes('application/json') || bytes.length === 0) return null;
    try {
      return JSON.parse(bytes.toString('utf8')) as unknown;
    } catch {
      return null;
    }
  }

  private copyResponseHeaders(upstream: Response, reply: FastifyReply) {
    upstream.headers.forEach((value, name) => {
      if (!RESPONSE_HOP_HEADERS.has(name.toLowerCase())) reply.header(name, value);
    });
  }

  private writeUpstreamResponse(upstream: Response, reply: FastifyReply, bytes: Buffer) {
    this.copyResponseHeaders(upstream, reply);
    reply.hijack();
    reply.raw.writeHead(upstream.status);
    reply.raw.end(bytes);
  }

  private async forwardStream(
    upstream: Response,
    reply: FastifyReply,
    requestId: string,
    keyId: string,
    startedAt: Date,
    pricePerMillionIdr: number,
    meteredEndpoint: boolean,
  ) {
    const sniffer = new SseUsageSniffer();
    this.copyResponseHeaders(upstream, reply);
    reply.hijack();
    reply.raw.writeHead(upstream.status);

    try {
      for await (const chunk of upstream.body!) {
        const bytes = Buffer.from(chunk);
        sniffer.push(bytes);
        if (!reply.raw.write(bytes)) await once(reply.raw, 'drain');
      }
      const result = sniffer.finish();
      const chargeMicrosIdr = await this.usage.finish(
        requestId,
        upstream.status,
        startedAt,
        result.usage,
        pricePerMillionIdr,
        result.id,
        meteredEndpoint,
      );
      if (chargeMicrosIdr !== null) await this.clients.deductBalance(keyId, chargeMicrosIdr);
      reply.raw.end();
    } catch (error) {
      await this.usage.fail(requestId, startedAt, upstream.status).catch(() => undefined);
      reply.raw.destroy(error instanceof Error ? error : undefined);
    }
  }
}
