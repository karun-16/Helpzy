import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import type { RequestWithUser } from './auth.guard';
import { AuthService } from './auth.service';

/**
 * Attaches a session when a valid token is present, but never rejects.
 *
 * This is for the public marketplace catalogue. A signed-in visitor should see
 * the same categories, professionals and profiles as a guest - the professional
 * who opens Marketplace and the customer who signs in are looking at one shared
 * surface - so the payload cannot vary by role and access is not conditional on
 * having a session.
 *
 * It deliberately does not widen anything private: ownership-scoped routes keep
 * `AuthGuard` + `RolesGuard`, and a token that fails verification is ignored
 * rather than trusted, so the request simply proceeds as a guest.
 */
@Injectable()
export class OptionalAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const authHeader = request.headers.authorization;
    const token = typeof authHeader === 'string' ? authHeader.replace(/^Bearer\s+/i, '') : null;
    if (!token) return true;

    try {
      request.user = await this.authService.verifyToken(token);
    } catch {
      // An unusable token is not an error here: the route is public, so the
      // request continues without a session rather than failing.
      request.user = undefined;
    }

    return true;
  }
}
