import 'server-only';
import { rulePacks } from '@svdt/rule-packs';
import { cookies } from 'next/headers';
import type { Jurisdiction, Method } from './api-types';
import type { Lang } from './i18n';

/**
 * Who is using the app and with which settings. Placeholder until session auth exists
 * (ADR-0011 App API): the app acts as one configured user (`SVDT_USER_ID`, or the demo
 * user), and preferences live in cookies.
 */
export interface Session {
  userId: string;
  lang: Lang;
  jurisdiction: Jurisdiction;
  taxYear: number;
  method: Method;
  /**
   * The taxpayer's IANA time zone, for rule packs that date events in the user's zone (US).
   * `null` means the rule pack's default (America/New_York for the US; Japan always uses
   * Asia/Tokyo).
   */
  timeZone: string | null;
}

/** True when the runtime knows `tz` as an IANA time zone. */
export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * The API user the app acts as. With a real API configured it must be set: the demo id
 * isn't a UUID, so every API call would fail with a 400.
 */
function configuredUserId(): string {
  const id = process.env['SVDT_USER_ID'];
  if (id) return id;
  if (process.env['SVDT_API_URL'] && process.env['SVDT_API_KEY']) {
    throw new Error('SVDT_USER_ID must be set when SVDT_API_URL and SVDT_API_KEY are set.');
  }
  return 'demo';
}

export const METHODS: Record<Jurisdiction, readonly Method[]> = {
  jp: ['TOTAL_AVERAGE', 'MOVING_AVERAGE'],
  us: ['FIFO', 'HIFO', 'LIFO'],
};

/** Tax years offered: the last five the rule pack supports, up to this year. */
export function taxYears(j: Jurisdiction, now = new Date()): number[] {
  const { from, to } = rulePacks[j].supportedYears;
  const last = Math.min(to, now.getUTCFullYear());
  const years: number[] = [];
  for (let y = last; y >= Math.max(from, last - 4); y--) years.push(y);
  return years;
}

export async function getSession(): Promise<Session> {
  const c = await cookies();
  const lang: Lang = c.get('svdt_lang')?.value === 'en' ? 'en' : 'ja';
  // Japan is the first launch market.
  const jurisdiction: Jurisdiction = c.get('svdt_jurisdiction')?.value === 'us' ? 'us' : 'jp';
  const years = taxYears(jurisdiction);
  const year = Number(c.get('svdt_year')?.value);
  const method = c.get('svdt_method')?.value as Method | undefined;
  const tz = c.get('svdt_tz')?.value;
  return {
    userId: configuredUserId(),
    timeZone: tz && isTimeZone(tz) ? tz : null,
    lang,
    jurisdiction,
    taxYear: years.includes(year) ? year : years[0]!,
    method: method && METHODS[jurisdiction].includes(method) ? method : METHODS[jurisdiction][0]!,
  };
}
