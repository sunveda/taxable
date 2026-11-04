import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { getBackend } from '../lib/backend';
import { getCalculation } from '../lib/data';
import { t } from '../lib/i18n';
import { setLanguage } from './actions';
import { Nav } from './nav';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'svdt', template: '%s · svdt' },
  description: 'The crypto tax engine you can actually check.',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const { session, calc } = await getCalculation();
  const tr = t(session.lang);
  const open = calc?.issues.length ?? 0;
  return (
    <html lang={session.lang}>
      <body>
        {getBackend().mode === 'demo' ? <div className="banner">{tr.demoBanner}</div> : null}
        <header className="topbar">
          <div className="topbar-inner">
            <Link href="/" className="brand">
              {tr.brand}
            </Link>
            <Nav
              items={[
                { href: '/', label: tr.nav.overview },
                { href: '/import', label: tr.nav.import },
                { href: '/transactions', label: tr.nav.transactions },
                { href: '/fixes', label: tr.nav.fixes, count: open },
                { href: '/report', label: tr.nav.report },
                { href: '/settings', label: tr.nav.settings },
              ]}
            />
            <div className="topbar-tools">
              <span className="badge accent">
                {tr.jurisdiction[session.jurisdiction]} · {tr.yearLabel(session.taxYear)}
              </span>
              <form action={setLanguage} className="segmented" aria-label="Language">
                <button name="lang" value="ja" aria-pressed={session.lang === 'ja'}>
                  日本語
                </button>
                <button name="lang" value="en" aria-pressed={session.lang === 'en'}>
                  EN
                </button>
              </form>
            </div>
          </div>
        </header>
        <main>{children}</main>
        <footer>
          <p>{tr.disclaimer}</p>
        </footer>
      </body>
    </html>
  );
}
