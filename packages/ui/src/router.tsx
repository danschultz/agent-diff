// The review UI's routes. The only page is a session, at `/sessions/$id`
// (decision 0040), and every other path shows the not-found page. Routes are
// code-based, and each route's component is a page that reads what its
// loader loaded through TanStack Query. See .rules/review-ui.md.
import { ORPCError } from '@orpc/client';
import type { QueryClient } from '@tanstack/react-query';
import {
  createBrowserHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  notFound,
} from '@tanstack/react-router';
import { orpc, queryClient } from './client.ts';
import { LoadError, NoTokenError } from './components/LoadError.tsx';
import { Loading } from './components/Loading.tsx';
import { NotFoundPage } from './pages/NotFoundPage.tsx';
import { SessionPage } from './pages/SessionPage.tsx';
import { savedToken } from './token.ts';

const rootRoute = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  notFoundComponent: NotFoundPage,
});

const sessionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sessions/$id',
  loader: async ({ context, params: { id } }) => {
    if (savedToken() === null) throw new NoTokenError();
    try {
      await context.queryClient.ensureQueryData(
        orpc.session.show.queryOptions({ input: { id } }),
      );
    } catch (error) {
      if (error instanceof ORPCError && error.code === 'NOT_FOUND') {
        throw notFound();
      }
      throw error;
    }
  },
  component: SessionPage,
  pendingComponent: Loading,
  errorComponent: LoadError,
});

const routeTree = rootRoute.addChildren([sessionRoute]);

// Browser history reads the URL, fragment included, when it's created, so
// create the router only after `saveTokenFromUrl()` has removed the token
// from it. Never hash history, since the token arrives in the fragment.
export function createAppRouter() {
  return createRouter({
    routeTree,
    history: createBrowserHistory(),
    context: { queryClient },
    // TanStack Query caches what loaders load, so the router's own cache
    // never makes a loader run again.
    defaultPreloadStaleTime: 0,
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
