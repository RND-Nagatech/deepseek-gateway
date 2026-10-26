import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ headers: Record<string, string | string[] | undefined> }>();
    const provided = request.headers['x-admin-token'];
    const expected = process.env.ADMIN_TOKEN ?? 'local-dev-token';
    const candidate = Array.isArray(provided) ? provided[0] : provided;
    if (!candidate) return false;

    const providedBuffer = Buffer.from(candidate);
    const expectedBuffer = Buffer.from(expected);
    return providedBuffer.length === expectedBuffer.length && timingSafeEqual(providedBuffer, expectedBuffer);
  }
}
