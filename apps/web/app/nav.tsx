'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function Nav({ items }: { items: { href: string; label: string; count?: number }[] }) {
  const path = usePathname();
  return (
    <nav className="nav" aria-label="Main">
      {items.map((i) => {
        const current = i.href === '/' ? path === '/' : path.startsWith(i.href);
        return (
          <Link key={i.href} href={i.href} aria-current={current ? 'page' : undefined}>
            {i.label}
            {i.count ? <span className="count">{i.count}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
