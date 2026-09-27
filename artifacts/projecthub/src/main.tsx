import { createRoot } from 'react-dom/client';
import { setAuthTokenGetter, setBaseUrl } from '@workspace/api-client-react';
import { getTeamToken } from './lib/team-auth';
import { API_ORIGIN } from './lib/api-base';

import App from './App';

import './index.css';

// Attach the team-session JWT to every generated API client request.
// The customFetch mutator skips this when no token is stored (unauthenticated).
setAuthTokenGetter(getTeamToken);
// Generated endpoint paths already begin with /api; configure only the
// origin so they use the same centralized host as manual requests.
setBaseUrl(API_ORIGIN || null);

createRoot(document.getElementById('root')!).render(<App />);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
      scope: import.meta.env.BASE_URL,
    });
  });
}
