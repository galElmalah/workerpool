/** Standalone dev entry for the chart gallery (/charts-gallery.html) until the shell routes /dev/charts. */
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import '../styles/app.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'motion/react';
import { spring } from './motion';
import ChartGallery from './Gallery';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user" transition={spring.smooth}>
      <ChartGallery />
    </MotionConfig>
  </StrictMode>,
);
