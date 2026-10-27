import { Module } from '@nestjs/common';
import { ClientsModule } from '../clients/clients.module';
import { UsageModule } from '../usage/usage.module';
import { GatewayApiKeyGuard } from './api-key.guard';
import { PublicApiController } from './public-api.controller';

@Module({
  imports: [ClientsModule, UsageModule],
  controllers: [PublicApiController],
  providers: [GatewayApiKeyGuard],
})
export class PublicApiModule {}
