import { rulePacks } from '@svdt/rule-packs';
import type { Metadata } from 'next';
import { getBackend } from '../../lib/backend';
import { t } from '../../lib/i18n';
import { getSession, METHODS, taxYears } from '../../lib/session';
import { saveSettings } from '../actions';
import { SubmitButton } from '../submit-button';

export const metadata: Metadata = { title: 'Settings' };

export default async function Settings() {
  const session = await getSession();
  const tr = t(session.lang);
  return (
    <>
      <div className="page-head">
        <h1>{tr.settings.title}</h1>
      </div>
      <section className="card">
        <form action={saveSettings} className="stack">
          <label>
            {tr.settings.jurisdiction}
            <select name="jurisdiction" defaultValue={session.jurisdiction}>
              {(['jp', 'us'] as const).map((j) => (
                <option key={j} value={j}>
                  {tr.jurisdiction[j]}
                </option>
              ))}
            </select>
          </label>
          <label>
            {tr.settings.taxYear}
            <select name="taxYear" defaultValue={session.taxYear}>
              {taxYears(session.jurisdiction).map((y) => (
                <option key={y} value={y}>
                  {tr.yearLabel(y)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {tr.settings.method}
            <select name="method" defaultValue={session.method}>
              {METHODS[session.jurisdiction].map((m) => (
                <option key={m} value={m}>
                  {tr.method[m]}
                </option>
              ))}
            </select>
            {session.jurisdiction === 'jp' ? (
              <span className="hint">{tr.settings.methodNote}</span>
            ) : null}
          </label>
          {rulePacks[session.jurisdiction].timeZoneFromUser ? (
            <label>
              {tr.settings.timeZone}
              <input
                name="timeZone"
                list="time-zones"
                defaultValue={session.timeZone ?? ''}
                placeholder={rulePacks[session.jurisdiction].defaultTimeZone}
                autoComplete="off"
              />
              <datalist id="time-zones">
                {Intl.supportedValuesOf('timeZone').map((z) => (
                  <option key={z} value={z} />
                ))}
              </datalist>
              <span className="hint">
                {tr.settings.timeZoneNote(rulePacks[session.jurisdiction].defaultTimeZone)}
              </span>
            </label>
          ) : null}
          <label>
            {tr.settings.language}
            <select name="lang" defaultValue={session.lang}>
              <option value="ja">日本語</option>
              <option value="en">English</option>
            </select>
          </label>
          <div>
            <SubmitButton>{tr.settings.save}</SubmitButton>
          </div>
        </form>
      </section>
      <section className="card">
        <div className="stat-label">{tr.settings.backend}</div>
        <p>{getBackend().mode === 'demo' ? tr.settings.backendDemo : tr.settings.backendApi}</p>
      </section>
    </>
  );
}
