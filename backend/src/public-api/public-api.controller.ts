import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Body, Controller, Get, Headers, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Types } from 'mongoose';
import { MINIMUM_BALANCE_IDR, MINIMUM_BALANCE_MICROS_IDR } from '../clients/balance';
import { microsIdrToRupiah } from '../pricing/token-usage';
import { UsageService } from '../usage/usage.service';
import { SingaPayService, SINGAPAY_VA_BANK_CODES, type SingaPayVaBankCode } from '../payments/singapay.service';
import { GatewayApiKeyGuard, GatewayApiRequest } from './api-key.guard';

class UsageListQueryDto {
  @IsOptional()
  @IsDateString({ strict: true })
  from?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  cursor?: string;
}

class UsageSummaryQueryDto {
  @IsOptional()
  @IsDateString({ strict: true })
  from?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  to?: string;
}

class CreateTopUpDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000_000)
  amountIdr!: number;
}

class CreateVaTopUpDto {
  @Type(() => Number)
  @IsInt()
  @Min(10_000)
  @Max(1_000_000_000)
  amountIdr!: number;

  @IsIn(SINGAPAY_VA_BANK_CODES)
  bankCode!: SingaPayVaBankCode;
}

class TopUpListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;
}

function toDateRange(query: { from?: string; to?: string }) {
  return {
    ...(query.from ? { from: new Date(query.from) } : {}),
    ...(query.to ? { to: new Date(query.to) } : {}),
  };
}

@Controller('api/v1/me')
@UseGuards(GatewayApiKeyGuard)
export class PublicApiController {
  constructor(
    private readonly usage: UsageService,
    private readonly singaPay: SingaPayService,
  ) {}

  @Get('balance')
  balance(@Req() request: GatewayApiRequest) {
    const identity = request.gatewayApiIdentity!;
    const balanceMicrosIdr = identity.key.balanceMicrosIdr?.toString() ?? '0';
    const topUps = identity.key.topUps ?? [];
    const balanceIdr = microsIdrToRupiah(balanceMicrosIdr);
    const lastTopUp = topUps.at(-1) ?? null;
    const canMakeRequest = BigInt(balanceMicrosIdr) >= MINIMUM_BALANCE_MICROS_IDR;

    return {
      account: {
        clientId: String(identity.client._id),
        clientName: identity.client.name,
        keyId: String(identity.key._id),
        keyHint: identity.key.keyHint,
      },
      balanceIdr,
      currency: 'IDR',
      minimumBalanceForRequestIdr: MINIMUM_BALANCE_IDR,
      canMakeRequest,
      status: { client: identity.client.status, key: identity.key.status },
      topUps: {
        count: topUps.length,
        last: lastTopUp ? { amountIdr: lastTopUp.amountIdr, createdAt: lastTopUp.createdAt } : null,
      },
    };
  }

  @Get('usage')
  listUsage(@Req() request: GatewayApiRequest, @Query() query: UsageListQueryDto) {
    return this.usage.listForKey(
      request.gatewayApiIdentity!.key._id as Types.ObjectId,
      { ...toDateRange(query), limit: query.limit, cursor: query.cursor },
    );
  }

  @Get('usage/summary')
  usageSummary(@Req() request: GatewayApiRequest, @Query() query: UsageSummaryQueryDto) {
    return this.usage.summaryForKey(
      request.gatewayApiIdentity!.key._id as Types.ObjectId,
      { ...toDateRange(query), defaultDays: 30 },
    );
  }

  @Post('topups')
  createTopUp(
    @Req() request: GatewayApiRequest,
    @Body() dto: CreateTopUpDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const identity = request.gatewayApiIdentity!;
    return this.singaPay.createQrisTopUp(
      identity.key._id as Types.ObjectId,
      dto.amountIdr,
      idempotencyKey ?? '',
      identity.client._id as Types.ObjectId,
    );
  }

  @Post('topups/va')
  createVaTopUp(
    @Req() request: GatewayApiRequest,
    @Body() dto: CreateVaTopUpDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const identity = request.gatewayApiIdentity!;
    return this.singaPay.createVaTopUp(
      identity.key._id as Types.ObjectId,
      dto.amountIdr,
      dto.bankCode,
      idempotencyKey ?? '',
      identity.client._id as Types.ObjectId,
    );
  }

  @Get('topups')
  listTopUps(@Req() request: GatewayApiRequest, @Query() query: TopUpListQueryDto) {
    return this.singaPay.listTopUps(request.gatewayApiIdentity!.key._id as Types.ObjectId, query.limit);
  }

  @Get('topups/active')
  activeTopUp(@Req() request: GatewayApiRequest) {
    const identity = request.gatewayApiIdentity!;
    return this.singaPay.getActiveTopUp(
      identity.key._id as Types.ObjectId,
      identity.client._id as Types.ObjectId,
    );
  }

  @Get('topups/:merchantRef')
  getTopUp(@Req() request: GatewayApiRequest, @Param('merchantRef') merchantRef: string) {
    return this.singaPay.getTopUp(request.gatewayApiIdentity!.key._id as Types.ObjectId, merchantRef);
  }

  @Post('topups/:merchantRef/reconcile')
  reconcileTopUp(@Req() request: GatewayApiRequest, @Param('merchantRef') merchantRef: string) {
    const identity = request.gatewayApiIdentity!;
    return this.singaPay.reconcileTopUp(
      identity.key._id as Types.ObjectId,
      merchantRef,
      identity.client._id as Types.ObjectId,
    );
  }

  @Post('topups/:merchantRef/retry')
  retryTopUp(
    @Req() request: GatewayApiRequest,
    @Param('merchantRef') merchantRef: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const identity = request.gatewayApiIdentity!;
    return this.singaPay.retryTopUp(
      identity.key._id as Types.ObjectId,
      merchantRef,
      idempotencyKey ?? '',
      identity.client._id as Types.ObjectId,
    );
  }
}
