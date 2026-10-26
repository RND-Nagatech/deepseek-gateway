import { Module } from '@nestjs/common';
import { ClientsModule } from '../clients/clients.module';
import { PricingModule } from '../pricing/pricing.module';
import { UsageModule } from '../usage/usage.module';
import { GatewayService } from './gateway.service';

@Module({
  imports: [ClientsModule, PricingModule, UsageModule],
  providers: [GatewayService],
  exports: [GatewayService],
})
export class GatewayModule {}
