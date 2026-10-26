import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHmac } from 'node:crypto';
import { Model, Types } from 'mongoose';
import { Client, ClientKey, ClientDocument, ClientKeyDocument } from '../common/schemas';
import { microsIdrToRupiah } from '../pricing/token-usage';
import { debitMicroIdr, rupiahToMicroIdr } from './balance';

@Injectable()
export class ClientsService {
  constructor(
    @InjectModel(Client.name) private readonly clients: Model<ClientDocument>,
    @InjectModel(ClientKey.name) private readonly keys: Model<ClientKeyDocument>,
  ) {}

  private hashKey(rawKey: string): string {
    const secret = process.env.KEY_HASH_SECRET ?? 'local-only-change-this-key-hash-secret';
    return createHmac('sha256', secret).update(rawKey.trim()).digest('hex');
  }

  private keyHint(rawKey: string): string {
    const key = rawKey.trim();
    const start = key.slice(0, Math.min(7, key.length));
    const end = key.slice(-4);
    return `${start}…${end}`;
  }

  async create(name: string, rawKey: string) {
    const normalizedName = name.trim();
    const normalizedKey = rawKey.trim();
    if (normalizedKey.length < 12) throw new ConflictException('API key looks too short.');
    const keyHash = this.hashKey(normalizedKey);
    if (await this.keys.exists({ keyHash })) throw new ConflictException('This DeepSeek key is already registered.');

    const client = await this.clients.create({ name: normalizedName, status: 'active' });
    try {
      const key = await this.keys.create({
        clientId: client._id,
        keyHash,
        keyHint: this.keyHint(normalizedKey),
        status: 'active',
          balanceMicrosIdr: Types.Decimal128.fromString('0'),
          topUps: [],
      });
      return {
        id: client._id.toString(),
        name: client.name,
        status: client.status,
        createdAt: client.createdAt,
          keys: [{
            id: key._id.toString(),
            keyHint: key.keyHint,
            status: key.status,
            lastUsedAt: null,
            balanceIdr: 0,
            topUpCount: 0,
            lastTopUp: null,
          }],
      };
    } catch (error) {
      await this.clients.deleteOne({ _id: client._id });
      throw error;
    }
  }

  async addKey(clientId: string, rawKey: string) {
    const client = await this.clients.findById(clientId).exec();
    if (!client) throw new NotFoundException('Client not found.');
    const normalizedKey = rawKey.trim();
    if (normalizedKey.length < 12) throw new ConflictException('API key looks too short.');
    const keyHash = this.hashKey(normalizedKey);
    if (await this.keys.exists({ keyHash })) throw new ConflictException('This DeepSeek key is already registered.');
    const key = await this.keys.create({
      clientId: client._id,
      keyHash,
      keyHint: this.keyHint(normalizedKey),
      status: 'active',
        balanceMicrosIdr: Types.Decimal128.fromString('0'),
        topUps: [],
    });
    return {
      id: key._id.toString(),
      keyHint: key.keyHint,
      status: key.status,
      lastUsedAt: null,
      balanceIdr: 0,
      topUpCount: 0,
      lastTopUp: null,
    };
  }

  async list() {
    const clients = await this.clients.find().sort({ createdAt: -1 }).lean().exec();
    const keys = await this.keys.find().select('-keyHash').lean().exec();
    const usageByClient = await this.aggregateClientTotals();
    const totals = new Map(usageByClient.map((item) => [String(item._id), item]));
    const keysByClient = new Map<string, typeof keys>();
    for (const key of keys) {
      const id = String(key.clientId);
      keysByClient.set(id, [...(keysByClient.get(id) ?? []), key]);
    }

    return clients.map((client) => {
      const id = String(client._id);
      const total = totals.get(id);
      return {
        id,
        name: client.name,
        status: client.status,
        createdAt: client.createdAt,
        requests: total?.requests ?? 0,
        billableTokens: total?.billableTokens ?? 0,
        costIdr: total?.costIdr ?? 0,
        keys: (keysByClient.get(id) ?? []).map((key) => ({
          id: String(key._id),
          keyHint: key.keyHint,
          status: key.status,
          lastUsedAt: key.lastUsedAt,
          createdAt: key.createdAt,
            balanceIdr: microsIdrToRupiah(key.balanceMicrosIdr),
            topUpCount: key.topUps?.length ?? 0,
            lastTopUp: key.topUps?.at(-1) ?? null,
        })),
      };
    });
  }

  async rename(clientId: string, name: string) {
    const client = await this.clients.findByIdAndUpdate(
      clientId,
      { $set: { name: name.trim() } },
      { new: true, runValidators: true },
    ).lean().exec();
    if (!client) throw new NotFoundException('Client not found.');
    return { id: String(client._id), name: client.name, status: client.status };
  }

  async setStatus(clientId: string, status: 'active' | 'paused') {
    const client = await this.clients.findByIdAndUpdate(clientId, { $set: { status } }, { new: true }).lean().exec();
    if (!client) throw new NotFoundException('Client not found.');
    return { id: String(client._id), name: client.name, status: client.status };
  }

  async revokeKey(clientId: string, keyId: string) {
    const key = await this.keys.findOneAndUpdate(
      { _id: keyId, clientId },
      { $set: { status: 'revoked' } },
      { new: true },
    ).lean().exec();
    if (!key) throw new NotFoundException('API key not found.');
    return { id: String(key._id), status: key.status };
  }

  async topUpKey(clientId: string, keyId: string, amountIdr: number) {
    const createdAt = new Date();
    const increment = Types.Decimal128.fromString(rupiahToMicroIdr(amountIdr));
    const key = await this.keys.findOneAndUpdate(
      { _id: keyId, clientId, status: 'active' },
      {
        $inc: { balanceMicrosIdr: increment },
        $push: { topUps: { amountIdr, createdAt } },
      },
      { new: true, runValidators: true },
    ).lean().exec();
    if (!key) {
      if (!(await this.keys.exists({ _id: keyId, clientId }))) throw new NotFoundException('API key not found.');
      throw new ConflictException('A revoked API key cannot be topped up.');
    }
    return {
      id: String(key._id),
      keyHint: key.keyHint,
      balanceIdr: microsIdrToRupiah(key.balanceMicrosIdr),
      topUpCount: key.topUps?.length ?? 0,
      lastTopUp: key.topUps?.at(-1) ?? { amountIdr, createdAt },
    };
  }

  async deductBalance(keyId: Types.ObjectId | string, costMicrosIdr: string) {
    if (costMicrosIdr === '0') return;
    const result = await this.keys.updateOne(
      { _id: keyId },
      { $inc: { balanceMicrosIdr: Types.Decimal128.fromString(debitMicroIdr(costMicrosIdr)) } },
    ).exec();
    if (result.matchedCount !== 1) throw new NotFoundException('API key not found while charging usage.');
  }

  async findActiveKey(rawKey: string) {
    const keyHash = this.hashKey(rawKey);
    const key = await this.keys.findOne({ keyHash, status: 'active' }).exec();
    if (!key) return null;
    const client = await this.clients.findOne({ _id: key.clientId, status: 'active' }).exec();
    if (!client) return null;
    return { key, client };
  }

  async touchKey(keyId: Types.ObjectId) {
    await this.keys.updateOne({ _id: keyId }, { $set: { lastUsedAt: new Date() } }).exec();
  }

  private async aggregateClientTotals() {
    const UsageModel = this.clients.db.model('UsageEvent');
    const rows = await UsageModel.aggregate([
      { $match: { usageStatus: 'confirmed' } },
      {
        $group: {
          _id: '$clientId',
          requests: { $sum: 1 },
          billableTokens: { $sum: '$billableTokens' },
          costMicrosIdr: { $sum: '$costMicrosIdr' },
        },
      },
    ]).exec();
    return rows.map((item: { _id: Types.ObjectId; requests: number; billableTokens: number; costMicrosIdr?: { toString(): string } }) => ({
      _id: String(item._id),
      requests: item.requests,
      billableTokens: item.billableTokens,
      costIdr: Number(item.costMicrosIdr?.toString() ?? 0) / 1_000_000,
    }));
  }
}
