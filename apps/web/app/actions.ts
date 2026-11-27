'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { ApiError, type ImportResult, type OverrideAction } from '../lib/api-types';
import { getBackend } from '../lib/backend';
import { getSession, isTimeZone, METHODS, taxYears } from '../lib/session';

/**
 * Server Functions. Each re-reads the session itself: they are reachable by direct POST,
 * so nothing from the form is trusted for identity. (Placeholder identity until session
 * auth exists; see lib/session.ts.)
 */

const YEAR = 60 * 60 * 24 * 365;
// Matches the API limit (apps/api/src/app.ts): hosting platforms cap request bodies near 4.5 MB.
const MAX_BYTES = 4 * 1024 * 1024;
const ACCOUNT = /^[A-Za-z0-9._-]{1,64}$/;
const DECIMAL = /^\d+(\.\d+)?$/;

export async function saveSettings(form: FormData): Promise<void> {
  const c = await cookies();
  const set = (name: string, value: string) =>
    c.set(name, value, { maxAge: YEAR, sameSite: 'lax', path: '/' });
  const lang = form.get('lang');
  if (lang === 'ja' || lang === 'en') set('svdt_lang', lang);
  const j = form.get('jurisdiction');
  if (j === 'jp' || j === 'us') {
    set('svdt_jurisdiction', j);
    const year = Number(form.get('taxYear'));
    if (taxYears(j).includes(year)) set('svdt_year', String(year));
    const method = String(form.get('method') ?? '');
    if ((METHODS[j] as readonly string[]).includes(method)) set('svdt_method', method);
    else c.delete('svdt_method');
  }
  // Only sent when the form shows the field (rule packs that use the user's zone).
  const tz = form.get('timeZone');
  if (typeof tz === 'string') {
    const zone = tz.trim();
    if (zone === '') c.delete('svdt_tz');
    else if (isTimeZone(zone)) set('svdt_tz', zone);
  }
  revalidatePath('/', 'layout');
}

export async function setLanguage(form: FormData): Promise<void> {
  const lang = form.get('lang');
  if (lang !== 'ja' && lang !== 'en') return;
  (await cookies()).set('svdt_lang', lang, { maxAge: YEAR, sameSite: 'lax', path: '/' });
  revalidatePath('/', 'layout');
}

export async function setTaxYear(form: FormData): Promise<void> {
  const session = await getSession();
  const year = Number(form.get('taxYear'));
  if (!taxYears(session.jurisdiction).includes(year)) return;
  (await cookies()).set('svdt_year', String(year), { maxAge: YEAR, sameSite: 'lax', path: '/' });
  revalidatePath('/', 'layout');
}

export type ImportState =
  | { status: 'idle' }
  | {
      status: 'error';
      error: 'noFile' | 'badAccount' | 'tooLarge' | 'unknownFormat' | 'generic';
      detail?: string;
    }
  | { status: 'done'; result: ImportResult };

export async function importFile(_prev: ImportState, form: FormData): Promise<ImportState> {
  const session = await getSession();
  const file = form.get('file');
  const account = String(form.get('account') ?? '').trim();
  const importerId = String(form.get('importerId') ?? '');
  if (!(file instanceof File) || file.size === 0) return { status: 'error', error: 'noFile' };
  if (!ACCOUNT.test(account)) return { status: 'error', error: 'badAccount' };
  if (file.size > MAX_BYTES) return { status: 'error', error: 'tooLarge' };
  try {
    const result = await getBackend().importCsv(session.userId, {
      account,
      filename: file.name || null,
      ...(importerId ? { importerId } : {}),
      content: new Uint8Array(await file.arrayBuffer()),
    });
    revalidatePath('/', 'layout');
    return { status: 'done', result };
  } catch (e) {
    if (e instanceof ApiError && e.code === 'unknown_format') {
      return { status: 'error', error: 'unknownFormat' };
    }
    if (e instanceof ApiError && e.status === 413) return { status: 'error', error: 'tooLarge' };
    return { status: 'error', error: 'generic', detail: e instanceof Error ? e.message : '' };
  }
}

/** Applies a suggested resolution or a correction typed in the fix queue. */
export async function addOverride(form: FormData): Promise<void> {
  const session = await getSession();
  const eventId = String(form.get('eventId') ?? '');
  // The zone calendar dates are read in: the rule pack's (Japan) or the user's (US).
  const zone =
    session.jurisdiction === 'jp' ? 'Asia/Tokyo' : (session.timeZone ?? 'America/New_York');
  const action = parseAction(form, session.jurisdiction, zone);
  if (!eventId || !action) return;
  await getBackend().addOverride(session.userId, { eventId, action });
  revalidatePath('/', 'layout');
}

/** `YYYY-MM-DD` of an instant in a time zone. */
function localDay(instant: string, zone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(instant));
}

function parseAction(
  form: FormData,
  jurisdiction: 'jp' | 'us',
  zone: string,
): OverrideAction | null {
  const type = form.get('type');
  const num = (name: string): string | undefined => {
    const v = String(form.get(name) ?? '')
      .replace(/[,¥$\s]/g, '')
      .trim();
    return v === '' ? undefined : v;
  };
  switch (type) {
    case 'set_unit_price': {
      const asset = String(form.get('asset') ?? '');
      const unitPrice = num('unitPrice');
      return asset && unitPrice && DECIMAL.test(unitPrice) ? { type, asset, unitPrice } : null;
    }
    case 'set_cost_basis': {
      const costBasis = num('costBasis');
      if (!costBasis || !DECIMAL.test(costBasis)) return null;
      const day = String(form.get('acquiredAt') ?? '');
      // A calendar date: midnight in Japan; noon UTC for the US, which is that same date in
      // every US time zone.
      const time = jurisdiction === 'jp' ? 'T00:00:00+09:00' : 'T12:00:00Z';
      let acquiredAt = /^\d{4}-\d\d-\d\d$/.test(day) ? `${day}${time}` : undefined;
      // Bought on the day the coins arrived: noon UTC can fall after the arrival itself,
      // which the engine rejects (acquired_after_receipt), so use the arrival instant.
      // The engine still checks the date against the real event.
      const receivedAt = String(form.get('receivedAt') ?? '');
      if (
        acquiredAt &&
        !Number.isNaN(Date.parse(receivedAt)) &&
        Date.parse(acquiredAt) > Date.parse(receivedAt) &&
        localDay(receivedAt, zone) === day
      ) {
        acquiredAt = receivedAt;
      }
      return { type, costBasis, ...(acquiredAt ? { acquiredAt } : {}) };
    }
    case 'classify_withdrawal': {
      const as = form.get('as');
      if (as !== 'own_wallet' && as !== 'spent') return null;
      const proceeds = num('proceeds');
      if (proceeds !== undefined && (!DECIMAL.test(proceeds) || as !== 'spent')) return null;
      return { type, as, ...(proceeds ? { proceeds } : {}) };
    }
    case 'revoke': {
      const overrideId = String(form.get('overrideId') ?? '');
      return overrideId ? { type, overrideId } : null;
    }
    default:
      return null;
  }
}
