import { API_ERROR_CODES, type ApiErrorCode, type ApiFieldError } from '@helpzy/types';

/**
 * Every failure surfaced by the client is an `ApiError`, so screens can branch
 * on `error.code` instead of string matching messages. Network and timeout
 * failures are normalised into the same shape as server failures, which keeps
 * error handling uniform across the app.
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode | string;
  readonly status: number;
  readonly details: ApiFieldError[] | undefined;
  readonly requestId: string | undefined;

  constructor(params: {
    code: ApiErrorCode | string;
    message: string;
    status: number;
    details?: ApiFieldError[];
    requestId?: string;
  }) {
    super(params.message);
    this.name = 'ApiError';
    this.code = params.code;
    this.status = params.status;
    this.details = params.details;
    this.requestId = params.requestId;
    Object.setPrototypeOf(this, ApiError.prototype);
  }

  /** True when the request never reached the API (offline, DNS, refused). */
  get isNetworkError(): boolean {
    return this.code === API_ERROR_CODES.NETWORK_ERROR || this.code === API_ERROR_CODES.TIMEOUT;
  }

  /** True when the user has to authenticate again. */
  get isAuthError(): boolean {
    return this.status === 401 || this.code === API_ERROR_CODES.UNAUTHORIZED;
  }

  static network(message = 'Unable to reach the server. Check your connection and try again.') {
    return new ApiError({ code: API_ERROR_CODES.NETWORK_ERROR, message, status: 0 });
  }

  static timeout(timeoutMs: number) {
    return new ApiError({
      code: API_ERROR_CODES.TIMEOUT,
      message: `The request took longer than ${timeoutMs}ms and was cancelled.`,
      status: 0,
    });
  }
}
