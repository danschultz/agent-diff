import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { saveTokenFromUrl } from './token.ts';

const root = createRoot(document.getElementById('root')!);
let renders = 0;

// Renders the review UI from scratch, so it uses the saved token.
function render(): void {
  renders += 1;
  root.render(
    <StrictMode>
      <App key={renders} />
    </StrictMode>,
  );
}

saveTokenFromUrl();
render();
// Opening a link with a token in a tab already showing the review UI only
// changes the fragment, without loading the page again.
window.addEventListener('hashchange', () => {
  if (saveTokenFromUrl()) render();
});
