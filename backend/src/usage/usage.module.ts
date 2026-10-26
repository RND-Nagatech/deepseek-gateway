import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AdminGuard } from '../common/admin.guard';
import { UsageEvent, UsageEventSchema } from '../common/schemas';
import { UsageController } from './usage.controller';
import { UsageService } from './usage.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: UsageEvent.name, schema: UsageEventSchema }])],
  controllers: [UsageController],
  providers: [UsageService, AdminGuard],
  exports: [UsageService],
})
export class UsageModule {}
