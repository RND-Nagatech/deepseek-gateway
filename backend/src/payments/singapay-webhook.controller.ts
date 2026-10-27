import { Controller, HttpCode, Post, Req } from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { SingaPayService } from './singapay.service';

type RawBodyRequest = FastifyRequest & { rawBody?: Buffer };

@Controller()
export class SingaPayWebhookController {
  constructor(private readonly singaPay: SingaPayService) {}

  @Post('api/webhooks/singapay')
  @HttpCode(200)
  handle(@Req() request: RawBodyRequest) {
    return this.singaPay.handleWebhook({
      body: request.body,
      rawBody: request.rawBody,
      headers: request.headers,
      url: request.url,
    });
  }
}
