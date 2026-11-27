import 'server-only';
import {
  ApiError,
  type Calculation,
  type CalculateRequest,
  type EventPage,
  type ImportResult,
  type ImportSummary,
  type OverrideAction,
  type OverrideRow,
} from './api-types';
import { demoBackend } from './demo-backend';

/**
 * Everything the web app needs from the backend, shaped exactly like the API (ADR-0011:
 * the web app is an API client). Two implementations:
 * - `SVDT_API_URL` + `SVDT_API_KEY` set: the real API over HTTP.
 * - otherwise: an in-memory placeholder that runs the same importers and engine, seeded
 *   with sample data, so the UI works before the API is deployed.
 */
export interface Backend {
  readonly mode: 'api' | 'demo';
  importCsv(
    userId: string,
    input: { account: string; filename: string | null; importerId?: string; content: Uint8Array },
  ): Promise<ImportResult>;
  listImports(userId: string): Promise<ImportSummary[]>;
  listEvents(userId: string, opts: { limit: number; cursor?: string }): Promise<EventPage>;
  listOverrides(userId: string): Promise<OverrideRow[]>;
  addOverride(
    userId: string,
    input: { eventId: string; action: OverrideAction; note?: string },
  ): Promise<OverrideRow>;
  calculate(userId: string, req: CalculateRequest): Promise<Calculation>;
}

export function getBackend(): Backend {
  const url = process.env['SVDT_API_URL'];
  const key = process.env['SVDT_API_KEY'];
  return url && key ? httpBackend(url.replace(/\/$/, ''), key) : demoBackend;
}

function httpBackend(base: string, key: string): Backend {
  const call = async <T>(
    method: string,
    path: string,
    body?: { json: unknown } | { bytes: Uint8Array; type: string },
  ): Promise<T> => {
    const headers: Record<string, string> = { authorization: `Bearer ${key}` };
    let payload: BodyInit | undefined;
    if (body && 'json' in body) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body.json);
    } else if (body) {
      headers['content-type'] = body.type;
      payload = body.bytes as unknown as BodyInit;
    }
    const res = await fetch(`${base}${path}`, {
      method,
      headers,
      ...(payload !== undefined ? { body: payload } : {}),
      cache: 'no-store',
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => null)) as {
        error?: { code?: string; message?: string };
      } | null;
      throw new ApiError(
        res.status,
        err?.error?.code ?? 'http_error',
        err?.error?.message ?? `API ${res.status}`,
      );
    }
    return (res.status === 204 ? undefined : await res.json()) as T;
  };
  const u = (userId: string) => `/v1/users/${encodeURIComponent(userId)}`;
  return {
    mode: 'api',
    importCsv: (userId, { account, filename, importerId, content }) => {
      const q = new URLSearchParams({ account });
      if (filename) q.set('filename', filename);
      if (importerId) q.set('importerId', importerId);
      return call('POST', `${u(userId)}/imports?${q}`, { bytes: content, type: 'text/csv' });
    },
    listImports: async (userId) =>
      (await call<{ data: ImportSummary[] }>('GET', `${u(userId)}/imports`)).data,
    listEvents: (userId, { limit, cursor }) => {
      const q = new URLSearchParams({ limit: String(limit) });
      if (cursor) q.set('cursor', cursor);
      return call('GET', `${u(userId)}/events?${q}`);
    },
    listOverrides: async (userId) =>
      (await call<{ data: OverrideRow[] }>('GET', `${u(userId)}/overrides`)).data,
    addOverride: (userId, input) => call('POST', `${u(userId)}/overrides`, { json: input }),
    calculate: (userId, req) => call('POST', `${u(userId)}/calculations`, { json: req }),
  };
}
