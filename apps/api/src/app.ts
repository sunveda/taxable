import { createRoute, OpenAPIHono, type z } from '@hono/zod-openapi';
import {
  addOverride,
  authenticate,
  createUser,
  getUser,
  listEvents,
  listImports,
  listOverrides,
  loadLedger,
  overrideTargetExists,
  purgeUser,
  saveImport,
  withoutTenant,
  withTenant,
  type Caller,
  type Database,
} from '@svdt/db';
import {
  csvImporters,
  decodeText,
  importCsv,
  matchTransfers,
  UnknownFormatError,
} from '@svdt/importers';
import { getRulePack, UnsupportedTaxYearError } from '@svdt/rule-packs';
import { calculate, type Override } from '@svdt/tax-engine';
import { bodyLimit } from 'hono/body-limit';
import type { Context } from 'hono';
import {
  CalculateBody,
  CalculationSchema,
  CreateOverrideBody,
  CreateUserBody,
  ErrorSchema,
  EventPageSchema,
  EventsQuery,
  ImportQuery,
  ImportListSchema,
  ImportSchema,
  OkSchema,
  OverrideListSchema,
  OverrideSchema,
  UserIdParams,
  UserSchema,
} from './schemas';

type Env = { Variables: { caller: Caller } };

const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

const errorBody = (code: string, message: string) => ({ error: { code, message } });
const err = (description: string) => ({
  content: { 'application/json': { schema: ErrorSchema } },
  description,
});
const ok = <S extends z.ZodType>(schema: S, description: string) => ({
  content: { 'application/json': { schema } },
  description,
});
const security = [{ ApiKey: [] }];

/**
 * The HTTP API (ADR-0011). Partner-style surface: a tenant API key acts on that tenant's
 * users under `/v1/users/{userId}`. Our own web and mobile apps will be clients of it too.
 */
export function createApp(database: Database) {
  const app = new OpenAPIHono<Env>({
    defaultHook: (result, c) => {
      if (!result.success) {
        const first = result.error.issues[0];
        const where = first?.path.length ? `${first.path.join('.')}: ` : '';
        return c.json(errorBody('invalid_request', `${where}${first?.message ?? 'invalid'}`), 400);
      }
    },
  });

  app.openAPIRegistry.registerComponent('securitySchemes', 'ApiKey', {
    type: 'http',
    scheme: 'bearer',
    description: 'A tenant API key: `Authorization: Bearer svdt_…`.',
  });

  app.onError((e, c) => {
    console.error(e);
    return c.json(errorBody('internal', 'Internal error'), 500);
  });
  app.notFound((c) => c.json(errorBody('not_found', 'No such route'), 404));

  app.use('/v1/users/*', auth(database));
  app.use('/v1/users', auth(database));

  const tenant = <T>(c: Context<Env>, fn: Parameters<typeof withTenant<T>>[2]) =>
    withTenant(database, c.var.caller.tenantId, fn);

  // --- Meta -------------------------------------------------------------------------------
  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/health',
      responses: { 200: ok(OkSchema, 'The API is up') },
    }),
    (c) => c.json({ ok: true as const }, 200),
  );
  app.doc31('/v1/openapi.json', {
    openapi: '3.1.0',
    info: { title: 'svdt API', version: '0.1.0' },
  });

  // --- Users ------------------------------------------------------------------------------
  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/users',
      security,
      request: { body: { content: { 'application/json': { schema: CreateUserBody } } } },
      responses: {
        201: ok(UserSchema, 'Created'),
        401: err('Missing or invalid API key'),
        409: err('A user with this externalRef already exists'),
      },
    }),
    async (c) => {
      const { externalRef } = c.req.valid('json');
      const { tenantId } = c.var.caller;
      const user = await tenant(c, (tx) => createUser(tx, tenantId, externalRef ?? null));
      if (!user) return c.json(errorBody('conflict', 'externalRef already in use'), 409);
      return c.json(user, 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/users/{userId}',
      security,
      request: { params: UserIdParams },
      responses: {
        200: ok(UserSchema, 'The user'),
        401: err('Missing or invalid API key'),
        404: err('No such user'),
      },
    }),
    async (c) => {
      const { userId } = c.req.valid('param');
      const user = await tenant(c, (tx) => getUser(tx, c.var.caller.tenantId, userId));
      if (!user) return c.json(noUser, 404);
      return c.json(user, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/v1/users/{userId}',
      security,
      description: 'Permanently deletes the user and all their data: raw files, events, overrides.',
      request: { params: UserIdParams },
      responses: {
        204: { description: 'Deleted' },
        401: err('Missing or invalid API key'),
        404: err('No such user'),
      },
    }),
    async (c) => {
      const { userId } = c.req.valid('param');
      const purged = await tenant(c, (tx) => purgeUser(tx, userId));
      if (!purged) return c.json(noUser, 404);
      return c.body(null, 204);
    },
  );

  // --- Imports and events -----------------------------------------------------------------
  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/users/{userId}/imports',
      security,
      description:
        'Uploads an exchange CSV export. The format is detected unless `importerId` is given. ' +
        'The raw file is kept; events are upserted by id, so re-importing is safe.',
      middleware: [
        bodyLimit({
          maxSize: MAX_IMPORT_BYTES,
          onError: (c) => c.json(errorBody('too_large', 'File is larger than 20 MB'), 413),
        }),
      ] as const,
      request: {
        params: UserIdParams,
        query: ImportQuery,
        body: {
          required: true,
          content: { 'text/csv': { schema: { type: 'string', format: 'binary' } } },
        },
      },
      responses: {
        201: ok(ImportSchema, 'Imported'),
        400: err('Invalid request'),
        401: err('Missing or invalid API key'),
        404: err('No such user'),
        413: err('File too large'),
        422: err('Unrecognized file format'),
      },
    }),
    async (c) => {
      const { userId } = c.req.valid('param');
      const { account, importerId, filename } = c.req.valid('query');
      const content = new Uint8Array(await c.req.arrayBuffer());
      if (content.byteLength === 0) return c.json(errorBody('invalid_request', 'Empty file'), 400);
      if (importerId && !csvImporters.some((i) => i.id === importerId)) {
        return c.json(errorBody('invalid_request', `Unknown importerId "${importerId}"`), 400);
      }
      const { text, encoding } = decodeText(content);
      let parsed;
      try {
        parsed = importCsv(text, { accountId: account, ...(importerId ? { importerId } : {}) });
      } catch (e) {
        if (e instanceof UnknownFormatError) {
          return c.json(errorBody('unknown_format', e.message), 422);
        }
        throw e;
      }
      const { tenantId } = c.var.caller;
      const saved = await tenant(c, async (tx) => {
        if (!(await getUser(tx, tenantId, userId))) return null;
        return saveImport(tx, {
          tenantId,
          userId,
          accountName: account,
          content,
          filename: filename ?? null,
          encoding,
          importerId: parsed.importer.id,
          stats: parsed.stats,
          warnings: parsed.warnings,
          events: parsed.events,
        });
      });
      if (!saved) return c.json(noUser, 404);
      return c.json(
        {
          ...saved,
          importer: {
            id: parsed.importer.id,
            name: parsed.importer.name,
            status: parsed.importer.format.status,
          },
          encoding,
          stats: parsed.stats,
          warnings: parsed.warnings,
        },
        201,
      );
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/users/{userId}/imports',
      security,
      description: 'Every file imported for the user, newest first.',
      request: { params: UserIdParams },
      responses: {
        200: ok(ImportListSchema, 'Imports'),
        401: err('Missing or invalid API key'),
        404: err('No such user'),
      },
    }),
    async (c) => {
      const { userId } = c.req.valid('param');
      const { tenantId } = c.var.caller;
      const rows = await tenant(c, async (tx) => {
        if (!(await getUser(tx, tenantId, userId))) return null;
        return listImports(tx, tenantId, userId);
      });
      if (!rows) return c.json(noUser, 404);
      return c.json({ data: rows }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/users/{userId}/events',
      security,
      description: 'Normalized ledger events, oldest first.',
      request: { params: UserIdParams, query: EventsQuery },
      responses: {
        200: ok(EventPageSchema, 'A page of events'),
        400: err('Invalid request'),
        401: err('Missing or invalid API key'),
        404: err('No such user'),
      },
    }),
    async (c) => {
      const { userId } = c.req.valid('param');
      const { limit, cursor } = c.req.valid('query');
      const after = cursor ? decodeCursor(cursor) : undefined;
      if (cursor && !after) return c.json(errorBody('invalid_request', 'Bad cursor'), 400);
      const { tenantId } = c.var.caller;
      const rows = await tenant(c, async (tx) => {
        if (!(await getUser(tx, tenantId, userId))) return null;
        return listEvents(tx, tenantId, userId, { limit, ...(after ? { after } : {}) });
      });
      if (!rows) return c.json(noUser, 404);
      const last = rows.length === limit ? rows[rows.length - 1] : undefined;
      return c.json(
        {
          data: rows.map((r) => ({ ...r, event: r.event as unknown as Record<string, unknown> })),
          nextCursor: last ? encodeCursor(last) : null,
        },
        200,
      );
    },
  );

  // --- Overrides (fix queue) --------------------------------------------------------------
  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/users/{userId}/overrides',
      security,
      description:
        'Records a correction (ADR-0009). Overrides are append-only: to undo one, add a ' +
        '`revoke`. A suggested resolution from a calculation can be posted as-is. `eventId` ' +
        'is a stored event or a matched transfer (`transfer:<withdrawal>><deposit>`).',
      request: {
        params: UserIdParams,
        body: { content: { 'application/json': { schema: CreateOverrideBody } } },
      },
      responses: {
        201: ok(OverrideSchema, 'Recorded'),
        400: err('Invalid request'),
        401: err('Missing or invalid API key'),
        404: err('No such user'),
        422: err('No such event'),
      },
    }),
    async (c) => {
      const { userId } = c.req.valid('param');
      const body = c.req.valid('json');
      const { tenantId, keyName } = c.var.caller;
      const result = await tenant(c, async (tx) => {
        if (!(await getUser(tx, tenantId, userId))) return 'no_user' as const;
        if (!(await overrideTargetExists(tx, tenantId, userId, body.eventId))) {
          return 'no_event' as const;
        }
        return addOverride(tx, {
          tenantId,
          userId,
          eventId: body.eventId,
          author: `key:${keyName}`,
          note: body.note ?? null,
          action: body.action,
        });
      });
      if (result === 'no_user') return c.json(noUser, 404);
      if (result === 'no_event') {
        return c.json(errorBody('unknown_event', `No event "${body.eventId}"`), 422);
      }
      return c.json(result as z.infer<typeof OverrideSchema>, 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/users/{userId}/overrides',
      security,
      description: 'Every override ever recorded for the user, oldest first.',
      request: { params: UserIdParams },
      responses: {
        200: ok(OverrideListSchema, 'Overrides'),
        401: err('Missing or invalid API key'),
        404: err('No such user'),
      },
    }),
    async (c) => {
      const { userId } = c.req.valid('param');
      const { tenantId } = c.var.caller;
      const rows = await tenant(c, async (tx) => {
        if (!(await getUser(tx, tenantId, userId))) return null;
        return listOverrides(tx, tenantId, userId);
      });
      if (!rows) return c.json(noUser, 404);
      return c.json({ data: rows as z.infer<typeof OverrideSchema>[] }, 200);
    },
  );

  // --- Calculations -----------------------------------------------------------------------
  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/users/{userId}/calculations',
      security,
      description:
        'Computes a tax year from the stored ledger and overrides: transfers are matched, then ' +
        'the engine runs. Derived data is recomputed on every call, never stored (ADR-0009).',
      request: {
        params: UserIdParams,
        body: { content: { 'application/json': { schema: CalculateBody } } },
      },
      responses: {
        200: ok(CalculationSchema, 'The calculation'),
        400: err('Invalid request'),
        401: err('Missing or invalid API key'),
        404: err('No such user'),
        422: err('Tax year not supported'),
      },
    }),
    async (c) => {
      const { userId } = c.req.valid('param');
      const body = c.req.valid('json');
      const { tenantId } = c.var.caller;
      const data = await tenant(c, async (tx) => {
        if (!(await getUser(tx, tenantId, userId))) return null;
        return {
          ledger: await loadLedger(tx, tenantId, userId),
          overrides: await listOverrides(tx, tenantId, userId),
        };
      });
      if (!data) return c.json(noUser, 404);

      const matched = matchTransfers(data.ledger);
      const overrides: Override[] = data.overrides.map((o) => ({
        id: o.id,
        eventId: o.eventId,
        createdAt: o.createdAt,
        author: o.author,
        ...(o.note ? { note: o.note } : {}),
        action: o.action as Override['action'],
      }));
      try {
        const result = calculate({
          rulePack: getRulePack(body.jurisdiction),
          taxYear: body.taxYear,
          events: matched.events,
          overrides,
          ...(body.methods ? { methods: compact(body.methods) } : {}),
          ...(body.timeZone ? { timeZone: body.timeZone } : {}),
        });
        // Decimals serialize as exact strings (ADR-0008).
        const plain = JSON.parse(JSON.stringify(result)) as z.infer<typeof CalculationSchema>;
        return c.json({ ...plain, transferMatches: matched.matches }, 200);
      } catch (e) {
        if (e instanceof UnsupportedTaxYearError) {
          return c.json(errorBody('unsupported_tax_year', e.message), 422);
        }
        throw e;
      }
    },
  );

  return app;
}

const noUser = errorBody('not_found', 'No such user');

function auth(database: Database) {
  return async (c: Context<Env>, next: () => Promise<void>) => {
    const header = c.req.header('authorization') ?? '';
    const key = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
    const caller = key ? await withoutTenant(database, (tx) => authenticate(tx, key)) : null;
    if (!caller) return c.json(errorBody('unauthorized', 'Missing or invalid API key'), 401);
    c.set('caller', caller);
    await next();
  };
}

function encodeCursor(row: { occurredAt: string; id: string }): string {
  return Buffer.from(JSON.stringify([row.occurredAt, row.id])).toString('base64url');
}

function decodeCursor(cursor: string): { occurredAt: string; id: string } | undefined {
  try {
    const [occurredAt, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as [
      unknown,
      unknown,
    ];
    if (typeof occurredAt !== 'string' || typeof id !== 'string') return undefined;
    if (Number.isNaN(Date.parse(occurredAt))) return undefined;
    return { occurredAt, id };
  } catch {
    return undefined;
  }
}

/** Drops undefined keys (the engine's input types use exact optional properties). */
function compact<T extends object>(o: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as never;
}
