# Bigfoot's Day — one-time owner setup

This checklist is for the app owner or a technician. The person using the Android app never sees these settings.

Never paste passwords, API keys, client secrets, or private tokens into chat or commit them to GitHub.

## 1. Private installation token

Create one long random value (at least 32 characters). Save the same value in GitHub Actions secrets as:

- `BIGFOOT_APP_TOKEN`

The Cloudflare Worker uses it to recognize this personal installation. The Android build receives it automatically.

## 2. OpenAI

Create a project API key in the OpenAI developer platform and save it in GitHub Actions secrets as:

- `OPENAI_API_KEY`

The key is sent from GitHub directly to Cloudflare as a Worker secret. It is never committed to the repository or entered on the phone.

## 3. Cloudflare

Create a Cloudflare API token with permission to deploy Workers for the selected account. Save these GitHub Actions secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Run the GitHub workflow **Deploy Private Cloudflare Service**. Copy the resulting `workers.dev` address and save it as:

- `BIGFOOT_API_BASE`

The Android build embeds that service address automatically.

## 4. Google Gmail and Calendar

In Google Cloud, enable the Gmail API and Google Calendar API. Configure an OAuth consent screen for personal testing and create a Web application OAuth client.

Use this authorized redirect URI, replacing the example host with the deployed Worker address:

`https://bigfoots-day-private.YOUR-SUBDOMAIN.workers.dev/api/google/callback`

Save the OAuth values as GitHub Actions secrets:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

Run **Deploy Private Cloudflare Service** again so Cloudflare receives the Google secrets.

## 5. Build the Android app

Run the GitHub workflow **Build Android Test APK**. The resulting APK already contains the service address and installation token. The phone user does not enter either one.

During Easy Setup, the user taps **Connect Google**, chooses their Google account, approves Gmail and Calendar access, and returns to Bigfoot's Day.

## Security rules

- Suggested email replies are editable and require approval before sending.
- The OpenAI, Cloudflare, and Google secrets remain off the phone.
- The repository contains secret names only, never secret values.
- If the APK is shared beyond the intended personal device, rotate `BIGFOOT_APP_TOKEN` and rebuild.
