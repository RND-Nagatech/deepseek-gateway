import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { ClientDocument, ClientKeyDocument } from '../common/schemas';
import { ClientsService } from '../clients/clients.service';

export interface GatewayApiIdentity {
  client: ClientDocument;
  key: ClientKeyDocument;
}

export type GatewayApiRequest = FastifyRequest & {
  gatewayApiIdentity?: GatewayApiIdentity;
};

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

@Injectable()
export class GatewayApiKeyGuard implements CanActivate {
  constructor(private readonly clients: ClientsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<GatewayApiRequest>();
    const authorization = firstHeader(request.headers.authorization);
    const headerKey = firstHeader(request.headers['x-api-key']);
    const rawKey = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? headerKey?.trim();
    if (!rawKey) throw new UnauthorizedException('A registered DeepSeek API key is required.');

    let identity: Awaited<ReturnType<ClientsService['findActiveKey']>>;
    try {
      identity = await this.clients.findActiveKey(rawKey);
    } catch {
      throw new ServiceUnavailableException('The monitoring database is unavailable.');
    }
    if (!identity) throw new UnauthorizedException('This DeepSeek API key is not registered or is inactive.');

    request.gatewayApiIdentity = identity;
    return true;
  }
}
