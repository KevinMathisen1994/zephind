import type { ReactNode } from "react";
import { BrowserRouter } from "react-router-dom";
import { ClerkProvider } from "@clerk/clerk-react";
import { ConvexClientProvider } from "./components/ConvexClientProvider";

const clerkPubKey = import.meta.env.VITE_NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY as string;
const hasValidClerkKey =
  clerkPubKey?.startsWith("pk_") && clerkPubKey !== "pk_test_placeholder";

export function Providers({ children }: { children: ReactNode }) {
  let content = (
    <BrowserRouter>
      <ConvexClientProvider>{children}</ConvexClientProvider>
    </BrowserRouter>
  );

  if (hasValidClerkKey) {
    content = (
      <ClerkProvider publishableKey={clerkPubKey}>
        {content}
      </ClerkProvider>
    );
  }

  return <>{content}</>;
}