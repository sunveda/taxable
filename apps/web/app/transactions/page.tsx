import type { Metadata } from 'next';
import Link from 'next/link';
import type { AssetAmount, EventRow } from '../../lib/api-types';
import { getBackend } from '../../lib/backend';
import { asset, dateTime, qty } from '../../lib/format';
import { t, type Lang } from '../../lib/i18n';
import { getSession } from '../../lib/session';

export const metadata: Metadata = { title: 'Transactions' };

const PAGE = 100;

export default async function Transactions({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  const session = await getSession();
  const tr = t(session.lang).tx;
  const { cursor } = await searchParams;
  const page = await getBackend().listEvents(session.userId, {
    limit: PAGE,
    ...(cursor ? { cursor } : {}),
  });
  const tz = session.jurisdiction === 'jp' ? 'Asia/Tokyo' : 'America/New_York';

  return (
    <>
      <div className="page-head">
        <h1>{tr.title}</h1>
      </div>
      <section className="card">
        {page.data.length === 0 ? (
          <p className="empty">{tr.empty}</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{tr.date}</th>
                  <th>{tr.account}</th>
                  <th>{tr.type}</th>
                  <th>{tr.detail}</th>
                  <th>{tr.source}</th>
                </tr>
              </thead>
              <tbody>
                {page.data.map((r) => (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {dateTime(r.occurredAt, session.lang, tz)}
                    </td>
                    <td>{r.accountName}</td>
                    <td>
                      <span className="badge">{kindLabel(r, session.lang)}</span>
                    </td>
                    <td>{describe(r, session.lang)}</td>
                    <td>
                      <code>{r.id}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {page.nextCursor ? (
          <p style={{ marginTop: 16 }}>
            <Link
              href={`/transactions?cursor=${encodeURIComponent(page.nextCursor)}`}
              className="button secondary"
            >
              {tr.more}
            </Link>
          </p>
        ) : null}
      </section>
    </>
  );
}

function kindLabel(r: EventRow, lang: Lang): string {
  const k = t(lang).tx.kinds;
  const e = r.event;
  if (e.kind === 'trade') {
    if (e.sent.asset.startsWith('fiat:')) return k.buy;
    if (e.received.asset.startsWith('fiat:')) return k.sell;
    return k.swap;
  }
  return k[e.kind];
}

const amt = (a: AssetAmount) => `${qty(a.quantity)} ${asset(a.asset)}`;

function describe(r: EventRow, lang: Lang): string {
  const tr = t(lang).tx;
  const e = r.event;
  const fee = 'fee' in e && e.fee && e.kind !== 'fee' ? ` (${tr.fee} ${amt(e.fee)})` : '';
  switch (e.kind) {
    case 'trade':
      return `${amt(e.sent)} → ${amt(e.received)}${fee}`;
    case 'transfer':
      return `${qty(e.quantity)} ${asset(e.asset)}: ${e.fromAccountId} → ${e.toAccountId}${fee}`;
    case 'income':
      return `+${amt(e.received)}`;
    case 'fee':
      return `−${amt(e.fee)}`;
    case 'external_deposit':
      return `+${amt(e.received)}`;
    case 'external_withdrawal':
      return `−${amt(e.sent)}`;
  }
}
