# Bigfoot's Day v0.2 — Simple Setup Guide

## 1. Start the Windows companion

The companion service is the private bridge between your devices, OpenAI, and Google. Keep your OpenAI API key only on this service.

Set these environment values before launching it:

```text
OPENAI_API_KEY=your key
BIGFOOT_COMPANION_TOKEN=a private code you choose
```

On Android, enter the Windows companion's address and the same private code in **Settings**. Leave automatic sync on.

## 2. Connect Google once

In Google Cloud:

1. Create or select a Google Cloud project.
2. Enable the Gmail API and Google Calendar API.
3. Configure the OAuth consent screen for your own Google account.
4. Create an OAuth **Web application** client.
5. Add this authorized redirect URI exactly: `http://127.0.0.1:8787/api/google/callback`.
6. Put the client ID and client secret into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` on the Windows companion.
7. Restart Bigfoot's Day and choose **Settings → Connect Google** on the Windows PC.

Bigfoot's Day requests Gmail modify and Calendar access because those scopes cover the personal-assistant read/write foundation. The current Scout UI uses the OpenAI Gmail and Google Calendar connectors for reading and briefings; sensitive write actions remain confirmation-gated by design.

## 3. Talk naturally

Press **Talk to Scout**. The first time, allow microphone access. While the button is red, Scout is in a live conversation; press it again to end.

Examples:

- “Scout, what's on my calendar today?”
- “Any important email I should see?”
- “What should I focus on this morning?”
- “Remind me what I still have on my list.”

## 4. Phone and PC sync

Automatic sync runs every 15 seconds while both devices can reach the same companion service. Newer edits win. Removing an item creates a synchronized deletion marker so an older device does not accidentally restore it.

The manual **Sync my changes now** and **Get latest now** buttons remain available in Settings for reassurance and troubleshooting.
