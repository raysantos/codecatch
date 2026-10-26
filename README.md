# CodeCatch

A Chrome extension that catches 2FA codes from your Gmail. When a site asks for a sign-in code, CodeCatch finds the email, then either fills the code in for you or shows a **Paste 482913** button under the field. It can also pop up a Windows notification with a **Copy code** button.

- Works in Chrome on Windows (and any desktop Chrome).
- Reads Gmail with **read-only** access, and only looks at the last few minutes of mail.
- Runs entirely in your browser. No server, nothing stored except a short in-memory list of codes already used, which clears when Chrome closes.
- Handles single code boxes and the "six separate boxes" style.

## One-time setup (about 10 minutes)

Chrome needs a Google sign-in client tied to this extension before it can read Gmail. This extension has a fixed ID so the client only has to be set up once:

```
nkeplaiiggbgejlphegnckigceghaoia
```

### 1. Load the extension

1. Clone or download this repo, for example to `C:\Users\raysa\code\codecatch`.
2. In Chrome, go to `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the `codecatch` folder.
4. Check that the ID shown matches the one above.

### 2. Create the Google client

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and create a project called **CodeCatch**.
2. **APIs & Services → Library**: search for **Gmail API** and click **Enable**.
3. **Google Auth Platform → Branding** (or **OAuth consent screen**): app name *CodeCatch*, your email as the support and developer contact. User type **External**.
4. **Audience**: leave the publishing status as **Testing** and add `raysandesigns@gmail.com` (and any other Gmail you want to use) under **Test users**.
5. **Data access**: add the scope `https://www.googleapis.com/auth/gmail.readonly`.
6. **Clients → Create client**: application type **Chrome extension**, item ID `nkeplaiiggbgejlphegnckigceghaoia`. Copy the client ID it gives you.

### 3. Connect it

1. Open `manifest.json` and replace `PASTE_YOUR_CLIENT_ID.apps.googleusercontent.com` with your client ID.
2. Back in `chrome://extensions`, click the reload arrow on CodeCatch.
3. Click the CodeCatch icon in the toolbar (pin it from the puzzle-piece menu), then **Connect Gmail** and approve.

Google will show an "unverified app" warning because the app is in Testing mode. That's expected for a personal extension; click **Continue**. Staying in Testing mode means no Google review is needed, as long as only your own accounts use it.

## Using it

Sign in somewhere that emails you a code. When the code field shows up, CodeCatch checks Gmail every 3 seconds for up to 3 minutes. When the code arrives you'll see the Paste button, and a notification if those are on.

In the toolbar popup you can:
- see the latest code and copy it,
- turn on **Fill automatically** to skip the Paste button,
- turn notifications on or off,
- set how far back to look (2–10 minutes),
- disconnect Gmail.

## How it works

| File | Job |
|---|---|
| `src/content.js` | Runs on web pages. Spots code fields (`autocomplete="one-time-code"`, names like *otp* or *verification code*, or a row of single-digit boxes), asks for a code, then fills it or shows the chip. |
| `src/background.js` | Gets a Gmail token with `chrome.identity`, lists mail from the last few minutes, reads each message once and picks out the code. Shows notifications. |
| `src/extract.js` | Finds the code in an email. Prefers 6-digit numbers near words like *code* or *verification*, and skips order numbers, prices, years and phone numbers. |
| `src/offscreen.*` | A hidden page that copies to the clipboard for notification buttons. |
| `src/popup.*` | Toolbar popup and settings. Styled with raysan-ui tokens. |

Gmail itself (`mail.google.com`) is excluded so CodeCatch never fills things there.

## Tests

```
npm test
```

Runs the code-extraction tests. `node tests/content.test.mjs` runs browser tests for field detection and filling (needs Playwright).

## Limits

- Text-message codes aren't covered, only email.
- Codes from authenticator apps aren't covered.
- If a site's code field is unusual and CodeCatch misses it, the popup still shows the code to copy.
