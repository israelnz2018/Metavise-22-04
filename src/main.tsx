import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { initWebVitals } from './lib/webVitals';
import { JobsProvider } from './lib/jobsStore';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <JobsProvider>
      <App />
    </JobsProvider>
  </StrictMode>
);

// Kick off Core Web Vitals reporting after the React tree mounts.
// Safe to call at module-time — web-vitals subscribes to browser
// performance observers, not React state.
initWebVitals();
