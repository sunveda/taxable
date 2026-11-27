'use client';

import { useActionState } from 'react';
import { importFile, type ImportState } from '../actions';
import { t, type Lang } from '../../lib/i18n';
import { SubmitButton } from '../submit-button';

export function ImportForm({
  lang,
  formats,
  accounts,
}: {
  lang: Lang;
  formats: { id: string; name: string; verified: boolean }[];
  accounts: string[];
}) {
  const tr = t(lang).importPage;
  const [state, action] = useActionState<ImportState, FormData>(importFile, { status: 'idle' });
  return (
    <>
      <form action={action} className="stack">
        <label>
          {tr.file}
          <input type="file" name="file" accept=".csv,text/csv" required />
        </label>
        <label>
          {tr.account} <span className="hint">{tr.accountHint}</span>
          <input
            name="account"
            required
            pattern="[A-Za-z0-9._\-]{1,64}"
            list="accounts"
            autoComplete="off"
          />
          <datalist id="accounts">
            {accounts.map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>
        </label>
        <label>
          {tr.format}
          <select name="importerId" defaultValue="">
            <option value="">{tr.auto}</option>
            {formats.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
                {f.verified ? '' : ` (${tr.unverified})`}
              </option>
            ))}
          </select>
        </label>
        <div>
          <SubmitButton pendingLabel={tr.submitting}>{tr.submit}</SubmitButton>
        </div>
      </form>

      {state.status === 'error' ? (
        <p className="notice error" role="alert" style={{ marginTop: 16 }}>
          {tr.errors[state.error]}
          {state.detail ? <span className="small"> ({state.detail})</span> : null}
        </p>
      ) : null}

      {state.status === 'done' ? (
        <div style={{ marginTop: 20 }} role="status">
          <h2>{tr.result}</h2>
          <p>
            <strong>{state.result.importer.name}</strong>{' '}
            {state.result.importer.status === 'verified' ? null : (
              <span className="badge warn">{tr.unverified}</span>
            )}
          </p>
          <p className="row">
            <span className="badge">{tr.rows(state.result.stats.rows)}</span>
            <span className="badge good">{tr.imported(state.result.stats.imported)}</span>
            <span className="badge">{tr.skipped(state.result.stats.skipped)}</span>
          </p>
          {state.result.importer.status === 'unverified' ? (
            <p className="notice warn small">{tr.unverifiedNote}</p>
          ) : null}
          {state.result.conflicts.length ? (
            <p className="notice warn small">{tr.conflicts(state.result.conflicts.length)}</p>
          ) : null}
          {state.result.warnings.length ? (
            <>
              <h3>{tr.warnings}</h3>
              <ul className="small">
                {state.result.warnings.slice(0, 50).map((w, i) => (
                  <li key={i}>
                    <strong>{tr.line(w.line)}</strong>: {w.message}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
