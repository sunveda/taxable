import { taxYears, type Session } from '../lib/session';
import { t } from '../lib/i18n';
import { setTaxYear } from './actions';
import { SubmitButton } from './submit-button';

/** Picks the tax year shown across the app. Works without JavaScript. */
export function YearSwitcher({ session }: { session: Session }) {
  const tr = t(session.lang);
  return (
    <form action={setTaxYear} className="row">
      <label>
        <span className="hint">{tr.settings.taxYear}</span>
        <select name="taxYear" defaultValue={session.taxYear}>
          {taxYears(session.jurisdiction).map((y) => (
            <option key={y} value={y}>
              {tr.yearLabel(y)}
            </option>
          ))}
        </select>
      </label>
      <SubmitButton secondary>{session.lang === 'ja' ? '表示' : 'Show'}</SubmitButton>
    </form>
  );
}
