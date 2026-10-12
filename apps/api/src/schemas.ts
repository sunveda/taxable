import { z } from '@hono/zod-openapi';

/** Request/response schemas. The OpenAPI 3.1 document is generated from these (ADR-0011). */

const decimal = z
  .string()
  .regex(/^\d+(\.\d+)?$/, 'a non-negative decimal string, e.g. "1234.56"')
  .openapi({ example: '1234.56' });
const instant = z.iso.datetime({ offset: true }).openapi({ example: '2025-03-01T12:00:00Z' });

export const OkSchema = z.object({ ok: z.literal(true) }).openapi('Ok');

export const ErrorSchema = z
  .object({
    error: z.object({
      code: z.string().openapi({ example: 'not_found' }),
      message: z.string(),
    }),
  })
  .openapi('Error');

export const UserIdParams = z.object({
  userId: z.uuid().openapi({ param: { name: 'userId', in: 'path' } }),
});

export const UserSchema = z
  .object({
    id: z.uuid(),
    externalRef: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi('User');

export const CreateUserBody = z
  .object({
    externalRef: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .openapi({ description: "The partner's own id for this user." }),
  })
  .openapi('CreateUser');

export const ImportQuery = z.object({
  account: z
    .string()
    .regex(/^[A-Za-z0-9._-]{1,64}$/)
    .openapi({
      param: { name: 'account', in: 'query' },
      description: "The user's name for the account the file came from, e.g. `coinbase`.",
      example: 'coinbase',
    }),
  importerId: z
    .string()
    .optional()
    .openapi({ param: { name: 'importerId', in: 'query' }, description: 'Skip format detection.' }),
  filename: z
    .string()
    .max(255)
    .optional()
    .openapi({ param: { name: 'filename', in: 'query' } }),
});

const WarningSchema = z.object({
  line: z.number().int().nullable(),
  code: z.string(),
  message: z.string(),
});

export const ImportSchema = z
  .object({
    importId: z.uuid(),
    sha256: z.string(),
    importer: z.object({
      id: z.string(),
      name: z.string(),
      status: z.enum(['verified', 'unverified']),
    }),
    encoding: z.string(),
    stats: z.object({ rows: z.number(), imported: z.number(), skipped: z.number() }),
    warnings: z.array(WarningSchema),
    upserted: z.number().int(),
    conflicts: z
      .array(z.string())
      .openapi({ description: 'Event ids already used by another account; not written.' }),
  })
  .openapi('Import');

export const EventsQuery = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(1000)
    .default(100)
    .openapi({ param: { name: 'limit', in: 'query' } }),
  cursor: z
    .string()
    .optional()
    .openapi({ param: { name: 'cursor', in: 'query' } }),
});

export const EventPageSchema = z
  .object({
    data: z.array(
      z.object({
        id: z.string(),
        accountName: z.string(),
        occurredAt: z.string(),
        importerId: z.string(),
        event: z.record(z.string(), z.unknown()).openapi({ description: 'A LedgerEvent.' }),
      }),
    ),
    nextCursor: z.string().nullable(),
  })
  .openapi('EventPage');

/** Mirrors `OverrideAction` in @svdt/tax-engine. */
export const OverrideActionSchema = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('set_unit_price'), asset: z.string().min(1), unitPrice: decimal }),
    z.object({
      type: z.literal('set_cost_basis'),
      costBasis: decimal,
      acquiredAt: instant.optional(),
    }),
    z.object({
      type: z.literal('classify_withdrawal'),
      as: z.enum(['own_wallet', 'spent']),
      proceeds: decimal.optional(),
    }),
    z.object({ type: z.literal('revoke'), overrideId: z.uuid() }),
  ])
  .openapi('OverrideAction');

export const CreateOverrideBody = z
  .object({
    eventId: z.string().min(1),
    action: OverrideActionSchema,
    note: z.string().max(2000).optional(),
  })
  .openapi('CreateOverride');

export const OverrideSchema = z
  .object({
    id: z.uuid(),
    eventId: z.string(),
    author: z.string(),
    note: z.string().nullable(),
    action: OverrideActionSchema,
    createdAt: z.string(),
  })
  .openapi('Override');

export const OverrideListSchema = z.object({ data: z.array(OverrideSchema) });

const methodEnum = z.enum(['FIFO', 'LIFO', 'HIFO', 'MOVING_AVERAGE', 'TOTAL_AVERAGE']);

export const CalculateBody = z
  .object({
    jurisdiction: z.enum(['us', 'jp']),
    taxYear: z.number().int().min(2009).max(2100),
    methods: z
      .object({
        default: methodEnum.optional(),
        byAsset: z.record(z.string(), methodEnum).optional(),
      })
      .optional(),
    timeZone: z.string().optional().openapi({ example: 'America/New_York' }),
  })
  .openapi('CalculateRequest');

const json = z.record(z.string(), z.unknown());

/**
 * The engine's CalculationResult with decimals as strings. Nested records are left open
 * here; `packages/api-client` will tighten them when it is generated.
 */
export const CalculationSchema = z
  .object({
    engineVersion: z.string(),
    rulePack: z.object({ id: z.string(), version: z.string(), status: z.string() }),
    taxYear: z.number().int(),
    reportingCurrency: z.string(),
    timeZone: z.string(),
    methods: z.record(z.string(), z.string()),
    disposals: z.array(json),
    income: z.array(json),
    expenses: z.array(json),
    lots: z.array(json),
    holdings: z.array(json),
    issues: z.array(
      z.object({
        id: z.string(),
        kind: z.string(),
        eventIds: z.array(z.string()),
        asset: z.string().nullable(),
        taxYear: z.number().int(),
        impact: z.object({ min: z.string(), max: z.string() }),
        impactKnown: z.boolean(),
        message: z.string(),
        params: z.record(z.string(), z.string()),
        suggestedResolution: json.optional(),
      }),
    ),
    overrides: z.array(
      z.object({
        overrideId: z.string(),
        eventId: z.string(),
        status: z.string(),
        reason: z.string().optional(),
      }),
    ),
    transferMatches: z.array(
      z.object({ withdrawalId: z.string(), depositId: z.string(), transferId: z.string() }),
    ),
    summary: json,
  })
  .openapi('Calculation');
