import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Client, ClientKey, ClientKeyDocument, KeyTopUp, SingaPayWebhookEvent, SingaPayWebhookEventDocument } from '../common/schemas';
import { rupiahToMicroIdr } from '../clients/balance';

const PENDING_STATUSES = ['creating', 'pending', 'expired', 'needs_review'];
const ACTIVE_TOPUP_STATUSES = ['creating', 'pending', 'needs_review'];
const DEFAULT_QR_LIFETIME_MS = 60 * 60 * 1000;

type TopUpStatus = NonNullable<KeyTopUp['status']>;

interface SingaPayConfig {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  partnerId: string;
  accountId: string;
}

interface QrisResponse {
  id?: number | string;
  reff_no?: string;
  merchant_reff_no?: string;
  status?: string;
  qr_data?: string;
  expired_at?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function headerValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  const record = asRecord(value);
  if (!record) return value;
  return Object.fromEntries(
    Object.keys(record).sort().map((key) => [key, sortJson(record[key])]),
  );
}

function jakartaDateStamp(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}${part('month')}${part('day')}`;
}

function jakartaIso(date: Date): string {
  const formatted = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).format(date);
  return `${formatted.replace(' ', 'T')}+07:00`;
}

function jakartaDateTime(date: Date): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).format(date);
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

@Injectable()
export class SingaPayService {
  private cachedToken: { value: string; expiresAt: number } | null = null;
  private tokenRequest: Promise<string> | null = null;

  constructor(
    @InjectModel(Client.name) private readonly clients: Model<Client>,
    @InjectModel(ClientKey.name) private readonly keys: Model<ClientKeyDocument>,
    @InjectModel(SingaPayWebhookEvent.name) private readonly webhookEvents: Model<SingaPayWebhookEventDocument>,
  ) {}

  async createQrisTopUp(
    keyId: Types.ObjectId | string,
    amountIdr: number,
    idempotencyKey: string,
    clientId?: Types.ObjectId | string,
  ) {
    this.validateIdempotencyKey(idempotencyKey);
    const existing = await this.findAttempt(keyId, { idempotencyKey }, clientId);
    if (existing) return this.reuseIdempotentAttempt(existing, amountIdr);
    const active = await this.findActiveAttempt(keyId, clientId);
    if (active) {
      throw new ConflictException(`Top-up ${active.merchantRef ?? ''} masih aktif. Periksa status QRIS yang ada sebelum membuat top-up baru.`);
    }
    if (clientId) {
      const client = await this.clients.findOne({ _id: clientId, status: 'active' }).select('_id').lean().exec();
      if (!client) throw new NotFoundException('Client tidak ditemukan atau sedang dijeda.');
    }
    const config = this.getConfig();
    const token = await this.getAccessToken(config);

    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + DEFAULT_QR_LIFETIME_MS);
    const merchantRef = `DS${Date.now().toString(36).toUpperCase().slice(-8)}${randomBytes(16).toString('hex').toUpperCase()}`;
    const reserved = await this.keys.findOneAndUpdate(
      {
        _id: keyId,
        status: 'active',
        ...(clientId ? { clientId } : {}),
        $and: [
          { topUps: { $not: { $elemMatch: { idempotencyKey } } } },
          { topUps: { $not: { $elemMatch: { source: 'singapay', status: { $in: ACTIVE_TOPUP_STATUSES } } } } },
        ],
      },
      {
        $push: {
          topUps: {
            amountIdr,
            createdAt,
            source: 'singapay',
            status: 'creating',
            method: 'qris',
            merchantRef,
            idempotencyKey,
            expiresAt,
          },
        },
      },
      { new: true, runValidators: true },
    ).lean().exec();

    if (!reserved) {
      const concurrentAttempt = await this.findAttempt(keyId, { idempotencyKey }, clientId);
      if (concurrentAttempt) return this.reuseIdempotentAttempt(concurrentAttempt, amountIdr);
      const otherActiveAttempt = await this.findActiveAttempt(keyId, clientId);
      if (otherActiveAttempt) {
        throw new ConflictException(`Top-up ${otherActiveAttempt.merchantRef ?? ''} masih aktif. Periksa status QRIS yang ada sebelum membuat top-up baru.`);
      }
      if (!(await this.keys.exists({ _id: keyId, ...(clientId ? { clientId } : {}) }))) {
        throw new NotFoundException('API key not found for this client.');
      }
      throw new ConflictException('A revoked API key cannot be topped up.');
    }

    const requestBody = {
      amount: amountIdr,
      expired_at: jakartaIso(expiresAt),
      merchant_reff_no: merchantRef,
    };
    let response: Response;
    let responseBody: unknown;
    try {
      response = await fetch(
        `${config.baseUrl}/api/v1.0/qris-dynamic/${encodeURIComponent(config.accountId)}/generate-qr`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'X-PARTNER-ID': config.partnerId,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(20_000),
        },
      );
      responseBody = safeJsonParse(await response.text());
    } catch {
      await this.setAttemptState(keyId, merchantRef, 'needs_review', 'Respons QRIS tidak terkonfirmasi; jangan buat QR baru sebelum transaksi diperiksa.');
      throw new ServiceUnavailableException('SingaPay belum mengonfirmasi pembuatan QRIS. Periksa status top-up sebelum mencoba lagi.');
    }

    if (!response.ok) {
      const status: TopUpStatus = response.status >= 500 ? 'needs_review' : 'failed';
      await this.setAttemptState(keyId, merchantRef, status, `SingaPay menolak pembuatan QRIS (HTTP ${response.status}).`);
      throw new ServiceUnavailableException(`SingaPay gagal membuat QRIS (HTTP ${response.status}).`);
    }

    const envelope = asRecord(responseBody);
    const providerData = asRecord(envelope?.data) as QrisResponse | null;
    if (envelope?.success !== true || !providerData?.qr_data) {
      await this.setAttemptState(keyId, merchantRef, 'needs_review', 'Respons SingaPay tidak memuat data QR yang dapat diverifikasi.');
      throw new ServiceUnavailableException('Respons SingaPay belum dapat dipastikan. Periksa status top-up sebelum mencoba lagi.');
    }

    await this.keys.updateOne(
      {
        _id: keyId,
        topUps: { $elemMatch: { merchantRef, status: 'creating' } },
      },
      {
        $set: {
          'topUps.$[payment].status': 'pending',
          'topUps.$[payment].providerTransactionId': providerData.id == null ? undefined : String(providerData.id),
          'topUps.$[payment].providerReference': providerData.reff_no ?? null,
          'topUps.$[payment].qrData': providerData.qr_data,
          'topUps.$[payment].expiresAt': providerData.expired_at ? new Date(providerData.expired_at) : expiresAt,
        },
      },
      { arrayFilters: [{ 'payment.merchantRef': merchantRef, 'payment.status': 'creating' }] },
    ).exec();

    const saved = await this.findAttempt(keyId, { merchantRef });
    if (!saved) throw new NotFoundException('Top-up QRIS tidak ditemukan.');
    return this.toView(saved);
  }

  async getTopUp(keyId: Types.ObjectId | string, merchantRef: string, clientId?: Types.ObjectId | string) {
    const attempt = await this.findAttempt(keyId, { merchantRef }, clientId);
    if (!attempt) throw new NotFoundException('Top-up tidak ditemukan untuk API key ini.');
    return this.toView(attempt);
  }

  async getActiveTopUp(keyId: Types.ObjectId | string, clientId?: Types.ObjectId | string) {
    const attempt = await this.findActiveAttempt(keyId, clientId);
    if (!attempt) throw new NotFoundException('Tidak ada pembayaran QRIS yang masih aktif.');
    return this.toView(attempt);
  }

  async reconcileTopUp(keyId: Types.ObjectId | string, merchantRef: string, clientId?: Types.ObjectId | string) {
    const attempt = await this.findAttempt(keyId, { merchantRef }, clientId);
    if (!attempt) throw new NotFoundException('Top-up tidak ditemukan untuk API key ini.');
    if (attempt.status === 'paid' || attempt.status === 'failed') {
      return this.toView(attempt);
    }

    const config = this.getConfig();
    const token = await this.getAccessToken(config);
    let providerRecord: QrisResponse & { amount?: number; is_expired?: boolean; status_computed?: string } | null;
    if (attempt.providerTransactionId) {
      const response = await this.getProviderJson(
        `${config.baseUrl}/api/v1.0/qris-dynamic/${encodeURIComponent(config.accountId)}/show/${encodeURIComponent(attempt.providerTransactionId)}`,
        token,
        config.partnerId,
      );
      providerRecord = asRecord(asRecord(response)?.data) as typeof providerRecord;
    } else {
      providerRecord = await this.findQrisByMerchantReference(config, token, attempt);
    }

    if (!providerRecord || providerRecord.merchant_reff_no !== merchantRef) {
      await this.setAttemptState(keyId, merchantRef, 'needs_review', 'SingaPay belum menemukan satu QRIS yang pasti untuk referensi ini. Jangan buat pembayaran baru dulu.');
      return this.getTopUp(keyId, merchantRef, clientId);
    }
    if (Number(providerRecord.amount) !== attempt.amountIdr) {
      await this.setAttemptState(keyId, merchantRef, 'needs_review', 'Nominal pada transaksi SingaPay tidak cocok dengan top-up.');
      return this.getTopUp(keyId, merchantRef, clientId);
    }

    const providerStatus = String(providerRecord.status_computed ?? providerRecord.status ?? '').toLowerCase();
    const isPaid = providerStatus === 'paid' || providerStatus === 'success';
    const isExpired = providerRecord.is_expired === true || providerStatus === 'expired';
    const transactionId = providerRecord.id == null ? attempt.providerTransactionId ?? '' : String(providerRecord.id);
    const providerReference = providerRecord.reff_no ?? attempt.providerReference ?? null;
    const qrData = providerRecord.qr_data ?? attempt.qrData ?? null;
    const expiresAt = providerRecord.expired_at ? new Date(providerRecord.expired_at) : attempt.expiresAt ?? null;

    if (isPaid) {
      const credited = await this.creditAttempt(
        keyId,
        merchantRef,
        attempt.amountIdr,
        transactionId,
        providerReference,
        new Date(),
      );
      if (!credited) {
        const latest = await this.findAttempt(keyId, { merchantRef }, clientId);
        if (latest?.status !== 'paid') {
          await this.setAttemptState(keyId, merchantRef, 'needs_review', 'SingaPay menunjukkan pembayaran lunas, tetapi saldo belum dapat dikredit otomatis.');
        }
      }
    } else {
      await this.keys.updateOne(
        { _id: keyId, topUps: { $elemMatch: { merchantRef, status: { $in: ACTIVE_TOPUP_STATUSES } } } },
        {
          $set: {
            'topUps.$[payment].status': isExpired ? 'expired' : 'pending',
            'topUps.$[payment].providerTransactionId': transactionId || null,
            'topUps.$[payment].providerReference': providerReference,
            'topUps.$[payment].qrData': qrData,
            'topUps.$[payment].expiresAt': expiresAt,
            'topUps.$[payment].reviewReason': null,
          },
        },
        { arrayFilters: [{ 'payment.merchantRef': merchantRef, 'payment.status': { $in: ACTIVE_TOPUP_STATUSES } }] },
      ).exec();
    }
    return this.getTopUp(keyId, merchantRef, clientId);
  }

  async listTopUps(keyId: Types.ObjectId | string, limit = 50) {
    const key = await this.keys.findById(keyId).select('topUps').lean().exec();
    if (!key) throw new NotFoundException('API key tidak ditemukan.');
    const items = (key.topUps ?? [])
      .filter((item) => item.source === 'singapay')
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice(0, limit)
      .map((item) => this.toView(item));
    return { items, nextCursor: null };
  }

  async handleWebhook(input: {
    body: unknown;
    rawBody?: Buffer;
    headers: Record<string, string | string[] | undefined>;
    url: string;
  }) {
    const body = asRecord(input.body);
    if (body?.status === 200 && body.success === true
      && body.data === 'VA Payment Notification testing'
      && body.event === undefined && body.transaction === undefined) {
      return { status: 'success' };
    }

    const config = this.getConfig();
    const signature = headerValue(input.headers['x-signature']);
    const timestamp = headerValue(input.headers['x-timestamp']);
    const authorization = headerValue(input.headers.authorization);
    const partnerId = headerValue(input.headers['x-partner-id']);
    const accessToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1] ?? '';

    if (!accessToken || !/^\d{10,13}$/.test(timestamp) || !/^[a-f\d]{128}$/i.test(signature)
      || !constantTimeEqual(partnerId, config.partnerId)) {
      throw new UnauthorizedException('Signature callback SingaPay tidak valid.');
    }

    const rawBody = input.rawBody?.toString('utf8') ?? '';
    const canonicalBody = JSON.stringify(sortJson(input.body));
    const payloadHashes = [...new Set([
      createHash('sha256').update(canonicalBody).digest('hex'),
      ...(rawBody ? [createHash('sha256').update(rawBody).digest('hex')] : []),
    ])];
    const endpoint = input.url;
    const validSignature = payloadHashes.some((hash) => {
      const signed = `POST:${endpoint}:${accessToken}:${hash}:${timestamp}`;
      const expected = createHmac('sha512', config.clientSecret).update(signed).digest('hex');
      return constantTimeEqual(signature.toLowerCase(), expected);
    });
    if (!validSignature) throw new UnauthorizedException('Signature callback SingaPay tidak valid.');

    const eventName = typeof body?.event === 'string' ? body.event : 'unknown';
    const data = asRecord(body?.data);
    const transaction = asRecord(data?.transaction);
    const transactionId = transaction?.id == null ? null : String(transaction.id);
    const merchantRef = typeof transaction?.merchant_reff_no === 'string'
      ? transaction.merchant_reff_no
      : null;
    const canonicalHash = createHash('sha256').update(canonicalBody).digest('hex');
    const eventKey = `${eventName}:${transactionId ?? canonicalHash}`;

    try {
      await this.webhookEvents.updateOne(
        { eventKey },
        {
          $setOnInsert: {
            eventKey,
            event: eventName,
            merchantRef,
            providerTransactionId: transactionId,
            payloadHash: canonicalHash,
            processingStatus: 'received',
            processingNote: null,
            receivedAt: new Date(),
          },
        },
        { upsert: true },
      ).exec();
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
    }

    const savedEvent = await this.webhookEvents.findOne({ eventKey }).lean().exec();
    if (!savedEvent) throw new ServiceUnavailableException('Event callback belum tersimpan.');
    if (savedEvent.processingStatus !== 'received') return { status: 'success' };

    if (eventName !== 'qris-acquirer-transaction') {
      await this.finishWebhook(eventKey, 'ignored', 'Jenis callback tidak ditangani oleh top-up QRIS.');
      return { status: 'success' };
    }

    const amountRecord = asRecord(transaction?.amount);
    const paidAmount = Number(amountRecord?.value ?? transaction?.amount);
    const currency = typeof amountRecord?.currency === 'string' ? amountRecord.currency : '';
    const providerStatus = typeof transaction?.status === 'string' ? transaction.status.toLowerCase() : '';
    const succeeded = body?.success === true && providerStatus === 'paid';
    if (!succeeded) {
      await this.finishWebhook(eventKey, 'ignored', 'Callback tidak menunjukkan transaksi QRIS lunas.');
      return { status: 'success' };
    }
    if (!merchantRef || !transactionId || !Number.isSafeInteger(paidAmount) || paidAmount < 1 || currency !== 'IDR') {
      await this.finishWebhook(eventKey, 'review', 'Data referensi, nominal, mata uang, atau ID transaksi tidak lengkap.');
      return { status: 'success' };
    }

    const key = await this.keys.findOne({ 'topUps.merchantRef': merchantRef }).select('topUps').lean().exec();
    const attempt = key?.topUps?.find((item) => item.merchantRef === merchantRef && item.source === 'singapay');
    if (!key || !attempt) {
      await this.finishWebhook(eventKey, 'review', 'Referensi top-up tidak ditemukan.');
      return { status: 'success' };
    }

    if (attempt.status === 'paid') {
      const sameTransaction = attempt.providerTransactionId === transactionId;
      await this.finishWebhook(eventKey, sameTransaction ? 'duplicate' : 'review', sameTransaction
        ? 'Callback transaksi yang sama telah diproses.'
        : 'Referensi QRIS sudah lunas dengan ID transaksi berbeda.');
      return { status: 'success' };
    }
    if (attempt.amountIdr !== paidAmount) {
      await this.setAttemptState(key._id, merchantRef, 'needs_review', `Nominal dibayar Rp${paidAmount} tidak sama dengan nominal top-up Rp${attempt.amountIdr}.`);
      await this.finishWebhook(eventKey, 'review', 'Nominal pembayaran berbeda dari nominal top-up.');
      return { status: 'success' };
    }
    if (!PENDING_STATUSES.includes(attempt.status ?? 'pending')) {
      await this.finishWebhook(eventKey, 'review', `Status top-up ${attempt.status ?? 'unknown'} tidak dapat dikredit otomatis.`);
      return { status: 'success' };
    }

    const providerReference = typeof transaction?.reff_no === 'string' ? transaction.reff_no : null;
    const credited = await this.creditAttempt(key._id, merchantRef, paidAmount, transactionId, providerReference, new Date());
    if (credited) {
      await this.finishWebhook(eventKey, 'credited', 'Saldo key dikredit satu kali setelah pembayaran dikonfirmasi.');
      return { status: 'success' };
    }

    const latest = await this.findAttempt(key._id, { merchantRef });
    if (latest?.status === 'paid' && latest.providerTransactionId === transactionId) {
      await this.finishWebhook(eventKey, 'duplicate', 'Callback transaksi yang sama telah diproses.');
    } else {
      await this.finishWebhook(eventKey, 'review', 'Status top-up berubah saat callback sedang diproses.');
    }
    return { status: 'success' };
  }

  private getConfig(): SingaPayConfig {
    const required = (name: string) => process.env[name]?.trim();
    const clientId = required('SINGAPAY_CLIENT_ID');
    const clientSecret = required('SINGAPAY_CLIENT_SECRET');
    const partnerId = required('SINGAPAY_PARTNER_ID');
    const accountId = required('SINGAPAY_ACCOUNT_ID');
    if (!clientId || !clientSecret || !partnerId || !accountId) {
      throw new ServiceUnavailableException('Integrasi SingaPay belum dikonfigurasi di environment backend.');
    }

    const configuredBaseUrl = required('SINGAPAY_BASE_URL') ?? 'https://sandbox-payment-b2b.singapay.id';
    let parsedBaseUrl: URL;
    try {
      parsedBaseUrl = new URL(configuredBaseUrl);
    } catch {
      throw new ServiceUnavailableException('SINGAPAY_BASE_URL harus berupa URL HTTPS yang valid.');
    }
    if (parsedBaseUrl.protocol !== 'https:' || !parsedBaseUrl.hostname
      || parsedBaseUrl.username || parsedBaseUrl.password || parsedBaseUrl.search || parsedBaseUrl.hash) {
      throw new ServiceUnavailableException(
        'SINGAPAY_BASE_URL harus berupa URL HTTPS tanpa kredensial, query, atau fragment. Prefix path seperti https://singapay.nagatech.id/sandbox diperbolehkan.',
      );
    }
    const baseUrl = parsedBaseUrl.href.replace(/\/+$/, '');
    return { baseUrl, clientId, clientSecret, partnerId, accountId };
  }

  private async getAccessToken(config: SingaPayConfig): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAt > Date.now() + 30_000) return this.cachedToken.value;
    if (this.tokenRequest) return this.tokenRequest;

    this.tokenRequest = this.requestAccessToken(config);
    try {
      return await this.tokenRequest;
    } finally {
      this.tokenRequest = null;
    }
  }

  private async requestAccessToken(config: SingaPayConfig): Promise<string> {
    const signedValue = `${config.clientId}_${config.clientSecret}_${jakartaDateStamp()}`;
    const signature = createHmac('sha512', config.clientSecret).update(signedValue).digest('hex');
    let response: Response;
    let responseBody: unknown;
    try {
      response = await fetch(`${config.baseUrl}/api/v1.1/access-token/b2b`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CLIENT-ID': config.clientId,
          'X-PARTNER-ID': config.partnerId,
          'X-Signature': signature,
        },
        body: JSON.stringify({ grant_type: 'client_credentials' }),
        signal: AbortSignal.timeout(15_000),
      });
      responseBody = safeJsonParse(await response.text());
    } catch {
      throw new ServiceUnavailableException('SingaPay tidak dapat dihubungi untuk autentikasi.');
    }
    const data = asRecord(asRecord(responseBody)?.data);
    const accessToken = typeof data?.access_token === 'string' ? data.access_token : '';
    if (!response.ok || !accessToken) {
      throw new ServiceUnavailableException('Autentikasi SingaPay gagal. Periksa kredensial dan konfigurasi merchant.');
    }
    const expiresIn = Number(data?.expires_in) || 3600;
    this.cachedToken = { value: accessToken, expiresAt: Date.now() + Math.max(60, expiresIn) * 1000 };
    return accessToken;
  }

  private async findAttempt(
    keyId: Types.ObjectId | string,
    match: { merchantRef?: string; idempotencyKey?: string },
    clientId?: Types.ObjectId | string,
  ): Promise<KeyTopUp | null> {
    const key = await this.keys.findOne({ _id: keyId, ...(clientId ? { clientId } : {}) }).select('topUps').lean().exec();
    if (!key) return null;
    return key.topUps?.find((item) => item.source === 'singapay'
      && (match.merchantRef ? item.merchantRef === match.merchantRef : item.idempotencyKey === match.idempotencyKey)) ?? null;
  }

  private async findActiveAttempt(keyId: Types.ObjectId | string, clientId?: Types.ObjectId | string) {
    const key = await this.keys.findOne({ _id: keyId, ...(clientId ? { clientId } : {}) }).select('topUps').lean().exec();
    if (!key) return null;
    return [...(key.topUps ?? [])].reverse().find((item) => item.source === 'singapay'
      && ACTIVE_TOPUP_STATUSES.includes(item.status ?? 'pending')) ?? null;
  }

  private async getProviderJson(url: string, accessToken: string, partnerId: string): Promise<unknown> {
    let response: Response;
    let responseBody: unknown;
    try {
      response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}`, 'X-PARTNER-ID': partnerId },
        signal: AbortSignal.timeout(15_000),
      });
      responseBody = safeJsonParse(await response.text());
    } catch {
      throw new ServiceUnavailableException('Status pembayaran belum dapat diperiksa di SingaPay.');
    }
    const envelope = asRecord(responseBody);
    if (!response.ok || envelope?.success !== true) {
      throw new ServiceUnavailableException(`SingaPay tidak dapat memeriksa status pembayaran (HTTP ${response.status}).`);
    }
    return responseBody;
  }

  private async findQrisByMerchantReference(
    config: SingaPayConfig,
    accessToken: string,
    attempt: KeyTopUp,
  ): Promise<(QrisResponse & { amount?: number; is_expired?: boolean; status_computed?: string }) | null> {
    if (!attempt.merchantRef) return null;
    const from = new Date(attempt.createdAt.getTime() - 10 * 60 * 1000);
    const to = new Date(attempt.createdAt.getTime() + 20 * 60 * 1000);
    const matches: Array<QrisResponse & { amount?: number; is_expired?: boolean; status_computed?: string }> = [];
    for (let page = 1; page <= 5; page += 1) {
      const query = new URLSearchParams({
        amount: String(attempt.amountIdr),
        type: 'mpm-dynamic',
        created_at_from: jakartaDateTime(from),
        created_at_to: jakartaDateTime(to),
        per_page: '100',
        page: String(page),
      });
      const response = await this.getProviderJson(
        `${config.baseUrl}/api/v1.0/qris-dynamic/${encodeURIComponent(config.accountId)}?${query.toString()}`,
        accessToken,
        config.partnerId,
      );
      const envelope = asRecord(response);
      const rows = Array.isArray(envelope?.data) ? envelope.data : [];
      for (const row of rows) {
        const candidate = asRecord(row) as (QrisResponse & { amount?: number; is_expired?: boolean; status_computed?: string }) | null;
        if (candidate?.merchant_reff_no === attempt.merchantRef) matches.push(candidate);
      }
      const pagination = asRecord(asRecord(envelope?.meta)?.pagination);
      const totalPages = Number(pagination?.total_pages) || 1;
      if (page >= totalPages || rows.length === 0) break;
    }
    return matches.length === 1 ? matches[0] : null;
  }

  private async creditAttempt(
    keyId: Types.ObjectId | string,
    merchantRef: string,
    amountIdr: number,
    transactionId: string,
    providerReference: string | null,
    paidAt: Date,
  ): Promise<boolean> {
    const result = await this.keys.updateOne(
      {
        _id: keyId,
        topUps: {
          $elemMatch: {
            merchantRef,
            source: 'singapay',
            amountIdr,
            status: { $in: PENDING_STATUSES },
          },
        },
      },
      {
        $inc: { balanceMicrosIdr: Types.Decimal128.fromString(rupiahToMicroIdr(amountIdr)) },
        $set: {
          'topUps.$[payment].status': 'paid',
          'topUps.$[payment].providerTransactionId': transactionId,
          'topUps.$[payment].providerReference': providerReference,
          'topUps.$[payment].paidAt': paidAt,
          'topUps.$[payment].reviewReason': null,
        },
      },
      {
        arrayFilters: [{
          'payment.merchantRef': merchantRef,
          'payment.source': 'singapay',
          'payment.amountIdr': amountIdr,
          'payment.status': { $in: PENDING_STATUSES },
        }],
      },
    ).exec();
    return result.modifiedCount === 1;
  }

  private reuseIdempotentAttempt(attempt: KeyTopUp, amountIdr: number) {
    if (attempt.amountIdr !== amountIdr) throw new ConflictException('Idempotency-Key sudah dipakai dengan nominal berbeda.');
    if (attempt.status === 'creating') throw new ConflictException('QRIS dengan Idempotency-Key ini masih dibuat. Coba periksa statusnya sebentar lagi.');
    return this.toView(attempt);
  }

  private validateIdempotencyKey(value: string) {
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(value)) {
      throw new BadRequestException('Header Idempotency-Key wajib berisi 8–128 karakter huruf, angka, titik, garis bawah, titik dua, atau tanda hubung.');
    }
  }

  private async setAttemptState(
    keyId: Types.ObjectId | string,
    merchantRef: string,
    status: TopUpStatus,
    reviewReason?: string,
  ) {
    await this.keys.updateOne(
      {
        _id: keyId,
        topUps: { $elemMatch: { merchantRef, status: { $in: PENDING_STATUSES } } },
      },
      {
        $set: {
          'topUps.$[payment].status': status,
          'topUps.$[payment].reviewReason': reviewReason ?? null,
        },
      },
      { arrayFilters: [{ 'payment.merchantRef': merchantRef, 'payment.status': { $in: PENDING_STATUSES } }] },
    ).exec();
  }

  private async finishWebhook(
    eventKey: string,
    processingStatus: 'credited' | 'duplicate' | 'review' | 'ignored',
    processingNote: string,
  ) {
    await this.webhookEvents.updateOne(
      { eventKey },
      { $set: { processingStatus, processingNote } },
    ).exec();
  }

  private toView(item: KeyTopUp) {
    return {
      amountIdr: item.amountIdr,
      currency: 'IDR' as const,
      method: item.method ?? 'qris',
      status: item.status ?? 'paid',
      source: item.source ?? 'manual',
      merchantRef: item.merchantRef ?? null,
      providerReference: item.providerReference ?? null,
      qrData: item.qrData ?? null,
      expiresAt: item.expiresAt ?? null,
      createdAt: item.createdAt,
      paidAt: item.paidAt ?? null,
      reviewReason: item.reviewReason ?? null,
    };
  }
}
