import Link from 'next/link';
import type { Calculation } from '../lib/api-types';
import { getBackend } from '../lib/backend';
import { getCalculation } from '../lib/data';
import { isZero, money, sumDecimals, swing } from '../lib/format';
import { t, type Lang } from '../lib/i18n';
import { IssueList } from './issues';
import { YearSwitcher } from './year-switcher';

export default async function Overview() {
  const { session, calc, error } = await getCalculation();
  const tr = t(session.lang);
  const imports = await getBackend()
    .listImports(session.userId)
    .catch(() => []);
  const events = imports.reduce((n, i) => n + i.stats.imported, 0);
  // Accounts that hold or held something, as the engine saw them.
  const accounts = new Set([
    ...(calc?.lots.map((l) => l.accountId) ?? []),
    ...(calc?.disposals.map((d) => d.accountId) ?? []),
  ]).size;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{tr.overview.title(session.taxYear)}</h1>
          <p className="muted">
            {tr.jurisdiction[session.jurisdiction]} · {tr.method[session.method]}
          </p>
        </div>
        <YearSwitcher session={session} />
      </div>

      {error || !calc ? (
        <div className="notice error">{error}</div>
      ) : (
        <>
          <Headline calc={calc} lang={session.lang} />
          <div className="grid">
            <Uncertainty calc={calc} lang={session.lang} />
            <div className="card">
              <div className="stat-label">{tr.overview.data}</div>
              {events === 0 ? (
                <p className="muted small">{tr.overview.noData}</p>
              ) : (
                <div className="stat-value">{tr.overview.events(events)}</div>
              )}
              <p className="muted small">{tr.overview.accounts(accounts)}</p>
              <Link href="/import" className="button secondary">
                {tr.overview.importMore}
              </Link>
            </div>
          </div>
          <section className="card">
            <div className="page-head" style={{ marginBottom: 8 }}>
              <h2 style={{ margin: 0 }}>{tr.overview.topFixes}</h2>
              {calc.issues.length > 3 ? <Link href="/fixes">{tr.overview.seeAll} →</Link> : null}
            </div>
            <IssueList
              issues={calc.issues}
              currency={calc.reportingCurrency}
              lang={session.lang}
              limit={3}
            />
          </section>
        </>
      )}
    </>
  );
}

function Headline({ calc, lang }: { calc: Calculation; lang: Lang }) {
  const tr = t(lang);
  const cur = calc.reportingCurrency;
  const s = calc.summary;
  if (s.model === 'jp_miscellaneous_income') {
    const negative = s.reported.miscellaneousIncome.startsWith('-');
    return (
      <div className="card">
        <div className="stat-label">{tr.overview.jpHeadline}</div>
        <div className="stat-value hero">{money(s.reported.miscellaneousIncome, cur)}</div>
        <dl className="breakdown" style={{ maxWidth: 480 }}>
          <dt>{tr.overview.revenue}</dt>
          <dd>{money(s.reported.revenue, cur)}</dd>
          <dt>{tr.overview.expenses}</dt>
          <dd>−{money(s.reported.necessaryExpenses, cur)}</dd>
          <dt className="total">{tr.overview.jpHeadline}</dt>
          <dd className="total">{money(s.reported.miscellaneousIncome, cur)}</dd>
        </dl>
        <dl className="breakdown small" style={{ maxWidth: 480 }}>
          <dt>{tr.overview.disposals}</dt>
          <dd>{money(s.disposals.gain, cur, { sign: true })}</dd>
          <dt>{tr.overview.income}</dt>
          <dd>{money(s.incomeTotal, cur, { sign: true })}</dd>
          <dt>{tr.overview.feeExpenses}</dt>
          <dd>{isZero(s.expenses) ? money('0', cur) : `−${money(s.expenses, cur)}`}</dd>
        </dl>
        {negative ? (
          <p className="notice warn small" style={{ marginTop: 12 }}>
            {tr.overview.lossNote}
          </p>
        ) : null}
      </div>
    );
  }
  return (
    <div className="grid">
      <div className="card">
        <div className="stat-label">{tr.overview.usShort}</div>
        <div className="stat-value">{money(s.form8949Totals.partI.gain, cur)}</div>
      </div>
      <div className="card">
        <div className="stat-label">{tr.overview.usLong}</div>
        <div className="stat-value">{money(s.form8949Totals.partII.gain, cur)}</div>
      </div>
      <div className="card">
        <div className="stat-label">{tr.overview.usIncome}</div>
        <div className="stat-value">{money(s.reportedOrdinaryIncome, cur)}</div>
      </div>
    </div>
  );
}

function Uncertainty({ calc, lang }: { calc: Calculation; lang: Lang }) {
  const tr = t(lang);
  const known = calc.issues.filter((i) => i.impactKnown).map((i) => swing(i.impact));
  const unknown = calc.issues.filter((i) => !i.impactKnown).length;
  const total = sumDecimals(known);
  return (
    <div className="card">
      <div className="stat-label">{tr.overview.uncertainty}</div>
      {calc.issues.length === 0 ? (
        <>
          <div className="stat-value">±{money('0', calc.reportingCurrency)}</div>
          <span className="badge good">{tr.overview.allClear}</span>
        </>
      ) : (
        <>
          <div className="stat-value">±{money(total, calc.reportingCurrency)}</div>
          {unknown ? <span className="badge warn">{tr.overview.unknownCount(unknown)}</span> : null}
          <p style={{ marginTop: 12 }}>
            <Link href="/fixes">
              {tr.nav.fixes} ({calc.issues.length}) →
            </Link>
          </p>
        </>
      )}
    </div>
  );
}
