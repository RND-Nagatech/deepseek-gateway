import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../common/admin.guard';
import { UsageService } from './usage.service';

@Controller('api')
@UseGuards(AdminGuard)
export class UsageController {
  constructor(private readonly usage: UsageService) {}

  @Get('overview')
  overview(@Query('days') days?: string) {
    return this.usage.overview(Number(days ?? 30));
  }

  @Get('usage')
  list(@Query('clientId') clientId?: string, @Query('limit') limit?: string) {
    return this.usage.list({ clientId, limit: Number(limit ?? 50) });
  }
}
