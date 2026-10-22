import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Providers } from "./Providers";
import App from "./App";
import "./index.css";

// Mail OAuth popup landing back here (see scraper-service/src/api/oauth.ts):
// hand the result to the opener and close before the app boots.
const mailOAuth = new URLSearchParams(window.location.search);
if (mailOAuth.has("mailOAuth") && window.opener) {
  window.opener.postMessage(
    { type: "zephind-oauth", ok: mailOAuth.get("mailOAuth") === "ok", message: mailOAuth.get("mailOAuthMsg") },
    window.location.origin,
  );
  window.close();
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Providers>
      <App />
    </Providers>
  </StrictMode>
);
