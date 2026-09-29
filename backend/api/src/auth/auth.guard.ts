import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { API_ERROR_CODES } from '@helpzy/types';

import { AuthService, type AuthSessionPayload } from './auth.service';

export type RequestWithUser = Request & {
  user?: AuthSessionPayload;
};

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const authHeader = request.headers.authorization;
    const token = typeof authHeader === 'string' ? authHeader.replace(/^Bearer\s+/i, '') : null;

    if (!token) {
      throw new UnauthorizedException({
        code: API_ERROR_CODES.UNAUTHORIZED,
        message: 'Authentication is required to access this resource.',
      });
    }

    try {
      request.user = await this.authService.verifyToken(token);
      return true;
    } catch {
      throw new UnauthorizedException({
        code: API_ERROR_CODES.UNAUTHORIZED,
        message: 'Your session is invalid or expired.',
      });
    }
  }
}
