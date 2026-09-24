import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';

// iOS Safari only applies :active styles (the press feedback on buttons and
// cards) once the page has any touch listener. This one does nothing else.
document.addEventListener('touchstart', () => {}, { passive: true });

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);

// App is imported lazily so that a missing apps/web/.env - which makes lib/supabase.ts
// throw while it loads - shows its explanation on screen instead of a blank page.
import('./App')
  .then(({ default: App }) => {
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  })
  .catch((err: unknown) => {
    console.error(err);
    root.render(
      <main className="signin">
        <div className="signin-card">
          <h1>The app could not start</h1>
          <p className="note error" role="alert">
            {err instanceof Error ? err.message : String(err)}
          </p>
        </div>
      </main>,
    );
  });
