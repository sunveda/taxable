import { roundTo, type Decimal } from '@svdt/domain';
import { jp, us, type RulePack } from '@svdt/rule-packs';
import { calculate, type CalculationResult } from '@svdt/tax-engine';
import { jpEvents, usEvents, usPrices } from './demo-data';

function money(value: Decimal, pack: RulePack): string {
  const { decimalPlaces, mode } = pack.reportRounding;
  const n = roundTo(value, decimalPlaces, mode).toFixed(decimalPlaces);
  const [int = '0', frac] = n.replace('-', '').split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const symbol = pack.reportingCurrency === 'JPY' ? '¥' : '$';
  return `${n.startsWith('-') ? '−' : ''}${symbol}${grouped}${frac ? `.${frac}` : ''}`;
}

function Disposals({ result, pack }: { result: CalculationResult; pack: RulePack }) {
  const lotsById = new Map(result.lots.map((l) => [l.id, l]));
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Asset</th>
            <th>Account</th>
            <th>Sold</th>
            <th className="num">Proceeds</th>
            <th className="num">Cost basis</th>
            <th className="num">Gain</th>
            <th>Term</th>
            <th>Why this basis</th>
          </tr>
        </thead>
        <tbody>
          {result.disposals.map((d) => {
            const lot = d.lotId ? lotsById.get(d.lotId) : undefined;
            const why = d.basisShortfall
              ? 'No history for these units — basis 0'
              : lot
                ? `Lot from ${lot.origin} (${lot.eventId ?? 'opening'}) on ${lot.acquiredAt.slice(0, 10)}${lot.parentLotId ? ', moved by transfer' : ''}`
                : `${result.methods[d.asset]} average`;
            return (
              <tr key={d.id}>
                <td>
                  {d.quantity.toFixed()} {d.asset}
                </td>
                <td>{d.accountId}</td>
                <td>{d.disposedAt.slice(0, 10)}</td>
                <td className="num">{money(d.proceeds.minus(d.sellingCosts), pack)}</td>
                <td className="num">{money(d.costBasis, pack)}</td>
                <td className="num">{money(d.gain, pack)}</td>
                <td>{d.term ?? '—'}</td>
                <td className="muted">{why}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FixQueue({ result, pack }: { result: CalculationResult; pack: RulePack }) {
  if (result.issues.length === 0) return <p className="muted">Nothing to fix.</p>;
  return (
    <ol>
      {result.issues.map((i) => {
        const swing = i.impact.min.abs().greaterThan(i.impact.max.abs())
          ? i.impact.min
          : i.impact.max;
        return (
          <li key={i.id}>
            <span className="warn">
              {!i.impactKnown
                ? 'Impact unknown'
                : swing.isZero()
                  ? 'Review'
                  : `Up to ${money(swing.abs(), pack)}`}
            </span>{' '}
            — {i.message}
          </li>
        );
      })}
    </ol>
  );
}

function Report({
  title,
  pack,
  result,
}: {
  title: string;
  pack: RulePack;
  result: CalculationResult;
}) {
  const s = result.summary;
  return (
    <section>
      <h2>{title}</h2>
      <p className="muted">
        Rule pack{' '}
        <code>
          {pack.id}@{pack.version}
        </code>{' '}
        ({pack.status}) · engine <code>{result.engineVersion}</code> · tax year {result.taxYear} ·{' '}
        {result.timeZone}
      </p>
      {s.model === 'us_capital_gains' ? (
        <p>
          Short-term gain <strong>{money(s.shortTerm.gain, pack)}</strong> · Long-term gain{' '}
          <strong>{money(s.longTerm.gain, pack)}</strong> · Ordinary income{' '}
          <strong>{money(s.ordinaryIncome, pack)}</strong>
        </p>
      ) : (
        <p>
          雑所得 (miscellaneous income) <strong>{money(s.miscellaneousIncome, pack)}</strong> =
          disposals {money(s.disposals.gain, pack)} + income {money(s.incomeTotal, pack)} − expenses{' '}
          {money(s.expenses, pack)}
        </p>
      )}
      <h3>Disposals</h3>
      <Disposals result={result} pack={pack} />
      <h3>Fix queue (largest impact first)</h3>
      <FixQueue result={result} pack={pack} />
    </section>
  );
}

export default function Home() {
  const usResult = calculate({ rulePack: us, taxYear: 2025, events: usEvents, prices: usPrices });
  const jpResult = calculate({ rulePack: jp, taxYear: 2025, events: jpEvents });
  return (
    <main>
      <h1>svdt-cloud</h1>
      <p className="muted">
        The crypto tax engine you can actually check. Demo data · rule packs are drafts pending
        professional review · not tax advice.
      </p>
      <Report title="United States — 2025" pack={us} result={usResult} />
      <Report title="Japan — 2025 (総平均法)" pack={jp} result={jpResult} />
    </main>
  );
}
