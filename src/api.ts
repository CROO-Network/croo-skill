import { loadConfig } from './config.js';
import type {
  ApiErrorBody,
  BaseConfirmResponse,
  BaseOrderDetail,
  BaseOrderListResponse,
  Chain,
  SearchResponse,
  SearchView,
  X402PaymentRequiredBody,
} from './types.js';

export type FetchLike = typeof fetch;

let customFetch: FetchLike | null = null;

export function setFetchImpl(fn: FetchLike | null): void {
  customFetch = fn;
}

function getFetch(): FetchLike {
  return customFetch || globalThis.fetch;
}

export class CrooApiError extends Error {
  public readonly httpStatus: number;
  public readonly reason: string;
  public readonly metadata: Record<string, unknown>;
  public readonly rawBody: unknown;

  constructor(
    httpStatus: number,
    reason: string,
    message: string,
    metadata: Record<string, unknown> = {},
    rawBody?: unknown
  ) {
    super(message);
    this.name = 'CrooApiError';
    this.httpStatus = httpStatus;
    this.reason = reason;
    this.metadata = metadata;
    this.rawBody = rawBody;
  }
}

export function getHeaderCaseInsensitive(headers: Headers, targetName: string): string | null {
  const direct = headers.get(targetName);
  if (direct !== null) return direct;
  const lower = targetName.toLowerCase();
  for (const [k, v] of headers.entries()) {
    if (k.toLowerCase() === lower) {
      return v;
    }
  }
  return null;
}

export function decodeBase64Json<T = Record<string, unknown>>(b64: string | null): T | null {
  if (!b64) return null;
  const trimmed = b64.trim();
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed) as T;
    } catch {
      // Fall through to base64 decode
    }
  }
  try {
    const jsonStr = Buffer.from(trimmed, 'base64').toString('utf8');
    return JSON.parse(jsonStr) as T;
  } catch {
    return null;
  }
}

export interface SearchParams {
  q?: string;
  view?: SearchView;
  chain?: Chain;
  agentId?: string;
  limit?: number;
}

export async function searchSkill(params: SearchParams): Promise<SearchResponse> {
  const { apiBaseUrl } = loadConfig();
  const url = new URL(`${apiBaseUrl}/backend/v1/skill/search`);
  if (params.agentId) {
    url.searchParams.set('agentId', params.agentId);
  } else if (params.q !== undefined) {
    url.searchParams.set('q', params.q);
  }
  if (params.view) {
    url.searchParams.set('view', params.view);
  }
  if (params.chain) {
    url.searchParams.set('chain', params.chain);
  }
  if (params.limit !== undefined) {
    url.searchParams.set('limit', String(params.limit));
  }

  const res = await getFetch()(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });

  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new CrooApiError(res.status, 'INVALID_JSON', `Unexpected response (${res.status})`);
  }

  if (!res.ok) {
    const errBody = data as Partial<ApiErrorBody>;
    throw new CrooApiError(
      res.status,
      errBody.reason || `HTTP_${res.status}`,
      errBody.message || `Request failed with status ${res.status}`,
      errBody.metadata || {},
      data
    );
  }

  return data as SearchResponse;
}

export interface BaseOrderHttpResult {
  httpStatus: number;
  paymentRequiredHeader: string | null;
  paymentResponseHeader: string | null;
  body: unknown;
}

export async function postBaseOrder(
  serviceId: string,
  bodyString: string,
  paymentHeader?: { name: string; value: string },
  timeoutMs: number = 130_000
): Promise<BaseOrderHttpResult> {
  const { apiBaseUrl } = loadConfig();
  const url = `${apiBaseUrl}/backend/v1/skill/services/${encodeURIComponent(serviceId)}/order`;

  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (bodyString.length > 0) {
    headers['Content-Type'] = 'application/json';
  }
  if (paymentHeader) {
    headers[paymentHeader.name] = paymentHeader.value;
  }

  const res = await getFetch()(url, {
    method: 'POST',
    headers,
    body: bodyString.length > 0 ? bodyString : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });

  const paymentRequiredHeader = getHeaderCaseInsensitive(res.headers, 'PAYMENT-REQUIRED');
  const paymentResponseHeader = getHeaderCaseInsensitive(res.headers, 'PAYMENT-RESPONSE');
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = text;
  }

  return {
    httpStatus: res.status,
    paymentRequiredHeader,
    paymentResponseHeader,
    body: parsed,
  };
}

export async function getBaseOrder(orderId: string): Promise<BaseOrderDetail> {
  const { apiBaseUrl } = loadConfig();
  const url = `${apiBaseUrl}/backend/v1/skill/orders/${encodeURIComponent(orderId)}`;
  const res = await getFetch()(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new CrooApiError(res.status, 'INVALID_JSON', `Unexpected response (${res.status})`);
  }

  if (!res.ok) {
    const errBody = data as Partial<ApiErrorBody>;
    throw new CrooApiError(
      res.status,
      errBody.reason || `HTTP_${res.status}`,
      errBody.message || `Order lookup failed (${res.status})`,
      errBody.metadata || {},
      data
    );
  }
  return data as BaseOrderDetail;
}

export async function listBaseOrders(
  payer: string,
  page: number = 1,
  pageSize: number = 50
): Promise<BaseOrderListResponse> {
  const { apiBaseUrl } = loadConfig();
  const url = new URL(`${apiBaseUrl}/backend/v1/skill/orders`);
  url.searchParams.set('payer', payer);
  url.searchParams.set('page', String(page));
  url.searchParams.set('pageSize', String(pageSize));

  const res = await getFetch()(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new CrooApiError(res.status, 'INVALID_JSON', `Unexpected response (${res.status})`);
  }

  if (!res.ok) {
    const errBody = data as Partial<ApiErrorBody>;
    throw new CrooApiError(
      res.status,
      errBody.reason || `HTTP_${res.status}`,
      errBody.message || `Order list failed (${res.status})`,
      errBody.metadata || {},
      data
    );
  }
  return data as BaseOrderListResponse;
}

export interface BnbEndpointCallOptions {
  endpoint: string;
  method: 'GET' | 'POST';
  requirementsRaw: string;
  paymentHeader?: { name: string; value: string };
  timeoutMs?: number;
}

export interface BnbEndpointCallResult {
  finalUrl: string;
  httpStatus: number;
  contentType: string;
  paymentRequiredHeader: string | null;
  paymentResponseHeader: string | null;
  rawText: string;
  jsonBody: unknown | null;
}

export function buildBnbRequestUrl(
  endpoint: string,
  method: 'GET' | 'POST',
  requirementsRaw: string
): string {
  if (method !== 'GET' || !requirementsRaw.trim()) {
    return endpoint;
  }
  const url = new URL(endpoint);
  try {
    const parsed = JSON.parse(requirementsRaw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (v !== undefined && v !== null) {
          url.searchParams.set(
            k,
            typeof v === 'object' ? JSON.stringify(v) : String(v)
          );
        }
      }
      return url.toString();
    }
    if (typeof parsed === 'string') {
      const extra = new URLSearchParams(parsed);
      for (const [k, v] of extra.entries()) {
        url.searchParams.set(k, v);
      }
      return url.toString();
    }
  } catch {
    // If raw string is key=value query params
    const extra = new URLSearchParams(requirementsRaw);
    for (const [k, v] of extra.entries()) {
      url.searchParams.set(k, v);
    }
  }
  return url.toString();
}

export async function callBnbEndpoint(
  opts: BnbEndpointCallOptions
): Promise<BnbEndpointCallResult> {
  const finalUrl = buildBnbRequestUrl(opts.endpoint, opts.method, opts.requirementsRaw);
  const headers: Record<string, string> = {
    Accept: 'application/json, text/plain, */*',
  };

  let body: string | undefined;
  if (opts.method === 'POST') {
    body = opts.requirementsRaw || '{}';
    headers['Content-Type'] = 'application/json';
  }
  if (opts.paymentHeader) {
    headers[opts.paymentHeader.name] = opts.paymentHeader.value;
  }

  const res = await getFetch()(finalUrl, {
    method: opts.method,
    headers,
    body,
    signal: AbortSignal.timeout(opts.timeoutMs ?? 90_000),
  });

  const paymentRequiredHeader = getHeaderCaseInsensitive(res.headers, 'PAYMENT-REQUIRED');
  const paymentResponseHeader = getHeaderCaseInsensitive(res.headers, 'PAYMENT-RESPONSE');
  const contentType = getHeaderCaseInsensitive(res.headers, 'content-type') || 'text/plain';
  const rawText = await res.text();
  let jsonBody: unknown | null = null;
  try {
    jsonBody = rawText ? JSON.parse(rawText) : null;
  } catch {
    jsonBody = null;
  }

  return {
    finalUrl,
    httpStatus: res.status,
    contentType,
    paymentRequiredHeader,
    paymentResponseHeader,
    rawText,
    jsonBody,
  };
}

export function extractX402RequirementPayload(
  paymentRequiredHeader: string | null,
  body: unknown
): { rawForBaw: string; parsed: X402PaymentRequiredBody | null } {
  if (body && typeof body === 'object' && Array.isArray((body as X402PaymentRequiredBody).accepts)) {
    const typed = body as X402PaymentRequiredBody;
    const minimalPayload: X402PaymentRequiredBody = {
      x402Version: typed.x402Version || 2,
      ...(typed.error ? { error: typed.error } : {}),
      ...(typed.resource ? { resource: typed.resource } : {}),
      accepts: typed.accepts,
    };
    return {
      rawForBaw: paymentRequiredHeader || JSON.stringify(minimalPayload),
      parsed: typed,
    };
  }
  if (paymentRequiredHeader) {
    const decoded = decodeBase64Json<X402PaymentRequiredBody>(paymentRequiredHeader);
    return {
      rawForBaw: paymentRequiredHeader,
      parsed: decoded,
    };
  }
  return { rawForBaw: '', parsed: null };
}

export function extractTxHashFromPaymentResponse(paymentResponseHeader: string | null): string {
  const decoded = decodeBase64Json<Record<string, unknown>>(paymentResponseHeader);
  if (!decoded) return '';
  if (typeof decoded.transaction === 'string') return decoded.transaction;
  if (typeof decoded.txHash === 'string') return decoded.txHash;
  if (typeof decoded.hash === 'string') return decoded.hash;
  return '';
}
