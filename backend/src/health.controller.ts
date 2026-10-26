import { Controller, Get } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';

@Controller('api')
export class HealthController {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  @Get('health')
  health() {
    const mongoReady = this.connection.readyState === 1;
    return {
      status: mongoReady ? 'ok' : 'degraded',
      service: 'deepseek-monitor-api',
      mongodb: mongoReady ? 'connected' : 'disconnected',
      time: new Date().toISOString(),
    };
  }
}
