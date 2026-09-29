import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { API_ERROR_CODES, ROLES, type Role } from '@helpzy/types';

import { ROLES_KEY } from './roles.decorator';
import type { RequestWithUser } from './auth.guard';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException({
        code: API_ERROR_CODES.FORBIDDEN,
        message: 'Authentication is required before checking permissions.',
      });
    }

    if (!requiredRoles.includes(user.role)) {
      throw new ForbiddenException({
        code: API_ERROR_CODES.FORBIDDEN,
        message: 'You do not have permission to access this resource.',
      });
    }

    if (user.role === ROLES.ADMIN && user.mfaVerified !== true) {
      throw new ForbiddenException({
        code: API_ERROR_CODES.MFA_REQUIRED,
        message: 'Multi-factor authentication is required before accessing admin routes.',
      });
    }

    return true;
  }
}
