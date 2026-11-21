import '@fontsource-variable/geist'; // 'Geist Variable', normal, 100–900
import '@fontsource-variable/geist-mono'; // 'Geist Mono Variable'
import './styles/app.css';
import './shell/theme'; // applies <html data-theme> before first render
import './motion/prefs'; // applies <html data-motion>

import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { LucideProvider } from 'lucide-react';
import { MotionConfig } from 'motion/react';
import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { useMotionConfigReduced } from './motion/prefs';
import { spring } from './motion/tokens';
import { setUnauthorizedHandler } from './lib/api';
import { queryClient } from './lib/query';
import { router } from './shell/router';
import { Toaster } from './ui/toast';
import { TooltipProvider } from './ui/Tooltip';

function Providers({ children }: { children: ReactNode }) {
  const reducedMotion = useMotionConfigReduced();
  return (
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion={reducedMotion} transition={spring.smooth}>
        <LucideProvider size={16} strokeWidth={1.75}>
          <TooltipProvider>
            <Toaster>{children}</Toaster>
          </TooltipProvider>
        </LucideProvider>
      </MotionConfig>
    </QueryClientProvider>
  );
}

// A 401 from any API call drops the cached session and sends the visitor to sign in.
setUnauthorizedHandler(() => {
  queryClient.setQueryData(['auth'], (prev: unknown) => (prev ? { ...(prev as object), authenticated: false } : prev));
  const here = router.state.location;
  if (here.pathname !== '/login' && here.pathname !== '/welcome') {
    void router.navigate({ to: '/login', search: { redirect: here.href }, replace: true });
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Providers>
      <RouterProvider router={router} />
    </Providers>
  </StrictMode>,
);
