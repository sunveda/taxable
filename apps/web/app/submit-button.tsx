'use client';

import type { ReactNode } from 'react';
import { useFormStatus } from 'react-dom';

/** A submit button that disables itself while its form's Server Action runs. */
export function SubmitButton({
  children,
  secondary,
  pendingLabel,
}: {
  children: ReactNode;
  secondary?: boolean;
  pendingLabel?: ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={secondary ? 'secondary' : undefined}>
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}
