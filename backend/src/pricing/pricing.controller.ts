import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { IsInt, Min } from 'class-validator';
import { AdminGuard } from '../common/admin.guard';
import { PricingService } from './pricing.service';

class UpdatePricingDto {
  @IsInt()
  @Min(0)
  pricePerMillionIdr!: number;
}

@Controller('api/pricing')
@UseGuards(AdminGuard)
export class PricingController {
  constructor(private readonly pricing: PricingService) {}

  @Get()
  get() {
    return this.pricing.getCurrent();
  }

  @Put()
  update(@Body() dto: UpdatePricingDto) {
    return this.pricing.update(dto.pricePerMillionIdr);
  }
}
