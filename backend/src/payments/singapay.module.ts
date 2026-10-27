import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Client, ClientKey, ClientKeySchema, ClientSchema, SingaPayWebhookEvent, SingaPayWebhookEventSchema } from '../common/schemas';
import { SingaPayWebhookController } from './singapay-webhook.controller';
import { SingaPayService } from './singapay.service';

@Module({
  imports: [MongooseModule.forFeature([
    { name: Client.name, schema: ClientSchema },
    { name: ClientKey.name, schema: ClientKeySchema },
    { name: SingaPayWebhookEvent.name, schema: SingaPayWebhookEventSchema },
  ])],
  controllers: [SingaPayWebhookController],
  providers: [SingaPayService],
  exports: [SingaPayService],
})
export class SingaPayModule {}
