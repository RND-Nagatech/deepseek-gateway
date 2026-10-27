import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { UsageEvent, UsageEventDocument } from '../common/schemas';
import { calculateCostMicrosIdr, microsIdrToRupiah, NormalizedUsage } from '../pricing/token-usage';

interface StartEvent {
  requestId: string;
  clientId: Types.ObjectId;
  keyId: Types.ObjectId;
  path: string;
  method: string;
  model: string | null;
  startedAt: Date;
}

interface UsageRange {
  from?: Date;
  to?: Date;
}

interface UsageListQuery extends UsageRange {
  limit: number;
  cursor?: string;
}

interface UsageCursor {
  startedAt: Date;
  id: Types.ObjectId;
}

const USAGE_STATUSES = ['pending', 'confirmed', 'unavailable', 'not_metered', 'insufficient_balance'] as const;
const MAX_SUMMARY_RANGE_MS = 366 * 24 * 60 * 60 * 1000;

function parseUsageCursor(cursor: string): UsageCursor {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { startedAt?: unknown; id?: unknown };
    const startedAt = new Date(String(decoded.startedAt ?? ''));
    if (!Number.isFinite(startedAt.getTime()) || typeof decoded.id !== 'string' || !Types.ObjectId.isValid(decoded.id)) {
      throw new Error('invalid cursor');
    }
    return { startedAt, id: new Types.ObjectId(decoded.id) };
  } catch {
    throw new BadRequestException('The usage cursor is invalid.');
  }
}

function encodeUsageCursor(row: { _id: Types.ObjectId; startedAt: Date }): string {
  return Buffer.from(JSON.stringify({ startedAt: row.startedAt.toISOString(), id: String(row._id) })).toString('base64url');
}

function rangeFilter(range: UsageRange): Record<string, Date> | undefined {
  if (range.from && range.to && range.from >= range.to) {
    throw new BadRequestException('The from value must be earlier than the to value.');
  }
  if (!range.from && !range.to) return undefined;
  return {
    ...(range.from ? { $gte: range.from } : {}),
    ...(range.to ? { $lt: range.to } : {}),
  };
}

@Injectable()
export class UsageService {
  constructor(@InjectModel(UsageEvent.name) private readonly events: Model<UsageEventDocument>) {}

  async start(input: StartEvent) {
    return this.events.create({
      ...input,
      usageStatus: 'pending',
      statusCode: null,
      inputTokens: null,
      cacheHitTokens: null,
      cacheMissTokens: null,
      outputTokens: null,
      totalTokens: null,
      billableTokens: null,
      costMicrosIdr: null,
      pricePerMillionIdr: null,
      finishedAt: null,
      latencyMs: null,
      upstreamId: null,
    });
  }

  async rejectInsufficientBalance(input: StartEvent) {
    return this.events.create({
      ...input,
      usageStatus: 'insufficient_balance',
      statusCode: 402,
      inputTokens: null,
      cacheHitTokens: null,
      cacheMissTokens: null,
      outputTokens: null,
      totalTokens: null,
      billableTokens: null,
      costMicrosIdr: null,
      pricePerMillionIdr: null,
      finishedAt: new Date(),
      latencyMs: 0,
      upstreamId: null,
    });
  }

  async finish(
    requestId: string,
    statusCode: number,
    startedAt: Date,
    usage: NormalizedUsage | null,
    pricePerMillionIdr: number,
    upstreamId: string | null,
    meteredEndpoint = true,
  ): Promise<string | null> {
    const usageStatus = usage ? 'confirmed' : meteredEndpoint ? 'unavailable' : 'not_metered';
    const costMicrosValue = usage
      ? calculateCostMicrosIdr(usage.billableTokens, pricePerMillionIdr)
      : null;
    const costMicrosIdr = costMicrosValue === null ? null : Types.Decimal128.fromString(costMicrosValue);

    await this.events.updateOne(
      { requestId },
      {
        $set: {
          statusCode,
          usageStatus,
          inputTokens: usage?.inputTokens ?? null,
          cacheHitTokens: usage?.cacheHitTokens ?? null,
          cacheMissTokens: usage?.cacheMissTokens ?? null,
          outputTokens: usage?.outputTokens ?? null,
          totalTokens: usage?.totalTokens ?? null,
          billableTokens: usage?.billableTokens ?? null,
          costMicrosIdr,
          pricePerMillionIdr: usage ? pricePerMillionIdr : null,
          finishedAt: new Date(),
          latencyMs: Math.max(0, Date.now() - startedAt.getTime()),
          upstreamId,
        },
      },
    ).exec();
    return costMicrosValue;
  }

  async fail(requestId: string, startedAt: Date, statusCode = 502) {
    await this.events.updateOne(
      { requestId },
      {
        $set: {
          statusCode,
          usageStatus: 'unavailable',
          finishedAt: new Date(),
          latencyMs: Math.max(0, Date.now() - startedAt.getTime()),
        },
      },
    ).exec();
  }

  async list(query: { clientId?: string; limit: number }) {
    const filter: Record<string, unknown> = {};
    if (query.clientId && Types.ObjectId.isValid(query.clientId)) {
      filter.clientId = new Types.ObjectId(query.clientId);
    }
    const rows = await this.events.find(filter)
      .sort({ startedAt: -1 })
      .limit(Math.min(100, Math.max(1, query.limit)))
      .populate('clientId', 'name')
      .populate('keyId', 'keyHint')
      .lean()
      .exec();

    return rows.map((row: any) => ({
      id: String(row._id),
      requestId: row.requestId,
      clientId: row.clientId?._id ? String(row.clientId._id) : String(row.clientId),
      clientName: row.clientId?.name ?? 'Unknown client',
        keyId: row.keyId?._id ? String(row.keyId._id) : String(row.keyId),
        keyHint: row.keyId?.keyHint ?? null,
      path: row.path,
      method: row.method,
      model: row.model,
      statusCode: row.statusCode,
      usageStatus: row.usageStatus,
      inputTokens: row.inputTokens,
      cacheHitTokens: row.cacheHitTokens,
      cacheMissTokens: row.cacheMissTokens,
      outputTokens: row.outputTokens,
      totalTokens: row.totalTokens,
      billableTokens: row.billableTokens,
      costIdr: microsIdrToRupiah(row.costMicrosIdr),
      pricePerMillionIdr: row.pricePerMillionIdr,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      latencyMs: row.latencyMs,
    }));
  }

  async listForKey(keyId: Types.ObjectId, query: UsageListQuery) {
    const startedAt = rangeFilter(query);
    const clauses: Record<string, unknown>[] = [{ keyId }];
    if (startedAt) clauses.push({ startedAt });
    if (query.cursor) {
      const cursor = parseUsageCursor(query.cursor);
      clauses.push({
        $or: [
          { startedAt: { $lt: cursor.startedAt } },
          { startedAt: cursor.startedAt, _id: { $lt: cursor.id } },
        ],
      });
    }

    const limit = Math.min(100, Math.max(1, Math.floor(query.limit)));
    const rows = await this.events.find({ $and: clauses })
      .sort({ startedAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean()
      .exec();
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);

    return {
      data: page.map((row: any) => ({
        id: String(row._id),
        requestId: row.requestId,
        path: row.path,
        method: row.method,
        model: row.model,
        statusCode: row.statusCode,
        usageStatus: row.usageStatus,
        inputTokens: row.inputTokens,
        cacheHitTokens: row.cacheHitTokens,
        cacheMissTokens: row.cacheMissTokens,
        outputTokens: row.outputTokens,
        totalTokens: row.totalTokens,
        billableTokens: row.billableTokens,
        costIdr: row.costMicrosIdr == null ? null : microsIdrToRupiah(row.costMicrosIdr),
        pricePerMillionIdr: row.pricePerMillionIdr,
        startedAt: row.startedAt,
        finishedAt: row.finishedAt,
        latencyMs: row.latencyMs,
      })),
      pagination: {
        limit,
        nextCursor: hasMore ? encodeUsageCursor(page[page.length - 1]) : null,
      },
    };
  }

  async summaryForKey(keyId: Types.ObjectId, range: UsageRange & { defaultDays?: number }) {
    const to = range.to ?? new Date();
    const from = range.from ?? new Date(to.getTime() - (range.defaultDays ?? 30) * 24 * 60 * 60 * 1000);
    if (from >= to) throw new BadRequestException('The from value must be earlier than the to value.');
    if (to.getTime() - from.getTime() > MAX_SUMMARY_RANGE_MS) {
      throw new BadRequestException('The summary date range cannot exceed 366 days.');
    }
    const filter = { keyId, startedAt: { $gte: from, $lt: to } };

    const [statusRows, usageRows, seriesRows] = await Promise.all([
      this.events.aggregate([
        { $match: filter },
        {
          $group: {
            _id: '$usageStatus',
            requests: { $sum: 1 },
            errors: { $sum: { $cond: [{ $gte: [{ $ifNull: ['$statusCode', 0] }, 400] }, 1, 0] } },
          },
        },
      ]).exec(),
      this.events.aggregate([
        { $match: { ...filter, usageStatus: 'confirmed' } },
        {
          $group: {
            _id: null,
            inputTokens: { $sum: '$inputTokens' },
            cacheHitTokens: { $sum: '$cacheHitTokens' },
            cacheMissTokens: { $sum: '$cacheMissTokens' },
            outputTokens: { $sum: '$outputTokens' },
            billableTokens: { $sum: '$billableTokens' },
            costMicrosIdr: { $sum: '$costMicrosIdr' },
          },
        },
      ]).exec(),
      this.events.aggregate([
        { $match: filter },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$startedAt', timezone: 'Asia/Jakarta' } },
            requests: { $sum: 1 },
            tokens: { $sum: { $cond: [{ $eq: ['$usageStatus', 'confirmed'] }, '$billableTokens', 0] } },
            costMicrosIdr: { $sum: { $cond: [{ $eq: ['$usageStatus', 'confirmed'] }, '$costMicrosIdr', 0] } },
          },
        },
        { $sort: { _id: 1 } },
      ]).exec(),
    ]);

    const byStatus = Object.fromEntries(USAGE_STATUSES.map((status) => [status, 0])) as Record<typeof USAGE_STATUSES[number], number>;
    let requests = 0;
    let errors = 0;
    for (const row of statusRows as Array<{ _id: string; requests: number; errors: number }>) {
      if (USAGE_STATUSES.includes(row._id as typeof USAGE_STATUSES[number])) {
        byStatus[row._id as typeof USAGE_STATUSES[number]] = row.requests;
      }
      requests += row.requests;
      errors += row.errors;
    }

    const totals = usageRows[0] ?? {
      inputTokens: 0,
      cacheHitTokens: 0,
      cacheMissTokens: 0,
      outputTokens: 0,
      billableTokens: 0,
      costMicrosIdr: 0,
    };

    return {
      period: { from: from.toISOString(), to: to.toISOString(), timeZone: 'Asia/Jakarta' },
      totals: {
        requests,
        errors,
        confirmedRequests: byStatus.confirmed,
        tokens: {
          input: totals.inputTokens ?? 0,
          cacheHit: totals.cacheHitTokens ?? 0,
          cacheMiss: totals.cacheMissTokens ?? 0,
          output: totals.outputTokens ?? 0,
          billable: totals.billableTokens ?? 0,
        },
        costIdr: microsIdrToRupiah(totals.costMicrosIdr),
      },
      byStatus,
      series: seriesRows.map((row: any) => ({
        date: row._id,
        requests: row.requests ?? 0,
        tokens: row.tokens ?? 0,
        costIdr: microsIdrToRupiah(row.costMicrosIdr),
      })),
    };
  }

  async overview(days: number) {
    const safeDays = Math.min(90, Math.max(1, Math.floor(days)));
    const now = new Date();
    const start = new Date(now.getTime() - safeDays * 24 * 60 * 60 * 1000);
    const [summaryRows, seriesRows, topRows, latest] = await Promise.all([
      this.events.aggregate([
        { $match: { startedAt: { $gte: start } } },
        {
          $group: {
            _id: null,
            requests: { $sum: 1 },
            errors: { $sum: { $cond: [{ $gte: ['$statusCode', 400] }, 1, 0] } },
            confirmedTokens: { $sum: { $cond: [{ $eq: ['$usageStatus', 'confirmed'] }, '$billableTokens', 0] } },
            costMicrosIdr: { $sum: { $cond: [{ $eq: ['$usageStatus', 'confirmed'] }, '$costMicrosIdr', 0] } },
          },
        },
      ]).exec(),
      this.events.aggregate([
        { $match: { startedAt: { $gte: start }, usageStatus: 'confirmed' } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$startedAt', timezone: 'Asia/Jakarta' } },
            tokens: { $sum: '$billableTokens' },
            costMicrosIdr: { $sum: '$costMicrosIdr' },
          },
        },
        { $sort: { _id: 1 } },
      ]).exec(),
      this.events.aggregate([
        { $match: { startedAt: { $gte: start }, usageStatus: 'confirmed' } },
        {
          $group: {
            _id: '$clientId',
            requests: { $sum: 1 },
            tokens: { $sum: '$billableTokens' },
            costMicrosIdr: { $sum: '$costMicrosIdr' },
          },
        },
        { $sort: { costMicrosIdr: -1 } },
        { $limit: 5 },
        { $lookup: { from: 'clients', localField: '_id', foreignField: '_id', as: 'client' } },
        { $unwind: { path: '$client', preserveNullAndEmptyArrays: true } },
        { $project: { name: '$client.name', requests: 1, tokens: 1, costMicrosIdr: 1 } },
      ]).exec(),
      this.list({ limit: 8 }),
    ]);

    const summary = summaryRows[0] ?? { requests: 0, errors: 0, confirmedTokens: 0, costMicrosIdr: 0 };
    return {
      periodDays: safeDays,
      totals: {
        requests: summary.requests ?? 0,
        errors: summary.errors ?? 0,
        tokens: summary.confirmedTokens ?? 0,
        costIdr: microsIdrToRupiah(summary.costMicrosIdr),
      },
      series: seriesRows.map((row: any) => ({
        date: row._id,
        tokens: row.tokens ?? 0,
        costIdr: microsIdrToRupiah(row.costMicrosIdr),
      })),
      topClients: topRows.map((row: any) => ({
        id: String(row._id),
        name: row.name ?? 'Unknown client',
        requests: row.requests ?? 0,
        tokens: row.tokens ?? 0,
        costIdr: microsIdrToRupiah(row.costMicrosIdr),
      })),
      latest,
    };
  }
}
