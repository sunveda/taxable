import { dec } from '@svdt/domain';
import { rulePacks } from '@svdt/rule-packs';
import type { Metadata } from 'next';
import type { Calculation, Disposal, Lot } from '../../lib/api-types';
import { getCalculation } from '../../lib/data';
import { asset, date, money, qty } from '../../lib/format';
import { t, type Lang } from '../../lib/i18n';
import { YearSwitcher } from '../year-switcher';

export const metadata: Metadata = { title: 'Report' };

export default async function Report() {
  const { session, calc, error } = await getCalculation();
  const tr = t(session.lang);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{tr.report.title(session.taxYear)}</h1>
          {calc ? (
            <p className="muted small">
              {tr.report.meta(
                `${calc.rulePack.id}@${calc.rulePack.version} (${calc.rulePack.status === 'draft' ? tr.report.draft : calc.rulePack.status})`,
                calc.engineVersion,
                calc.timeZone,
              )}
            </p>
          ) : null}
        </div>
        <YearSwitcher session={session} />
      </div>
      {error || !calc ? (
        <div className="notice error">{error}</div>
      ) : (
        <>
          <ReturnFigures calc={calc} lang={session.lang} />
          <Disposals calc={calc} lang={session.lang} />
          <Income calc={calc} lang={session.lang} />
          <Holdings calc={calc} lang={session.lang} />
        </>
      )}
    </>
  );
}

function ReturnFigures({ calc, lang }: { calc: Calculation; lang: Lang }) {
  const tr = t(lang);
  const cur = calc.reportingCurrency;
  const s = calc.summary;
  return (
    <section className="card">
      <h2>{tr.report.returnFigures}</h2>
      {s.model === 'jp_miscellaneous_income' ? (
        <dl className="breakdown" style={{ maxWidth: 480 }}>
          <dt>{tr.overview.revenue}</dt>
          <dd>{money(s.reported.revenue, cur)}</dd>
          <dt>{tr.overview.expenses}</dt>
          <dd>{money(s.reported.necessaryExpenses, cur)}</dd>
          <dt className="total">{tr.overview.jpHeadline}</dt>
          <dd className="total">{money(s.reported.taxableMiscellaneousIncome, cur)}</dd>
        </dl>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Form 8949</th>
                <th className="num">{tr.report.proceeds}</th>
                <th className="num">{tr.report.costBasis}</th>
                <th className="num">{tr.report.gain}</th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ['Part I (short-term)', s.form8949Totals.partI],
                  ['Part II (long-term)', s.form8949Totals.partII],
                ] as const
              ).map(([label, p]) => (
                <tr key={label}>
                  <td>{label}</td>
                  <td className="num">{money(p.proceeds, cur)}</td>
                  <td className="num">{money(p.costBasis, cur)}</td>
                  <td className="num">{money(p.gain, cur)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Disposals({ calc, lang }: { calc: Calculation; lang: Lang }) {
  const tr = t(lang).report;
  const cur = calc.reportingCurrency;
  const lots = new Map(calc.lots.map((l) => [l.id, l]));
  const us = calc.summary.model === 'us_capital_gains';
  return (
    <section className="card">
      <h2>{tr.disposals}</h2>
      {calc.disposals.length === 0 ? (
        <p className="empty">{tr.none}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{tr.asset}</th>
                <th>{tr.account}</th>
                <th>{tr.disposedAt}</th>
                <th className="num">{tr.proceeds}</th>
                <th className="num">{tr.costBasis}</th>
                <th className="num">{tr.gain}</th>
                {us ? <th>{tr.term}</th> : null}
                <th>{tr.why}</th>
              </tr>
            </thead>
            <tbody>
              {calc.disposals.map((d) => (
                <tr key={d.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {qty(d.quantity)} {asset(d.asset)}
                  </td>
                  <td>{d.accountId}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {date(d.disposedAt, lang, calc.timeZone)}
                  </td>
                  <td className="num">{money(subtract(d.proceeds, d.sellingCosts), cur)}</td>
                  <td className="num">{money(d.costBasis, cur)}</td>
                  <td className={`num ${d.gain.startsWith('-') ? 'gain-neg' : 'gain-pos'}`}>
                    {money(d.gain, cur, { sign: true })}
                  </td>
                  {us ? (
                    <td>{d.term === 'long' ? tr.long : d.term === 'short' ? tr.short : '—'}</td>
                  ) : null}
                  <td>
                    <Explain
                      d={d}
                      lot={d.lotId ? lots.get(d.lotId) : undefined}
                      calc={calc}
                      lang={lang}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Provenance drill-down (ADR-0012): the basis source, the source event, and rule citations. */
function Explain({
  d,
  lot,
  calc,
  lang,
}: {
  d: Disposal;
  lot: Lot | undefined;
  calc: Calculation;
  lang: Lang;
}) {
  const tr = t(lang).report;
  const pack = rulePacks[calc.rulePack.id];
  const basis = d.basisShortfall
    ? tr.shortfall
    : lot
      ? tr.lotFrom(tr.origins[lot.origin] ?? lot.origin, date(lot.acquiredAt, lang, calc.timeZone))
      : tr.averageCost(t(lang).method[calc.methods[d.asset] ?? 'TOTAL_AVERAGE']);
  return (
    <details className="explain">
      <summary>{basis}</summary>
      <ul>
        <li>
          <code>{d.eventId}</code>
        </li>
        {lot?.eventId && lot.eventId !== d.eventId ? (
          <li>
            ← <code>{lot.eventId}</code>
          </li>
        ) : null}
        {d.ruleRefs.map((r) => {
          const rule = pack.rules[r];
          return (
            <li key={r}>
              {rule ? (
                <>
                  {rule.summary}{' '}
                  {rule.url ? (
                    <a href={rule.url} target="_blank" rel="noreferrer">
                      {rule.source}
                    </a>
                  ) : (
                    rule.source
                  )}
                </>
              ) : (
                <code>{r}</code>
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

function Income({ calc, lang }: { calc: Calculation; lang: Lang }) {
  const tr = t(lang).report;
  const cur = calc.reportingCurrency;
  return (
    <section className="card">
      <h2>{tr.income}</h2>
      {calc.income.length === 0 ? (
        <p className="empty">{tr.none}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{tr.asset}</th>
                <th>{tr.account}</th>
                <th>{tr.receivedAt}</th>
                <th className="num">{tr.value}</th>
                <th>{tr.taxable}</th>
              </tr>
            </thead>
            <tbody>
              {calc.income.map((i) => (
                <tr key={i.id}>
                  <td>
                    {qty(i.quantity)} {asset(i.asset)} <span className="badge">{i.incomeType}</span>
                  </td>
                  <td>{i.accountId}</td>
                  <td>{date(i.receivedAt, lang, calc.timeZone)}</td>
                  <td className="num">{money(i.value, cur)}</td>
                  <td>{i.taxable ? '✓' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Holdings({ calc, lang }: { calc: Calculation; lang: Lang }) {
  const tr = t(lang).report;
  const cur = calc.reportingCurrency;
  return (
    <section className="card">
      <h2>{tr.holdings}</h2>
      {calc.holdings.length === 0 ? (
        <p className="empty">{tr.none}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{tr.asset}</th>
                <th>{tr.account}</th>
                <th className="num">{tr.quantity}</th>
                <th className="num">{tr.costBasis}</th>
              </tr>
            </thead>
            <tbody>
              {calc.holdings.map((h) => (
                <tr key={`${h.asset}:${h.accountId ?? '*'}`}>
                  <td>{asset(h.asset)}</td>
                  <td>{h.accountId ?? '—'}</td>
                  <td className="num">{qty(h.quantity)}</td>
                  <td className="num">{money(h.costBasis, cur)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function subtract(a: string, b: string): string {
  // Exact: both are decimal strings from the API.
  return dec(a).minus(dec(b)).toFixed();
}
