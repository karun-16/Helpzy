import {
  resolveApiBaseUrl,
  resolveApiGlobalPrefix,
  resolveApiTimeoutMs,
  type PublicEnv,
} from '@helpzy/config';
import { API_ERROR_CODES, type ApiErrorBody, type ApiResponse } from '@helpzy/types';
import type { z } from 'zod';

import { ApiError } from './errors';

export type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions<T> {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, QueryValue>;
  headers?: Record<string, string>;
  /** When provided, the unwrapped `data` payload is validated before returning. */
  schema?: z.ZodType<T>;
  signal?: AbortSignal;
}

export interface ApiClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
  globalPrefix?: string;
  /** Injected in tests; defaults to the platform `fetch`. */
  fetchImpl?: typeof fetch;
  /** Resolves the bearer token for the current session (added in PHASE 3). */
  getAuthToken?: () => string | null | undefined | Promise<string | null | undefined>;
  env?: PublicEnv;
}

function joinUrl(baseUrl: string, prefix: string, path: string): string {
  const segments = [prefix.replace(/^\/+|\/+$/g, ''), path.replace(/^\/+/, '')].filter(
    (segment) => segment.length > 0,
  );
  return `${baseUrl.replace(/\/+$/, '')}/${segments.join('/')}`;
}

function buildQueryString(query: Record<string, QueryValue> | undefined): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.append(key, String(value));
  }
  const serialised = params.toString();
  return serialised ? `?${serialised}` : '';
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: string }).name === 'AbortError'
  );
}

/**
 * Thin, typed wrapper around `fetch`.
 *
 * Responsibilities: prefix + query building, JSON (de)serialisation, timeout,
 * auth header injection and normalisation of every failure into `ApiError`.
 * It deliberately contains no business logic and no UI concerns.
 */
export class HelpzyApiClient {
  readonly baseUrl: string;
  readonly globalPrefix: string;
  readonly timeoutMs: number;

  private readonly fetchImpl: typeof fetch;
  private readonly getAuthToken: ApiClientOptions['getAuthToken'];

  constructor(options: ApiClientOptions = {}) {
    const env: PublicEnv =
      options.env ??
      (typeof process !== 'undefined' && process.env ? (process.env as PublicEnv) : {});

    this.baseUrl = options.baseUrl ?? resolveApiBaseUrl(env);
    this.globalPrefix = options.globalPrefix ?? resolveApiGlobalPrefix(env);
    this.timeoutMs = options.timeoutMs ?? resolveApiTimeoutMs(env);
    // Browsers require `fetch` to be called with `window` as its receiver;
    // storing the bare function reference and invoking it as a method of this
    // client would throw "Illegal invocation".
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.getAuthToken = options.getAuthToken;
  }

  async request<T>(path: string, options: RequestOptions<T> = {}): Promise<T> {
    return this.execute<T>(path, this.globalPrefix, options);
  }

  /** Requests a path that intentionally lives outside the configured prefix. */
  async requestUnversioned<T>(path: string, options: RequestOptions<T> = {}): Promise<T> {
    return this.execute<T>(path, '', options);
  }

  private async execute<T>(path: string, prefix: string, options: RequestOptions<T>): Promise<T> {
    const { method = 'GET', body, query, headers = {}, schema, signal } = options;

    const url = `${joinUrl(this.baseUrl, prefix, path)}${buildQueryString(query)}`;

    const requestHeaders: Record<string, string> = {
      Accept: 'application/json',
      ...headers,
    };
    if (body !== undefined) {
      requestHeaders['Content-Type'] = 'application/json';
    }

    const token = await this.resolveAuthToken();
    if (token) {
      requestHeaders.Authorization = `Bearer ${token}`;
    }

    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), this.timeoutMs);
    const onExternalAbort = () => timeoutController.abort();
    signal?.addEventListener('abort', onExternalAbort);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: requestHeaders,
        signal: timeoutController.signal,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw signal?.aborted
          ? ApiError.network('The request was cancelled.')
          : ApiError.timeout(this.timeoutMs);
      }
      throw ApiError.network(error instanceof Error && error.message ? error.message : undefined);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onExternalAbort);
    }

    const payload = await this.readJson(response);

    if (!response.ok) {
      throw this.toApiError(response, payload);
    }

    const data = extractData(payload);

    if (schema) {
      const parsed = schema.safeParse(data);
      if (!parsed.success) {
        throw new ApiError({
          code: 'INVALID_RESPONSE',
          message: 'The server returned an unexpected response.',
          status: response.status,
          details: parsed.error.issues.map((issue) => ({
            field: issue.path.join('.') || '(root)',
            messages: [issue.message],
          })),
        });
      }
      return parsed.data;
    }

    return data as T;
  }

  get<T>(path: string, options: Omit<RequestOptions<T>, 'method' | 'body'> = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: 'GET' });
  }

  /** GET an operational route, bypassing the versioned prefix. */
  getUnversioned<T>(
    path: string,
    options: Omit<RequestOptions<T>, 'method' | 'body'> = {},
  ): Promise<T> {
    return this.requestUnversioned<T>(path, { ...options, method: 'GET' });
  }

  post<T>(path: string, body?: unknown, options: Omit<RequestOptions<T>, 'method'> = {}) {
    return this.request<T>(path, { ...options, method: 'POST', body });
  }

  patch<T>(path: string, body?: unknown, options: Omit<RequestOptions<T>, 'method'> = {}) {
    return this.request<T>(path, { ...options, method: 'PATCH', body });
  }

  delete<T>(path: string, options: Omit<RequestOptions<T>, 'method' | 'body'> = {}) {
    return this.request<T>(path, { ...options, method: 'DELETE' });
  }

  /**
   * Fetches bytes from an authorised route, with the session's bearer token.
   *
   * Exists because not every response is JSON: an admin opening a submitted
   * identity document needs the file itself. Routing that through `get` would run
   * the body through `readJson`, which is exactly the wrong thing to do with a
   * PDF.
   *
   * Returns the raw `Response` so the caller chooses how to display it. Errors
   * still arrive as `ApiError`, so a caller does not have to handle two failure
   * shapes.
   */
  async fetchAuthorized(path: string, options: { signal?: AbortSignal } = {}): Promise<Response> {
    const url = joinUrl(this.baseUrl, this.globalPrefix, path);
    const headers: Record<string, string> = {};
    const token = await this.resolveAuthToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), this.timeoutMs);
    const onExternalAbort = () => timeoutController.abort();
    options.signal?.addEventListener('abort', onExternalAbort);

    try {
      const response = await this.fetchImpl(url, {
        method: 'GET',
        headers,
        signal: timeoutController.signal,
      });
      if (response.ok) return response;
      throw this.toApiError(response, await this.readJson(response).catch(() => null));
    } catch (error) {
      if (isAbortError(error)) {
        throw options.signal?.aborted
          ? ApiError.network('The request was cancelled.')
          : ApiError.timeout(this.timeoutMs);
      }
      if (error instanceof ApiError) throw error;
      throw ApiError.network(error instanceof Error && error.message ? error.message : undefined);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onExternalAbort);
    }
  }

  private async resolveAuthToken(): Promise<string | null> {
    if (!this.getAuthToken) return null;
    return (await this.getAuthToken()) ?? null;
  }

  private async readJson(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) return undefined;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return undefined;
    }
  }

  private toApiError(response: Response, payload: unknown): ApiError {
    const body = payload as Partial<ApiErrorBody> | undefined;
    const errorBody = body?.error;

    if (errorBody && typeof errorBody === 'object') {
      return new ApiError({
        code: errorBody.code ?? API_ERROR_CODES.INTERNAL_SERVER_ERROR,
        message: errorBody.message || 'Something went wrong. Please try again.',
        status: response.status,
        details: errorBody.details,
        requestId: errorBody.requestId,
      });
    }

    return new ApiError({
      code: API_ERROR_CODES.INTERNAL_SERVER_ERROR,
      message: `Request failed with status ${response.status}.`,
      status: response.status,
    });
  }
}

function extractData(payload: unknown): unknown {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return (payload as ApiResponse<unknown>).data;
  }
  return payload;
}

export function createApiClient(options?: ApiClientOptions): HelpzyApiClient {
  return new HelpzyApiClient(options);
}
