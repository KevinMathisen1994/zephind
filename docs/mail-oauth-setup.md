# 提案メールの送信元アカウント設定（Gmail / Outlook）

> English: [mail-oauth-setup.en.md](./mail-oauth-setup.en.md)

提案メールを **自分のメールアドレスから** 送るための設定手順です。接続すると:

- 送信元が自分のアドレスになる（受信者には普通のメールとして届く）
- 自分の「送信済み」フォルダにも保存される
- 返信は自分の受信箱に届く

コード側は実装済みです。以下は**一度だけ**必要な、各プロバイダー側のアプリ登録です。
（アプリ登録は開発者側の作業で、利用者は画面の「接続」ボタンを押すだけです。）

## このデプロイのコールバックURL

| プロバイダー | リダイレクトURI |
|---|---|
| Google | `https://earnest-sturgeon-124.eu-west-1.convex.site/oauth/google/callback` |
| Microsoft | `https://earnest-sturgeon-124.eu-west-1.convex.site/oauth/microsoft/callback` |

本番デプロイでは `earnest-sturgeon-124.eu-west-1` の部分が変わります。値は
`npx convex env get CONVEX_SITE_URL`（または Convex ダッシュボード）で確認できます。

## 0. トークン暗号化キー（必須・最初に一度だけ）

保存するリフレッシュトークンは AES-GCM で暗号化されます。鍵が未設定だと接続時に
エラーになります。

```bash
openssl rand -base64 32                      # 32バイトの鍵を生成
npx convex env set MAIL_TOKEN_ENCRYPTION_KEY <生成した値>
```

> このデプロイでは既に設定済みです。本番デプロイでは別の鍵を設定してください。

## 1. Google（Gmail）— 未実装

Gmail 連携は**コードから削除済み**です。`gmail.send` は Google の
*restricted scope* で、公開アプリで不特定のユーザーに使わせるには OAuth 審査に加えて
**CASA（第三者セキュリティ審査・年額有料）** が必要になります。

将来対応する場合は、`PROVIDERS` への追加・`gmail.googleapis.com` への送信処理・
`/oauth/google/callback` ルートの3点で復活できます（動作していた版は git 履歴に
あります）。以下はその際の参考手順です。

1. https://console.cloud.google.com/ でプロジェクトを作成（既存でも可）。
2. **APIs & Services → Library** で **Gmail API** を有効化。
3. **OAuth consent screen** を設定
   - User type: 社内利用のみなら Internal（Google Workspace 必須）、
     `@gmail.com` を使う場合は External。
   - Scopes に `https://www.googleapis.com/auth/gmail.send` を追加。
4. **Credentials → Create credentials → OAuth client ID**
   - Application type: **Web application**
   - Authorized redirect URIs: 上表の Google のURL
5. 発行された Client ID / Client secret を Convex に登録:

```bash
npx convex env set GOOGLE_OAUTH_CLIENT_ID   <client-id>
npx convex env set GOOGLE_OAUTH_CLIENT_SECRET <client-secret>
```

### 重要な注意: 審査（verification）について

`gmail.send` は Google の「**制限付きスコープ**」です。External かつ
**Testing** 状態のままだと:

- テストユーザー（最大100名）に登録したアカウントしか接続できない
- **リフレッシュトークンが7日で失効する** → 週に一度、再接続が必要になる

実運用するなら OAuth consent screen を **In production** に切り替え、Google の
審査を通す必要があります（数日〜数週間）。Google Workspace の **Internal** 
アプリなら審査は不要で、7日制限もありません。会社ドメイン（zephyr-jp.net）が
Workspace なら Internal が圧倒的に楽です。

## 2. Microsoft（Outlook）

1. https://portal.azure.com/ → **Microsoft Entra ID → App registrations → New registration**
   - Supported account types: 個人の Outlook.com も使うなら
     「Accounts in any organizational directory and personal Microsoft accounts」
   - Redirect URI: **Web** を選び、上表の Microsoft のURL
2. **API permissions → Add a permission → Microsoft Graph → Delegated**
   - `Mail.Send` と `offline_access` を追加
3. **Certificates & secrets → New client secret** を作成（値は一度しか表示されません）
4. Convex に登録:

```bash
npx convex env set MICROSOFT_OAUTH_CLIENT_ID     <application-id>
npx convex env set MICROSOFT_OAUTH_CLIENT_SECRET <client-secret>
```

Microsoft は `Mail.Send` の委任スコープに管理者の同意を必須としないため、
Google のような審査待ちはありません。

### Azure のサインインで別のアカウントを使いたい場合

Azure ポータルは前回のアカウントを自動で使うため、別アカウントに切り替えにくいことが
あります。効きやすい順:

1. **シークレット / プライベートウィンドウ**で https://portal.azure.com を開く（最も確実）
2. 先に完全サインアウト → `https://login.microsoftonline.com/common/oauth2/v2.0/logout`
   （ポータル内のサインアウトだけでは残ることがあります）
3. アカウント選択を強制 → `https://portal.azure.com/?prompt=select_account`
4. 別の入口を使う → https://entra.microsoft.com （Applications → App registrations）
   または https://aka.ms/appregistrations
5. 別のブラウザ / 別のブラウザプロファイルを使う（会社PCで組織アカウントが
   強制される場合はこれが確実）

「アカウントが違う」のではなく「ディレクトリ（テナント）が違う」場合は、
サインアウト不要です。右上のアカウントアイコン → **ディレクトリの切り替え** で選択できます。

> アプリ登録は**どのアカウント / テナントで作っても構いません**。マルチテナント +
> 個人アカウント対応で登録するため、後から誰のメールアドレスでも接続できます。
> アプリ登録自体は無料で、Azure サブスクリプションも不要です。

## 3. 使い方

1. 「物件検索」または「保存物件」→ 顧客へ提案・送信 → 右上の歯車（設定）
2. **送信元メールアカウント** で「Gmail を接続」または「Outlook を接続」
3. ポップアップで同意すると自動で閉じ、接続済みになります
4. 以後、メール送信ボタンはそのアカウントから送信します
   （フッターに「送信元: ...」と表示されます）

**接続していない場合は送信できません。** 共有リレー（旧EmailJS）は削除したため、
自分以外のアドレスから送信されることはありません。

接続が切れた場合（パスワード変更・アクセス取り消しなど）は、設定画面に
「再接続が必要」と表示されます。

## セキュリティ上の注意

- リフレッシュトークンは Convex の `mailAccounts` テーブルに保存され、
  **ブラウザには一切返しません**（`myAccounts` はアドレスと状態のみ返す）。
- 「解除」を押すと行ごと削除されます。
- スコープは送信のみ（`gmail.send` / `Mail.Send`）で、受信メールは読めません。
