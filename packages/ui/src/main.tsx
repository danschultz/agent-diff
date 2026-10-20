import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { saveTokenFromUrl } from './token.ts';

saveTokenFromUrl();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
// Opening a link with a token in a tab already showing the review UI only
// changes the fragment, without loading the page again. The fragment has been
// removed by then, so the reload loads the URL without it.
window.addEventListener('hashchange', () => {
  if (saveTokenFromUrl()) window.location.reload();
});
