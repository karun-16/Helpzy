import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';

declare module 'express-serve-static-core' {
  interface Request {
    requestId?: string;
  }
}

/**
 * Assigns every request an id, reusing an inbound `x-request-id` when a proxy or
 * the client already provided one.
 *
 * The id is echoed back in the response header and included in success and
 * error envelopes, so a user-reported failure can be traced to server logs
 * without exposing any internal detail to the client.
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const inbound = req.headers[REQUEST_ID_HEADER];
  const requestId =
    typeof inbound === 'string' && inbound.trim().length > 0 ? inbound.trim() : randomUUID();

  req.requestId = requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);
  next();
}
