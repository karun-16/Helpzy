import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { API_ERROR_CODES, type ApiErrorCode, type ApiFieldError } from '@helpzy/types';

const STATUS_TO_ERROR_CODE: Partial<Record<HttpStatus, ApiErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: API_ERROR_CODES.BAD_REQUEST,
  [HttpStatus.UNAUTHORIZED]: API_ERROR_CODES.UNAUTHORIZED,
  [HttpStatus.FORBIDDEN]: API_ERROR_CODES.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: API_ERROR_CODES.NOT_FOUND,
  [HttpStatus.CONFLICT]: API_ERROR_CODES.CONFLICT,
  [HttpStatus.PAYLOAD_TOO_LARGE]: API_ERROR_CODES.PAYLOAD_TOO_LARGE,
  [HttpStatus.TOO_MANY_REQUESTS]: API_ERROR_CODES.TOO_MANY_REQUESTS,
  [HttpStatus.SERVICE_UNAVAILABLE]: API_ERROR_CODES.SERVICE_UNAVAILABLE,
};

const GENERIC_MESSAGES: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'The request could not be understood.',
  [HttpStatus.UNAUTHORIZED]: 'Authentication is required to access this resource.',
  [HttpStatus.FORBIDDEN]: 'You do not have permission to perform this action.',
  [HttpStatus.NOT_FOUND]: 'The requested resource was not found.',
  [HttpStatus.CONFLICT]: 'The request conflicts with the current state of the resource.',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'That file is larger than this server accepts.',
  [HttpStatus.TOO_MANY_REQUESTS]: 'Too many requests. Please slow down and try again.',
};

/**
 * Body-parser rejects an oversized or malformed request body with a plain
 * `Error` carrying a `status`/`type`, not an `HttpException`. It is raised
 * before any controller runs, so without this mapping an ordinary "file too
 * big" would reach the client as an opaque 500.
 */
interface BodyParserError {
  status?: number;
  statusCode?: number;
  type?: string;
  message?: string;
}

/**
 * Last line of defence: converts any thrown value into the shared error
 * envelope.
 *
 * Two rules are enforced here:
 *  1. Clients never receive a stack trace or an internal message. Unknown
 *     errors become a generic 500 and are logged server-side with the request
 *     id, which is returned to the client for support purposes.
 *  2. Expected `HttpException`s keep their status and safe message.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();

    const { status, code, message, details } = this.describe(exception);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.originalUrl} -> ${status} ${code} (requestId=${request.requestId})`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(
        `${request.method} ${request.originalUrl} -> ${status} ${code}: ${message} (requestId=${request.requestId})`,
      );
    }

    if (response.headersSent) {
      return;
    }

    response.status(status).json({
      error: {
        code,
        message,
        ...(details ? { details } : {}),
        ...(request.requestId ? { requestId: request.requestId } : {}),
        timestamp: new Date().toISOString(),
      },
    });
  }

  private describe(exception: unknown): {
    status: number;
    code: ApiErrorCode | string;
    message: string;
    details?: ApiFieldError[];
  } {
    if (exception instanceof ZodError) {
      return {
        status: HttpStatus.BAD_REQUEST,
        code: API_ERROR_CODES.VALIDATION_FAILED,
        message: 'Some of the details you entered are not valid.',
        details: exception.issues.map((issue) => ({
          field: issue.path.join('.') || '(root)',
          messages: [issue.message],
        })),
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();

      if (typeof payload === 'object' && payload !== null) {
        const record = payload as { message?: unknown; code?: unknown; error?: unknown };
        // Only exceptions raised by our own code carry an explicit `code`, which
        // is what makes their message safe to forward. Everything else - most
        // importantly the router's own `{ message: 'Cannot GET /x' }` 404 - is
        // replaced with a status-appropriate generic message so that routing
        // internals are never disclosed.
        const isOurs = typeof record.code === 'string';
        const code = isOurs
          ? (record.code as string)
          : (STATUS_TO_ERROR_CODE[status as HttpStatus] ?? API_ERROR_CODES.INTERNAL_SERVER_ERROR);
        const message = isOurs
          ? typeof record.message === 'string'
            ? record.message
            : (GENERIC_MESSAGES[status] ?? 'The request could not be processed.')
          : Array.isArray(record.message)
            ? 'The request could not be processed.'
            : (GENERIC_MESSAGES[status] ?? 'The request could not be processed.');

        return { status, code, message };
      }

      // String payloads come from the router itself (e.g. "Cannot GET /x").
      // They reveal routing internals, so a generic message is returned.
      return {
        status,
        code: STATUS_TO_ERROR_CODE[status as HttpStatus] ?? API_ERROR_CODES.INTERNAL_SERVER_ERROR,
        message: GENERIC_MESSAGES[status] ?? 'The request could not be processed.',
      };
    }

    // Must come before the `HttpException` check below: body-parser errors are
    // not `HttpException`s, so without this they would be reported as a 500.
    const bodyParser = exception as BodyParserError;
    if (typeof bodyParser.type === 'string' && bodyParser.type.startsWith('entity.')) {
      return this.describeBodyParserError(bodyParser);
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: API_ERROR_CODES.INTERNAL_SERVER_ERROR,
      message: 'Something went wrong on our side. Please try again in a moment.',
    };
  }

  /**
   * Body-parser failures are the caller's fault, not ours, and they say so.
   * `entity.too.large` becomes a real 413 and `entity.parse.failed` a real 400,
   * so a client can tell "shrink the file" from "your JSON is malformed".
   */
  private describeBodyParserError(exception: BodyParserError): {
    status: number;
    code: ApiErrorCode;
    message: string;
  } {
    const status = exception.status ?? exception.statusCode ?? HttpStatus.BAD_REQUEST;

    if (status === HttpStatus.PAYLOAD_TOO_LARGE || exception.type === 'entity.too.large') {
      return {
        status: HttpStatus.PAYLOAD_TOO_LARGE,
        code: API_ERROR_CODES.PAYLOAD_TOO_LARGE,
        message: GENERIC_MESSAGES[HttpStatus.PAYLOAD_TOO_LARGE]!,
      };
    }

    return {
      status: HttpStatus.BAD_REQUEST,
      code: API_ERROR_CODES.BAD_REQUEST,
      message: GENERIC_MESSAGES[HttpStatus.BAD_REQUEST]!,
    };
  }
}
