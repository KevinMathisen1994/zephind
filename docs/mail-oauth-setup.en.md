# Proposal email: connecting a sending account (Gmail / Outlook)

> 日本語版: [mail-oauth-setup.md](./mail-oauth-setup.md)

Proposal emails are sent **from the user's own mailbox**. Once an account is
connected:

- the From address is their real address, so it arrives as an ordinary email
- a copy appears in their own **Sent** folder
- replies go straight to their inbox

The application code is already in place. What follows is the **one-time app
registration** on each provider. This is developer setup — end users only click
"接続" (Connect) in the app.

## Callback URLs for this deployment

| Provider | Redirect URI |
|---|---|
| Google | `https://earnest-sturgeon-124.eu-west-1.convex.site/oauth/google/callback` |
| Microsoft | `https://earnest-sturgeon-124.eu-west-1.convex.site/oauth/microsoft/callback` |

A production deployment has a different subdomain. Get it with
`npx convex env get CONVEX_SITE_URL`, or from the Convex dashboard.

## 0. Token encryption key (required, once per deployment)

Stored refresh tokens are encrypted with AES-GCM. Without the key, connecting
fails with a clear error.

```bash
openssl rand -base64 32                       # generate a 32-byte key
npx convex env set MAIL_TOKEN_ENCRYPTION_KEY <generated value>
```

> Already set on this dev deployment. Use a different key in production.

## 1. Google (Gmail) — not implemented

Gmail support has been **removed from the code** for now. `gmail.send` is a Google
*restricted scope*: letting arbitrary users of a public app connect requires OAuth
verification **plus an annual paid CASA security assessment** (typically several
hundred to a few thousand USD per year, weeks to months of review).

If that changes, re-adding it is: one entry in `PROVIDERS`, a sender posting an
RFC 822 message to `gmail.googleapis.com`, and a `/oauth/google/callback` route.
A working version is in this file's git history. The reference steps below are kept
for that day.

1. Create (or reuse) a project at https://console.cloud.google.com/.
2. **APIs & Services → Library** → enable the **Gmail API**.
3. Configure the **OAuth consent screen**:
   - User type: **Internal** if everyone signing in belongs to your Google
     Workspace domain; **External** if personal `@gmail.com` accounts are used.
   - Add the scope `https://www.googleapis.com/auth/gmail.send`.
4. **Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - Authorized redirect URI: the Google URL from the table above
5. Store the credentials on the Convex deployment:

```bash
npx convex env set GOOGLE_OAUTH_CLIENT_ID     <client-id>
npx convex env set GOOGLE_OAUTH_CLIENT_SECRET <client-secret>
```

### Important: Google verification

`gmail.send` is a **restricted scope**. If the consent screen is *External* and
left in **Testing**:

- only accounts added as test users can connect (max 100), and
- **refresh tokens expire after 7 days**, forcing a weekly reconnect

For real use, either publish the app and pass Google's review (days to weeks), or
register it as an **Internal** Workspace app — no review, no 7-day limit. If
`zephyr-jp.net` is on Google Workspace, Internal is by far the easier path.

## 2. Microsoft (Outlook)

1. https://portal.azure.com/ → **Microsoft Entra ID → App registrations → New
   registration**
   - Supported account types: include personal Microsoft accounts if Outlook.com
     addresses will be used ("Accounts in any organizational directory and
     personal Microsoft accounts")
   - Redirect URI: platform **Web**, using the Microsoft URL above
2. **API permissions → Add a permission → Microsoft Graph → Delegated**: add
   `Mail.Send` and `offline_access`.
3. **Certificates & secrets → New client secret** (the value is shown only once).
4. Store the credentials:

```bash
npx convex env set MICROSOFT_OAUTH_CLIENT_ID     <application-id>
npx convex env set MICROSOFT_OAUTH_CLIENT_SECRET <client-secret>
```

Microsoft does not require admin consent for the delegated `Mail.Send` scope, so
there is no review to wait for.

### Signing in to Azure with a different account

The Azure portal reuses your previous account, which can make switching hard.
In order of reliability:

1. Open https://portal.azure.com in a **private / incognito window** (most reliable)
2. Sign out fully first → `https://login.microsoftonline.com/common/oauth2/v2.0/logout`
   (signing out inside the portal often leaves this session behind)
3. Force the account picker → `https://portal.azure.com/?prompt=select_account`
4. Use a different entry point → https://entra.microsoft.com (Applications → App
   registrations) or https://aka.ms/appregistrations
5. Use another browser or a fresh browser profile — the sure escape when a
   company-managed machine forces the work account

If it is the right account but the **wrong directory (tenant)**, no sign-out is
needed: avatar (top right) → **Switch directory**.

> The app registration can live in **any account or tenant**. It is registered as
> multi-tenant + personal accounts, so any user's mailbox can connect regardless.
> App registrations are free and need no Azure subscription.

## 3. Using it

> Today only **Outlook** is offered in the UI. Microsoft has no review gate for
> delegated `Mail.Send`, so any user — personal Outlook.com or a work account —
> can connect immediately.

1. 物件検索 (Search) or 保存物件 (Saved) → 顧客へ提案・送信 → gear icon (settings)
2. Under **送信元メールアカウント**, click **Gmail を接続** or **Outlook を接続**
3. Approve in the popup; it closes itself and the account shows as 接続済み
4. The send button then sends from that mailbox — the footer shows
   「送信元: …」 so it is always visible which address will be used

If access is later revoked or the password changes, the settings panel shows
**再接続が必要** (reconnect required) and sending is blocked until it is fixed,
rather than failing with an opaque error.

## Notes on behaviour and security

- **Sending requires a connected account.** There is no shared relay fallback —
  EmailJS was removed — so mail can never go out from an address other than the
  signed-in user's own mailbox.
- Scopes are send-only (`gmail.send` / `Mail.Send`). The app cannot read mail.
- Refresh tokens live in the Convex `mailAccounts` table and are **never returned
  to the browser**: the `myAccounts` query projects only provider, address and
  status. They are read exclusively by server-side internal functions.
- 解除 (Disconnect) deletes the row outright.
- The OAuth callback arrives with no Clerk session, so a random single-use `state`
  minted by an authenticated action is what ties it to a user. It expires in 10
  minutes and is deleted as it is read.
