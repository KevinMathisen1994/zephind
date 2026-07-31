import type { ReactNode } from "react";
import { BrowserRouter } from "react-router-dom";
import { ClerkProvider } from "@clerk/clerk-react";
import { jaJP } from "@clerk/localizations";
import { ConvexClientProvider } from "./components/ConvexClientProvider";

const clerkPubKey = import.meta.env.VITE_NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY as string;
const hasValidClerkKey =
  clerkPubKey?.startsWith("pk_") && clerkPubKey !== "pk_test_placeholder";

/**
 * Whether Clerk is actually mounted. App.tsx needs this so it only gates routes
 * behind sign-in when there IS an auth provider — otherwise the no-Clerk local
 * setup would render a sign-in screen it can never get past.
 */
export const isClerkEnabled = Boolean(hasValidClerkKey);

export function Providers({ children }: { children: ReactNode }) {
  // withClerk must match the branch below: ConvexProviderWithClerk calls
  // useAuth(), which throws unless a ClerkProvider is an ancestor.
  let content = (
    <BrowserRouter>
      <ConvexClientProvider withClerk={hasValidClerkKey}>
        {children}
      </ConvexClientProvider>
    </BrowserRouter>
  );

  if (hasValidClerkKey) {
    // localization drives every Clerk-rendered string (sign-in form, errors,
    // user menu) — the rest of the UI is Japanese, so the auth screens should be
    // too.
    content = (
      <ClerkProvider publishableKey={clerkPubKey} localization={jaJP}>
        {content}
      </ClerkProvider>
    );
  }

  return <>{content}</>;
}