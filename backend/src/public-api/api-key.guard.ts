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

export interface IntegrationApiIdentity {
  client: ClientDocument;
  key: ClientKeyDocument;
}

export type IntegrationApiRequest = FastifyRequest & {
  integrationApiIdentity?: IntegrationApiIdentity;
};

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

@Injectable()
export class IntegrationApiKeyGuard implements CanActivate {
  constructor(private readonly clients: ClientsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<IntegrationApiRequest>();
    const authorization = firstHeader(request.headers.authorization);
    const headerKey = firstHeader(request.headers['x-integration-key']);
    const rawKey = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? headerKey?.trim();
    if (!rawKey) throw new UnauthorizedException('A separate integration API key is required.');

    let identity: Awaited<ReturnType<ClientsService['findActiveIntegrationKey']>>;
    try {
      identity = await this.clients.findActiveIntegrationKey(rawKey);
    } catch {
      throw new ServiceUnavailableException('The monitoring database is unavailable.');
    }
    if (!identity) throw new UnauthorizedException('This integration API key is invalid, revoked, or inactive.');

    request.integrationApiIdentity = identity;
    return true;
  }
}
