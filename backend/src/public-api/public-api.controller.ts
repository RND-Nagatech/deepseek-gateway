import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { Types } from 'mongoose';
import { MINIMUM_BALANCE_IDR, MINIMUM_BALANCE_MICROS_IDR } from '../clients/balance';
import { microsIdrToRupiah } from '../pricing/token-usage';
import { UsageService } from '../usage/usage.service';
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

function toDateRange(query: { from?: string; to?: string }) {
  return {
    ...(query.from ? { from: new Date(query.from) } : {}),
    ...(query.to ? { to: new Date(query.to) } : {}),
  };
}

@Controller('api/v1/me')
@UseGuards(GatewayApiKeyGuard)
export class PublicApiController {
  constructor(private readonly usage: UsageService) {}

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
}
