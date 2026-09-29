import type { ApiErrorBody } from './api-error';

/** Envelope for every successful API response. */
export interface ApiResponse<T> {
  success: true;
  data: T;
  meta?: ApiResponseMeta;
}

export interface ApiResponseMeta {
  requestId?: string;
  timestamp?: string;
  [key: string]: unknown;
}

export type ApiErrorResponse = ApiErrorBody;

export interface PaginatedMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** Envelope for paginated list responses. */
export interface PaginatedResponse<T> {
  success: true;
  data: T[];
  meta: ApiResponseMeta & PaginatedMeta;
}
