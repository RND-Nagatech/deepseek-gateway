import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsIn, IsInt, IsString, Length, Max, MaxLength, Min } from 'class-validator';
import { AdminGuard } from '../common/admin.guard';
import { SingaPayService } from '../payments/singapay.service';
import { ClientsService } from './clients.service';

class CreateClientDto {
  @IsString()
  @Length(1, 80)
  name!: string;

  @IsString()
  @Length(12, 1024)
  apiKey!: string;
}

class AddKeyDto {
  @IsString()
  @Length(12, 1024)
  apiKey!: string;
}

class RenameClientDto {
  @IsString()
  @Length(1, 80)
  @MaxLength(80)
  name!: string;
}

class ClientStatusDto {
  @IsIn(['active', 'paused'])
  status!: 'active' | 'paused';
}

class TopUpDto {
  @IsInt()
  @Min(1)
  @Max(1_000_000_000)
  amountIdr!: number;

  @IsString()
  @MaxLength(160)
  reason = 'Penyesuaian manual oleh admin';
}

class QrisTopUpDto {
  @IsInt()
  @Min(1)
  @Max(1_000_000_000)
  amountIdr!: number;
}

@Controller('api/clients')
@UseGuards(AdminGuard)
export class ClientsController {
  constructor(
    private readonly clients: ClientsService,
    private readonly singaPay: SingaPayService,
  ) {}

  @Get()
  list() {
    return this.clients.list();
  }

  @Post()
  create(@Body() dto: CreateClientDto) {
    return this.clients.create(dto.name, dto.apiKey);
  }

  @Patch(':id')
  rename(@Param('id') id: string, @Body() dto: RenameClientDto) {
    return this.clients.rename(id, dto.name);
  }

  @Patch(':id/status')
  setStatus(@Param('id') id: string, @Body() dto: ClientStatusDto) {
    return this.clients.setStatus(id, dto.status);
  }

  @Post(':id/keys')
  addKey(@Param('id') id: string, @Body() dto: AddKeyDto) {
    return this.clients.addKey(id, dto.apiKey);
  }

  @Patch(':id/keys/:keyId/revoke')
  revokeKey(@Param('id') id: string, @Param('keyId') keyId: string) {
    return this.clients.revokeKey(id, keyId);
  }

  @Post(':id/keys/:keyId/topups')
  topUpKey(@Param('id') id: string, @Param('keyId') keyId: string, @Body() dto: TopUpDto) {
    return this.clients.topUpKey(id, keyId, dto.amountIdr, dto.reason);
  }

  @Post(':id/keys/:keyId/qris-topups')
  createQrisTopUp(
    @Param('id') id: string,
    @Param('keyId') keyId: string,
    @Body() dto: QrisTopUpDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.singaPay.createQrisTopUp(keyId, dto.amountIdr, idempotencyKey ?? '', id);
  }

  @Get(':id/keys/:keyId/topups/active')
  getActiveTopUp(@Param('id') id: string, @Param('keyId') keyId: string) {
    return this.singaPay.getActiveTopUp(keyId, id);
  }

  @Get(':id/keys/:keyId/topups/:merchantRef')
  getTopUp(
    @Param('id') id: string,
    @Param('keyId') keyId: string,
    @Param('merchantRef') merchantRef: string,
  ) {
    return this.singaPay.getTopUp(keyId, merchantRef, id);
  }

  @Post(':id/keys/:keyId/topups/:merchantRef/reconcile')
  reconcileTopUp(
    @Param('id') id: string,
    @Param('keyId') keyId: string,
    @Param('merchantRef') merchantRef: string,
  ) {
    return this.singaPay.reconcileTopUp(keyId, merchantRef, id);
  }
}
