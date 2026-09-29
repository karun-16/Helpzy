import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { type Observable, map } from 'rxjs';
import type { ApiResponse, ApiResponseMeta } from '@helpzy/types';

/**
 * Wraps every successful response in the shared envelope:
 *
 *   { "success": true, "data": ..., "meta": { "requestId", "timestamp" } }
 *
 * Controllers return plain domain objects; transport concerns stay here.
 * Handlers that already return a full envelope pass through untouched.
 */
@Injectable()
export class ApiResponseInterceptor<T> implements NestInterceptor<T, ApiResponse<T> | T> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<ApiResponse<T> | T> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();

    return next.handle().pipe(
      map((payload) => {
        if (isAlreadyEnveloped(payload)) {
          return payload;
        }

        const meta: ApiResponseMeta = {
          requestId: request.requestId,
          timestamp: new Date().toISOString(),
        };

        return { success: true, data: payload, meta };
      }),
    );
  }
}

function isAlreadyEnveloped(payload: unknown): boolean {
  return (
    typeof payload === 'object' && payload !== null && 'success' in payload && 'data' in payload
  );
}
