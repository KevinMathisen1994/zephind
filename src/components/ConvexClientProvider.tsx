import type { ReactNode } from "react";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { useAuth } from "@clerk/clerk-react";

const convex = new ConvexReactClient(
  import.meta.env.VITE_NEXT_PUBLIC_CONVEX_URL as string
);

/**
 * Bridges the Clerk session into Convex.
 *
 * This was a plain <ConvexProvider>, so the Clerk JWT was never attached to
 * Convex requests and `ctx.auth.getUserIdentity()` was always null on the
 * backend — the root cause of every account reading the same shared data.
 * Per-user queries only work if the token is actually sent, which is what
 * ConvexProviderWithClerk does.
 *
 * `withClerk` is decided by Providers.tsx: when no Clerk key is configured there
 * is no ClerkProvider above this component and useAuth() would throw, so that
 * path keeps the plain provider.
 */
export function ConvexClientProvider({
  children,
  withClerk = false,
}: {
  children: ReactNode;
  withClerk?: boolean;
}) {
  if (!withClerk) {
    return <ConvexProvider client={convex}>{children}</ConvexProvider>;
  }
  return (
    <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
      {children}
    </ConvexProviderWithClerk>
  );
}
