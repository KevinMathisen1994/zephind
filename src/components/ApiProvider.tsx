import { useEffect, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuth } from "@clerk/clerk-react";
import { setTokenGetter } from "../lib/apiClient";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Convex pushed changes, so nothing was ever stale for long. These are
      // plain fetches, so refetch on focus and keep a short stale window rather
      // than serving a cached list from ten minutes ago.
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      retry: 1,
      // Only throw to AuthErrorBoundary when the error is an authentication issue
      // (e.g. unverified session / missing token). Other API errors (network down,
      // 500, etc.) are handled gracefully by component-level error states rather
      // than crashing the whole application to the error boundary.
      throwOnError: (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        return /未認証|Not signed in|getUserIdentity|Unauthenticated|401/i.test(msg);
      },
    },
  },
});

/** Registers Clerk's token getter for apiFetch, inside a ClerkProvider. */
function ClerkTokenBridge({ children }: { children: ReactNode }) {
  const { getToken } = useAuth();
  useEffect(() => {
    // Clerk's DEFAULT session token, deliberately not a named template: the old
    // `convex` template belonged to Clerk's Convex integration and stops
    // existing once that is disconnected, which made every request throw
    // "No JWT template exists with name: convex".
    setTokenGetter(() => getToken());
    return () => setTokenGetter(null);
  }, [getToken]);
  return <>{children}</>;
}

/**
 * Replaces ConvexClientProvider. `withClerk` is decided by Providers.tsx: with
 * no Clerk key configured there is no ClerkProvider above this component and
 * useAuth() would throw, so that path sends unauthenticated requests and the
 * backend answers 401 — which is what the local no-auth setup already expected.
 */
export function ApiProvider({
  children,
  withClerk = false,
}: {
  children: ReactNode;
  withClerk?: boolean;
}) {
  return (
    <QueryClientProvider client={queryClient}>
      {withClerk ? <ClerkTokenBridge>{children}</ClerkTokenBridge> : children}
    </QueryClientProvider>
  );
}
