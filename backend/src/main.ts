import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyInstance } from 'fastify';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { GatewayService } from './gateway/gateway.service';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ bodyLimit: 20 * 1024 * 1024 }),
    { bufferLogs: true },
  );

  const corsOrigins = process.env.CORS_ORIGINS
    ?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({
    origin: corsOrigins?.length ? corsOrigins : [
      'http://127.0.0.1:5174', 'http://localhost:5174',
      'http://127.0.0.1:5173', 'http://localhost:5173',
    ],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['content-type', 'authorization', 'x-admin-token', 'x-api-key'],
  });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  await app.init();

  const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
  const gateway = app.get(GatewayService);
  fastify.route({
    method: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    url: '/api/proxy/*',
    handler: (request, reply) => gateway.handle(request, reply),
  });

  const port = Number(process.env.PORT ?? 3002);
  const host = process.env.HOST ?? '127.0.0.1';
  await app.listen(port, host);
  app.getHttpAdapter().getInstance().log.info(`DeepSeek Monitor listening on http://${host}:${port}`);
}

void bootstrap();
