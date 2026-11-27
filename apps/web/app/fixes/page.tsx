import type { Metadata } from 'next';
import { getBackend } from '../../lib/backend';
import { getCalculation } from '../../lib/data';
import { dateTime } from '../../lib/format';
import { t } from '../../lib/i18n';
import { addOverride } from '../actions';
import { IssueList } from '../issues';
import { SubmitButton } from '../submit-button';
import { YearSwitcher } from '../year-switcher';

export const metadata: Metadata = { title: 'Fix queue' };

export default async function Fixes() {
  const { session, calc, error } = await getCalculation();
  const tr = t(session.lang);
  const overrides = await getBackend()
    .listOverrides(session.userId)
    .catch(() => []);
  const status = new Map(calc?.overrides.map((o) => [o.overrideId, o]) ?? []);
  const revoked = new Set(
    overrides.flatMap((o) => (o.action.type === 'revoke' ? [o.action.overrideId] : [])),
  );
  const tz = session.jurisdiction === 'jp' ? 'Asia/Tokyo' : 'America/New_York';

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{tr.fixes.title}</h1>
          <p className="muted">{tr.fixes.intro}</p>
        </div>
        <YearSwitcher session={session} />
      </div>
      <section className="card">
        {error || !calc ? (
          <div className="notice error">{error}</div>
        ) : (
          <IssueList issues={calc.issues} currency={calc.reportingCurrency} lang={session.lang} />
        )}
      </section>

      <section className="card">
        <h2>{tr.fixes.resolved}</h2>
        {overrides.length === 0 ? (
          <p className="empty">{tr.fixes.noOverrides}</p>
        ) : (
          <div className="table-wrap">
            <table>
              <tbody>
                {[...overrides].reverse().map((o) => {
                  const s = status.get(o.id);
                  const label = s ? (tr.fixes.status[s.status] ?? s.status) : '—';
                  const canUndo =
                    o.action.type !== 'revoke' && s?.status === 'applied' && !revoked.has(o.id);
                  return (
                    <tr key={o.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {dateTime(o.createdAt, session.lang, tz)}
                      </td>
                      <td>
                        {tr.fixes.action(o.action, calc?.reportingCurrency ?? '')}
                        <div className="small muted">
                          <code>{o.eventId}</code>
                        </div>
                      </td>
                      <td>
                        <span className={`badge ${s?.status === 'applied' ? 'good' : ''}`}>
                          {label}
                        </span>
                      </td>
                      <td className="num">
                        {canUndo ? (
                          <form action={addOverride}>
                            <input type="hidden" name="eventId" value={o.eventId} />
                            <input type="hidden" name="type" value="revoke" />
                            <input type="hidden" name="overrideId" value={o.id} />
                            <SubmitButton secondary>{tr.fixes.undo}</SubmitButton>
                          </form>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
