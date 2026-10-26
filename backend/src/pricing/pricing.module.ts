import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AdminGuard } from '../common/admin.guard';
import { AppSetting, AppSettingSchema } from '../common/schemas';
import { PricingController } from './pricing.controller';
import { PricingService } from './pricing.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: AppSetting.name, schema: AppSettingSchema }])],
  controllers: [PricingController],
  providers: [PricingService, AdminGuard],
  exports: [PricingService],
})
export class PricingModule {}
