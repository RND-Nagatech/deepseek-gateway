import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AdminGuard } from '../common/admin.guard';
import { Client, ClientKey, ClientKeySchema, ClientSchema } from '../common/schemas';
import { UsageEvent, UsageEventSchema } from '../common/schemas';
import { SingaPayModule } from '../payments/singapay.module';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Client.name, schema: ClientSchema },
      { name: ClientKey.name, schema: ClientKeySchema },
      { name: UsageEvent.name, schema: UsageEventSchema },
    ]),
    SingaPayModule,
  ],
  controllers: [ClientsController],
  providers: [ClientsService, AdminGuard],
  exports: [ClientsService],
})
export class ClientsModule {}
