import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { queryClient } from './client.ts';
import { createAppRouter } from './router.tsx';
import { saveTokenFromUrl } from './token.ts';
import './styles.css';

saveTokenFromUrl();
const router = createAppRouter();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
// Opening a link with a token in a tab already showing the review UI only
// changes the fragment, without loading the page again. The fragment has been
// removed by then, so the reload loads the URL without it.
window.addEventListener('hashchange', () => {
  if (saveTokenFromUrl()) window.location.reload();
});
