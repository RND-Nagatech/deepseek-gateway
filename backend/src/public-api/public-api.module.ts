import { Module } from '@nestjs/common';
import { ClientsModule } from '../clients/clients.module';
import { UsageModule } from '../usage/usage.module';
import { IntegrationApiKeyGuard } from './api-key.guard';
import { PublicApiController } from './public-api.controller';
import { SingaPayModule } from '../payments/singapay.module';

@Module({
  imports: [ClientsModule, UsageModule, SingaPayModule],
  controllers: [PublicApiController],
  providers: [IntegrationApiKeyGuard],
})
export class PublicApiModule {}
