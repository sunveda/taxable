import { importCsv as parseCsv, decodeText, matchTransfers } from '@svdt/importers';
import type { LedgerEvent as EngineEvent } from '@svdt/domain';
import { getRulePack } from '@svdt/rule-packs';
import { calculate, type Override } from '@svdt/tax-engine';
import {
  ApiError,
  type Calculation,
  type EventRow,
  type ImportSummary,
  type LedgerEvent,
  type OverrideRow,
} from './api-types';
import type { Backend } from './backend';
import { demoEvents } from './demo-data';

/**
 * Placeholder backend: the API's behaviour (upsert by id, append-only overrides, transfer
 * matching, engine) over an in-memory store. Data lives as long as the server process.
 * Replaced by the real API when SVDT_API_URL is set.
 */
interface Store {
  events: Map<string, EventRow>;
  imports: ImportSummary[];
  overrides: OverrideRow[];
}

const g = globalThis as { __svdtDemo?: Map<string, Store> };
const stores = (g.__svdtDemo ??= new Map());

function store(userId: string): Store {
  let s = stores.get(userId);
  if (!s) {
    s = { events: new Map(), imports: [], overrides: [] };
    seed(s);
    stores.set(userId, s);
  }
  return s;
}

function seed(s: Store): void {
  const importId = 'demo-import';
  for (const e of demoEvents) {
    const account = 'accountId' in e ? e.accountId : e.fromAccountId;
    s.events.set(e.id, {
      id: e.id,
      accountName: account,
      occurredAt: new Date(e.timestamp).toISOString(),
      importerId: 'demo.sample.v1',
      event: e,
    });
  }
  s.imports.push({
    id: importId,
    accountName: 'sample',
    filename: 'sample-data',
    importerId: 'demo.sample.v1',
    stats: { rows: demoEvents.length, imported: demoEvents.length, skipped: 0 },
    warningCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
  });
}

let seq = 0;
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(++seq).toString(36)}`;

export const demoBackend: Backend = {
  mode: 'demo',

  async importCsv(userId, { account, filename, importerId, content }) {
    const s = store(userId);
    const { text, encoding } = decodeText(content);
    let parsed;
    try {
      parsed = parseCsv(text, { accountId: account, ...(importerId ? { importerId } : {}) });
    } catch (e) {
      throw new ApiError(422, 'unknown_format', e instanceof Error ? e.message : String(e));
    }
    const importId = newId('imp');
    let upserted = 0;
    const conflicts: string[] = [];
    for (const e of parsed.events) {
      const existing = s.events.get(e.id);
      if (existing && existing.accountName !== account) {
        conflicts.push(e.id);
        continue;
      }
      s.events.set(e.id, {
        id: e.id,
        accountName: account,
        occurredAt: new Date(e.timestamp).toISOString(),
        importerId: parsed.importer.id,
        event: e as LedgerEvent,
      });
      upserted++;
    }
    s.imports.unshift({
      id: importId,
      accountName: account,
      filename,
      importerId: parsed.importer.id,
      stats: parsed.stats,
      warningCount: parsed.warnings.length,
      createdAt: new Date().toISOString(),
    });
    return {
      importId,
      importer: {
        id: parsed.importer.id,
        name: parsed.importer.name,
        status: parsed.importer.format.status,
      },
      encoding,
      stats: parsed.stats,
      warnings: parsed.warnings,
      upserted,
      conflicts,
    };
  },

  async listImports(userId) {
    return store(userId).imports;
  },

  async listEvents(userId, { limit, cursor }) {
    const rows = sortedEvents(store(userId));
    const start = cursor ? Number(cursor) : 0;
    const data = rows.slice(start, start + limit);
    const next = start + limit < rows.length ? String(start + limit) : null;
    return { data, nextCursor: next };
  },

  async listOverrides(userId) {
    return store(userId).overrides;
  },

  async addOverride(userId, { eventId, action, note }) {
    const s = store(userId);
    if (!targetExists(s, eventId)) {
      throw new ApiError(422, 'unknown_event', `No event "${eventId}"`);
    }
    const row: OverrideRow = {
      id: newId('ov'),
      eventId,
      author: 'demo',
      note: note ?? null,
      action,
      createdAt: new Date().toISOString(),
    };
    s.overrides.push(row);
    return row;
  },

  async calculate(userId, req) {
    const s = store(userId);
    const ledger = sortedEvents(s).map((r) => r.event as unknown as EngineEvent);
    const matched = matchTransfers(ledger);
    const overrides: Override[] = s.overrides.map((o) => ({
      id: o.id,
      eventId: o.eventId,
      createdAt: o.createdAt,
      author: o.author,
      action: o.action,
    }));
    try {
      const result = calculate({
        rulePack: getRulePack(req.jurisdiction),
        taxYear: req.taxYear,
        events: matched.events,
        overrides,
        ...(req.methods?.default ? { methods: { default: req.methods.default } } : {}),
      });
      const plain = JSON.parse(JSON.stringify(result)) as Omit<Calculation, 'transferMatches'>;
      return { ...plain, transferMatches: matched.matches };
    } catch (e) {
      if (e instanceof Error && e.name === 'UnsupportedTaxYearError') {
        throw new ApiError(422, 'unsupported_tax_year', e.message);
      }
      throw e;
    }
  },
};

/** A stored event, or a transfer matched from two of them (same rule as the API). */
function targetExists(s: Store, eventId: string): boolean {
  if (!eventId.startsWith('transfer:')) return s.events.has(eventId);
  const rest = eventId.slice('transfer:'.length);
  for (let i = rest.indexOf('>'); i > 0; i = rest.indexOf('>', i + 1)) {
    if (s.events.has(rest.slice(0, i)) && s.events.has(rest.slice(i + 1))) return true;
  }
  return false;
}

function sortedEvents(s: Store): EventRow[] {
  return [...s.events.values()].sort(
    (a, b) => a.occurredAt.localeCompare(b.occurredAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}
