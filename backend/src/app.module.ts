import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ClientsModule } from './clients/clients.module';
import { GatewayModule } from './gateway/gateway.module';
import { HealthController } from './health.controller';
import { PricingModule } from './pricing/pricing.module';
import { UsageModule } from './usage/usage.module';
import { PublicApiModule } from './public-api/public-api.module';

@Module({
  imports: [
    MongooseModule.forRoot(process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/deepseek_monitor', {
      serverSelectionTimeoutMS: 4_000,
      retryAttempts: 2,
      retryDelay: 500,
    }),
    ClientsModule,
    PricingModule,
    UsageModule,
    PublicApiModule,
    GatewayModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
