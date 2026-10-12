import Link from 'next/link';
import type { Issue } from '../lib/api-types';
import { money, swing } from '../lib/format';
import { t, type Lang } from '../lib/i18n';
import { addOverride } from './actions';
import { SubmitButton } from './submit-button';

/** Fix-queue items, in the engine's order (largest impact first, unknowns never buried). */
export function IssueList({
  issues,
  currency,
  lang,
  limit,
}: {
  issues: Issue[];
  currency: string;
  lang: Lang;
  limit?: number;
}) {
  const tr = t(lang);
  const shown = limit ? issues.slice(0, limit) : issues;
  if (shown.length === 0) return <p className="empty">{tr.fixes.empty}</p>;
  return (
    <ul className="issues">
      {shown.map((i) => (
        <IssueItem key={i.id} issue={i} currency={currency} lang={lang} />
      ))}
    </ul>
  );
}

function IssueItem({ issue, currency, lang }: { issue: Issue; currency: string; lang: Lang }) {
  const tr = t(lang);
  const fmt = (v: string) => money(v, currency);
  const amount = swing(issue.impact);
  const eventId = issue.eventIds[0];
  const suggestion = tr.suggestion(issue, currency);
  return (
    <li className="issue">
      <div className="issue-impact">
        {!issue.impactKnown ? (
          <span className="badge warn">{tr.fixes.unknown}</span>
        ) : amount === '0' ? (
          <span className="badge">{tr.fixes.review}</span>
        ) : (
          <>
            <div>{tr.overview.upTo(fmt(amount))}</div>
            <span className="badge bad">{tr.fixes.impact}</span>
          </>
        )}
      </div>
      <div>
        <div>{tr.issue(issue, fmt)}</div>
        {eventId ? (
          <div className="small muted">
            {tr.fixes.event}: <code>{eventId}</code> · {issue.taxYear}
          </div>
        ) : null}

        {issue.suggestedResolution && suggestion ? (
          <form action={addOverride} className="suggestion">
            <div className="suggestion-text">
              <strong>{tr.fixes.suggested}:</strong> {suggestion}{' '}
              <span className="badge">
                {tr.fixes.confidence(issue.suggestedResolution.confidence)}
              </span>
            </div>
            <input
              type="hidden"
              name="eventId"
              value={issue.suggestedResolution.override.eventId}
            />
            {Object.entries(issue.suggestedResolution.override.action).map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={String(v)} />
            ))}
            <SubmitButton>{tr.fixes.apply}</SubmitButton>
          </form>
        ) : null}

        {eventId ? (
          <ManualFix issue={issue} eventId={eventId} lang={lang} currency={currency} />
        ) : null}
      </div>
    </li>
  );
}

function ManualFix({
  issue,
  eventId,
  lang,
  currency,
}: {
  issue: Issue;
  eventId: string;
  lang: Lang;
  currency: string;
}) {
  const tr = t(lang);
  const hidden = <input type="hidden" name="eventId" value={eventId} />;
  switch (issue.kind) {
    case 'missing_price':
      return (
        <details className="manual">
          <summary>{tr.fixes.orManual}</summary>
          <form action={addOverride} className="row">
            {hidden}
            <input type="hidden" name="type" value="set_unit_price" />
            <input type="hidden" name="asset" value={issue.params['asset'] ?? issue.asset ?? ''} />
            <label>
              {tr.fixes.unitPrice} ({currency})
              <input name="unitPrice" inputMode="decimal" required placeholder="0" />
            </label>
            <SubmitButton secondary>{tr.fixes.save}</SubmitButton>
          </form>
        </details>
      );
    case 'missing_basis':
      return (
        <details className="manual">
          <summary>{tr.fixes.orManual}</summary>
          <form action={addOverride} className="row">
            {hidden}
            <input type="hidden" name="type" value="set_cost_basis" />
            <label>
              {tr.fixes.costBasis} ({currency})
              <input name="costBasis" inputMode="decimal" required placeholder="0" />
            </label>
            <label>
              {tr.fixes.acquiredAt}
              <input name="acquiredAt" type="date" />
            </label>
            <SubmitButton secondary>{tr.fixes.save}</SubmitButton>
          </form>
        </details>
      );
    case 'unmatched_withdrawal':
      return (
        <details className="manual">
          <summary>{tr.fixes.orManual}</summary>
          <div className="row" style={{ marginTop: 8 }}>
            <form action={addOverride}>
              {hidden}
              <input type="hidden" name="type" value="classify_withdrawal" />
              <input type="hidden" name="as" value="own_wallet" />
              <SubmitButton secondary>{tr.fixes.ownWallet}</SubmitButton>
            </form>
          </div>
          <form action={addOverride} className="row" style={{ marginTop: 8 }}>
            {hidden}
            <input type="hidden" name="type" value="classify_withdrawal" />
            <input type="hidden" name="as" value="spent" />
            <label>
              {tr.fixes.proceeds} ({currency})
              <input name="proceeds" inputMode="decimal" placeholder="0" />
            </label>
            <SubmitButton secondary>{tr.fixes.spent}</SubmitButton>
          </form>
        </details>
      );
    case 'negative_balance':
      return (
        <p className="small" style={{ marginTop: 8 }}>
          <Link href="/import">{tr.fixes.importHistory} →</Link>
        </p>
      );
    default:
      return null;
  }
}
