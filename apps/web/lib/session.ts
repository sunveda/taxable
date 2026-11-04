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
  return {
    userId: process.env['SVDT_USER_ID'] ?? 'demo',
    lang,
    jurisdiction,
    taxYear: years.includes(year) ? year : years[0]!,
    method: method && METHODS[jurisdiction].includes(method) ? method : METHODS[jurisdiction][0]!,
  };
}
