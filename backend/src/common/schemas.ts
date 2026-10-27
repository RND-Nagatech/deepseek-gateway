import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type ClientDocument = HydratedDocument<Client>;
export type ClientKeyDocument = HydratedDocument<ClientKey>;
export type UsageEventDocument = HydratedDocument<UsageEvent>;
export type AppSettingDocument = HydratedDocument<AppSetting>;
export type SingaPayWebhookEventDocument = HydratedDocument<SingaPayWebhookEvent>;

export interface KeyTopUp {
  amountIdr: number;
  createdAt: Date;
  source?: 'manual' | 'singapay';
  status?: 'creating' | 'pending' | 'paid' | 'expired' | 'failed' | 'needs_review';
  reason?: string | null;
  method?: 'qris';
  merchantRef?: string | null;
  idempotencyKey?: string | null;
  providerTransactionId?: string | null;
  providerReference?: string | null;
  qrData?: string | null;
  expiresAt?: Date | null;
  paidAt?: Date | null;
  reviewReason?: string | null;
}

@Schema({ timestamps: true, collection: 'clients' })
export class Client {
  @Prop({ required: true, trim: true, maxlength: 80 })
  name!: string;

  @Prop({ default: 'active', enum: ['active', 'paused'] })
  status!: 'active' | 'paused';

  declare createdAt: Date;
  declare updatedAt: Date;
}

export const ClientSchema = SchemaFactory.createForClass(Client);
ClientSchema.index({ name: 1 });

@Schema({ timestamps: true, collection: 'client_api_keys' })
export class ClientKey {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: Client.name, required: true, index: true })
  clientId!: Types.ObjectId;

  @Prop({ required: true, unique: true, select: false })
  keyHash!: string;

  @Prop({ required: true })
  keyHint!: string;

  @Prop({ default: 'active', enum: ['active', 'revoked'] })
  status!: 'active' | 'revoked';

  @Prop({ type: MongooseSchema.Types.Decimal128, default: () => Types.Decimal128.fromString('0') })
  balanceMicrosIdr!: Types.Decimal128;

  @Prop({
    type: [{
      amountIdr: { type: Number, required: true },
      createdAt: { type: Date, required: true },
      source: { type: String, enum: ['manual', 'singapay'], default: 'manual' },
      status: { type: String, enum: ['creating', 'pending', 'paid', 'expired', 'failed', 'needs_review'], default: 'paid' },
      reason: { type: String, default: null },
      method: { type: String, enum: ['qris'], default: null },
      merchantRef: { type: String },
      idempotencyKey: { type: String, default: null },
      providerTransactionId: { type: String, default: null },
      providerReference: { type: String, default: null },
      qrData: { type: String, default: null },
      expiresAt: { type: Date, default: null },
      paidAt: { type: Date, default: null },
      reviewReason: { type: String, default: null },
    }],
    default: [],
  })
  topUps!: KeyTopUp[];

  @Prop({ type: Date, default: null })
  lastUsedAt!: Date | null;

  declare createdAt: Date;
  declare updatedAt: Date;
}

export const ClientKeySchema = SchemaFactory.createForClass(ClientKey);
ClientKeySchema.index({ 'topUps.merchantRef': 1 });

@Schema({ timestamps: true, collection: 'usage_events' })
export class UsageEvent {
  @Prop({ required: true, unique: true })
  requestId!: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: Client.name, required: true, index: true })
  clientId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: ClientKey.name, required: true })
  keyId!: Types.ObjectId;

  @Prop({ required: true })
  path!: string;

  @Prop({ required: true })
  method!: string;

  @Prop({ type: String, default: null })
  model!: string | null;

  @Prop({ type: Number, default: null })
  statusCode!: number | null;

  @Prop({ default: 'pending', enum: ['pending', 'confirmed', 'unavailable', 'not_metered', 'insufficient_balance'] })
  usageStatus!: 'pending' | 'confirmed' | 'unavailable' | 'not_metered' | 'insufficient_balance';

  @Prop({ type: Number, default: null })
  inputTokens!: number | null;

  @Prop({ type: Number, default: null })
  cacheHitTokens!: number | null;

  @Prop({ type: Number, default: null })
  cacheMissTokens!: number | null;

  @Prop({ type: Number, default: null })
  outputTokens!: number | null;

  @Prop({ type: Number, default: null })
  totalTokens!: number | null;

  @Prop({ type: Number, default: null })
  billableTokens!: number | null;

  @Prop({ type: MongooseSchema.Types.Decimal128, default: null })
  costMicrosIdr!: Types.Decimal128 | null;

  @Prop({ type: Number, default: null })
  pricePerMillionIdr!: number | null;

  @Prop({ type: Date, required: true, index: true })
  startedAt!: Date;

  @Prop({ type: Date, default: null })
  finishedAt!: Date | null;

  @Prop({ type: Number, default: null })
  latencyMs!: number | null;

  @Prop({ type: String, default: null })
  upstreamId!: string | null;

  declare createdAt: Date;
  declare updatedAt: Date;
}

export const UsageEventSchema = SchemaFactory.createForClass(UsageEvent);
UsageEventSchema.index({ clientId: 1, startedAt: -1 });
UsageEventSchema.index({ keyId: 1, startedAt: -1 });
UsageEventSchema.index({ startedAt: -1 });

@Schema({ timestamps: true, collection: 'app_settings' })
export class AppSetting {
  @Prop({ required: true, unique: true })
  name!: string;

  @Prop({ required: true, min: 0 })
  pricePerMillionIdr!: number;

  declare createdAt: Date;
  declare updatedAt: Date;
}

export const AppSettingSchema = SchemaFactory.createForClass(AppSetting);

@Schema({ timestamps: true, collection: 'singapay_webhook_events' })
export class SingaPayWebhookEvent {
  @Prop({ required: true, unique: true })
  eventKey!: string;

  @Prop({ required: true })
  event!: string;

  @Prop({ type: String, default: null })
  merchantRef!: string | null;

  @Prop({ type: String, default: null })
  providerTransactionId!: string | null;

  @Prop({ type: String, default: null })
  payloadHash!: string | null;

  @Prop({ default: 'received', enum: ['received', 'credited', 'duplicate', 'review', 'ignored'] })
  processingStatus!: 'received' | 'credited' | 'duplicate' | 'review' | 'ignored';

  @Prop({ type: String, default: null })
  processingNote!: string | null;

  @Prop({ type: Date, required: true })
  receivedAt!: Date;

  declare createdAt: Date;
  declare updatedAt: Date;
}

export const SingaPayWebhookEventSchema = SchemaFactory.createForClass(SingaPayWebhookEvent);
