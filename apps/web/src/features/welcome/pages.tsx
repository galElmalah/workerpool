/**
 * PLACEHOLDER — replaced by the onboarding/auth work. Contract: named exports WelcomePage,
 * LoginPage. Rendered inside the chrome-less `_bare` layout.
 */
import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { spring } from '@/motion/tokens';
import { Button } from '@/ui/Button';
import { Field, Input } from '@/ui/Field';

function Bare({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={spring.smooth} className="flex w-full max-w-sm flex-col gap-8">
        <span className="text-[0.9375rem] font-[600] tracking-[-0.02em] text-fg-1">cadence</span>
        <div className="flex flex-col gap-2">
          <span className="text-micro uppercase text-fg-3">{eyebrow}</span>
          <h1 data-page-title tabIndex={-1} className="text-title-1 text-fg-1 outline-none">
            {title}
          </h1>
        </div>
        {children}
      </motion.div>
    </div>
  );
}

export function WelcomePage() {
  return (
    <Bare eyebrow="Step 1 of 4" title="Connect Garmin">
      <p className="text-body-lg text-fg-2">Sign in, then we fetch your last activity as proof. Backfill, thresholds and preferences follow.</p>
      <Button variant="primary" size="lg">Connect Garmin</Button>
    </Bare>
  );
}

export function LoginPage() {
  return (
    <Bare eyebrow="Welcome back" title="Unlock Cadence">
      <form className="flex flex-col gap-4" onSubmit={(e) => e.preventDefault()}>
        <Field label="Passphrase">
          <Input type="password" autoComplete="current-password" placeholder="••••••••••" />
        </Field>
        <Button variant="primary" size="lg" type="submit">Continue</Button>
      </form>
    </Bare>
  );
}
