import 'server-only';
import { cache } from 'react';
import type { Calculation } from './api-types';
import { getBackend } from './backend';
import { getSession, type Session } from './session';

/** One calculation per request, shared by the layout and the page. */
export const getCalculation = cache(
  async (): Promise<{ session: Session; calc: Calculation | null; error: string | null }> => {
    const session = await getSession();
    try {
      const calc = await getBackend().calculate(session.userId, {
        jurisdiction: session.jurisdiction,
        taxYear: session.taxYear,
        methods: { default: session.method },
        // Dates events (tax year, holding period) in the taxpayer's zone where the rule pack
        // uses one; the engine ignores it otherwise.
        ...(session.timeZone ? { timeZone: session.timeZone } : {}),
      });
      return { session, calc, error: null };
    } catch (e) {
      return { session, calc: null, error: e instanceof Error ? e.message : String(e) };
    }
  },
);
