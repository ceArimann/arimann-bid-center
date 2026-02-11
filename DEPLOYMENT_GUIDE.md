# Arimann Bid Command Center — Deployment Guide

## What You're Getting

A live web app at your own URL (e.g. `bids.arimann.com`) that:
- Reads/writes to your existing Google Sheet in real-time
- Only allows @arimann.com Google accounts to sign in
- Shows your company logo and branding
- Has Dashboard, Pipeline, Calendar, and Bid Form views
- Auto-refreshes every 2 minutes

## Architecture

```
Browser → Vercel (Next.js app) → Google Apps Script API → Google Sheet
                ↓
        Google OAuth (sign-in)
```

---

## Step 1: Deploy the Apps Script API

**You already have the v4 script. We're just adding an API layer.**

1. Open your Bid Command Center Google Sheet
2. Go to **Extensions → Apps Script**
3. Scroll to the very bottom of your existing code
4. **Paste** the contents of `AppsScript_API_Endpoint.gs` at the bottom
5. Click **Save** (disk icon)
6. Go to **Deploy → New deployment**
7. Click the gear icon → select **Web app**
8. Set:
   - Description: `Bid API v1`
   - Execute as: **Me** (your Google account)
   - Who has access: **Anyone** (the Next.js app handles auth)
9. Click **Deploy**
10. **Copy the Web app URL** — you'll need this. It looks like:
    ```
    https://script.google.com/macros/s/AKfycbx.../exec
    ```

**Test it:** Paste that URL + `?action=bids` in your browser. You should see your bids as JSON.

---

## Step 2: Set Up Google OAuth

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project (or use existing): **Arimann Bid Center**
3. Go to **APIs & Services → OAuth consent screen**
   - User Type: **External**
   - App name: `Arimann Bid Command Center`
   - User support email: `craig@arimann.com`
   - Add authorized domain: `arimann.com`
   - Developer email: `craig@arimann.com`
   - Click **Save and Continue** through all steps
4. Go to **APIs & Services → Credentials**
5. Click **+ Create Credentials → OAuth client ID**
   - Application type: **Web application**
   - Name: `Bid Center`
   - Authorized JavaScript origins:
     - `http://localhost:3000` (for dev)
     - `https://your-app.vercel.app` (add after deploying)
     - `https://bids.arimann.com` (if using custom domain)
   - Authorized redirect URIs:
     - `http://localhost:3000/api/auth/callback/google`
     - `https://your-app.vercel.app/api/auth/callback/google`
     - `https://bids.arimann.com/api/auth/callback/google`
6. Click **Create**
7. **Copy the Client ID and Client Secret**

---

## Step 3: Deploy to Vercel

### Option A: Deploy from GitHub (recommended)

1. Create a GitHub repository: `arimann-bid-center`
2. Push all the project files to it
3. Go to [vercel.com](https://vercel.com) and sign in with GitHub
4. Click **Add New → Project**
5. Import your `arimann-bid-center` repo
6. In **Environment Variables**, add:

| Key | Value |
|-----|-------|
| `NEXT_PUBLIC_SHEETS_API_URL` | Your Apps Script web app URL from Step 1 |
| `NEXTAUTH_URL` | `https://your-app.vercel.app` (update after first deploy) |
| `NEXTAUTH_SECRET` | Run `openssl rand -base64 32` to generate |
| `GOOGLE_CLIENT_ID` | From Step 2 |
| `GOOGLE_CLIENT_SECRET` | From Step 2 |
| `ALLOWED_DOMAINS` | `arimann.com` |

7. Click **Deploy**
8. Once deployed, copy your Vercel URL and:
   - Update `NEXTAUTH_URL` in Vercel env vars to the real URL
   - Add the Vercel URL to your Google OAuth authorized origins/redirects
   - Redeploy

### Option B: Deploy from CLI

```bash
npm install -g vercel
cd arimann-bid-center
vercel
# Follow prompts, add env vars when asked
```

---

## Step 4: Custom Domain (Optional)

1. In Vercel dashboard → your project → **Settings → Domains**
2. Add `bids.arimann.com`
3. Vercel will give you DNS records to add:
   - Usually a CNAME record: `bids` → `cname.vercel-dns.com`
4. Add this to your domain's DNS settings (wherever arimann.com is registered)
5. Don't forget to add `https://bids.arimann.com` to:
   - Google OAuth authorized origins and redirect URIs
   - Update `NEXTAUTH_URL` env var in Vercel

---

## Step 5: Test Everything

1. Visit your app URL
2. Click **Sign in with Google**
3. Sign in with your @arimann.com account
4. You should see your live bids from the Google Sheet
5. Try adding a new bid — check the Google Sheet to confirm it appeared
6. Try the Pipeline, Calendar, and search/filter views

---

## Ongoing Usage

- **Data stays in your Google Sheet** — the app is just a view on top
- **Apps Script automations still run** — Drive folders, Calendar, Slack alerts all continue
- **Add bids from either place** — the Google Form or the app both write to the same sheet
- **Refresh button** pulls latest data; auto-refreshes every 2 minutes
- **New team members** — just give them an @arimann.com Google account

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| "Access denied" on login | Email must be @arimann.com. Check `ALLOWED_DOMAINS` env var |
| No bids showing | Test the API URL directly: `YOUR_URL?action=bids` in browser |
| CORS errors | Apps Script web apps handle CORS automatically. Make sure deployment is set to "Anyone" |
| "Sign in error" | Check Google OAuth Client ID/Secret. Verify redirect URIs match exactly |
| Bids not updating | Click Refresh. Check Apps Script execution logs for errors |
| New bid not appearing | Check Apps Script Executions log. Ensure the sheet has room (rows) |

---

## Files Reference

```
arimann-bid-center/
├── public/
│   └── logo.png                    ← Your Arimann logo
├── src/
│   ├── app/
│   │   ├── globals.css             ← Tailwind + custom styles
│   │   ├── layout.js               ← Root layout with metadata
│   │   ├── page.js                 ← Main app (dashboard, pipeline, calendar, form)
│   │   ├── login/
│   │   │   └── page.js             ← Login screen
│   │   └── api/auth/[...nextauth]/
│   │       └── route.js            ← NextAuth Google OAuth handler
│   ├── components/
│   │   └── AuthProvider.js         ← Session provider wrapper
│   └── lib/
│       └── sheets.js               ← Google Sheets API client
├── .env.example                    ← Environment variables template
├── next.config.js
├── package.json
├── postcss.config.js
├── tailwind.config.js
└── AppsScript_API_Endpoint.gs      ← Add to your existing Apps Script
```
