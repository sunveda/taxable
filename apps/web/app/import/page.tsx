import { csvImporters } from '@svdt/importers';
import type { Metadata } from 'next';
import { getBackend } from '../../lib/backend';
import { dateTime } from '../../lib/format';
import { t } from '../../lib/i18n';
import { getSession } from '../../lib/session';
import { ImportForm } from './import-form';

export const metadata: Metadata = { title: 'Import' };

export default async function ImportPage() {
  const session = await getSession();
  const tr = t(session.lang).importPage;
  const imports = await getBackend()
    .listImports(session.userId)
    .catch(() => []);
  // Formats for this country's users first.
  const formats = [...csvImporters]
    .sort(
      (a, b) =>
        Number(b.markets.includes(session.jurisdiction)) -
        Number(a.markets.includes(session.jurisdiction)),
    )
    .map((i) => ({ id: i.id, name: i.name, verified: i.format.status === 'verified' }));
  const tz = session.jurisdiction === 'jp' ? 'Asia/Tokyo' : 'America/New_York';

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{tr.title}</h1>
          <p className="muted">{tr.intro}</p>
        </div>
      </div>
      <section className="card">
        <ImportForm
          lang={session.lang}
          formats={formats}
          accounts={[...new Set(imports.map((i) => i.accountName))]}
        />
      </section>
      <section className="card">
        <h2>{tr.history}</h2>
        {imports.length === 0 ? (
          <p className="empty">{tr.noHistory}</p>
        ) : (
          <div className="table-wrap">
            <table>
              <tbody>
                {imports.map((i) => (
                  <tr key={i.id}>
                    <td>{dateTime(i.createdAt, session.lang, tz)}</td>
                    <td>
                      <strong>{i.accountName}</strong>
                      <div className="small muted">{i.filename ?? '—'}</div>
                    </td>
                    <td>
                      <code>{i.importerId}</code>
                    </td>
                    <td className="num">{tr.imported(i.stats.imported)}</td>
                    <td className="num">
                      {i.warningCount ? <span className="badge warn">{i.warningCount}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
