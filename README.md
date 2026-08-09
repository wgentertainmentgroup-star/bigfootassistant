# Bigfoot's Day v0.5

A local-first personal assistant designed for a single user, with a large, calm interface for Windows and Android.

The normal Android test build works without a developer account, service address, or private connection code.

## What works now

- Today dashboard and spoken briefing
- Personal task/reminder list
- Important contacts and one-tap calling
- Notes the assistant can use as context
- Voice input where the operating system exposes Web Speech
- Spoken answers
- OpenAI Responses API companion service with web search
- Live OpenAI Realtime WebRTC conversation with Scout
- Gmail and Google Calendar context through OpenAI-supported connectors
- Companion sync for tasks, people, notes and recent assistant history
- Automatic 15-second PC/Android merge sync with deletion protection
- Offline fallback for the core "what should I do today?" workflow
- Android local notification support
- Android caller-identification service scaffold
- Responsive senior-friendly interface shared by Windows and Android

## Run it

Install packages with `npm install`, then run the UI with `npm run dev` and, in a second terminal, `npm run server`.

For AI answers, set `OPENAI_API_KEY` in the environment before starting the companion service. The key stays in the service process; it is not stored in browser data.

Set `BIGFOOT_COMPANION_TOKEN` to a private code before connecting another device to the companion service. Enter that same code in Android Settings. The PC and phone can then use the two plain-language sync buttons to exchange their current data.

Optional OpenAI-supported connectors or remote MCP servers can be supplied to the companion service with `BIGFOOT_MCP_TOOLS_JSON`. The value is a JSON array of Responses API `mcp` tool configurations. Bigfoot's Day defaults configured MCP tools to approval-required behavior. OAuth/access tokens belong on the companion service, never in the app bundle.

### Connect Gmail and Google Calendar

Create a Google OAuth web client and set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and the registered redirect URI `http://127.0.0.1:8787/api/google/callback`. Bigfoot's Day requests offline Google access so the companion can refresh access while the user is away. Refresh/access tokens are encrypted at rest with `BIGFOOT_TOKEN_KEY`, falling back to `BIGFOOT_COMPANION_TOKEN`.

Then open Settings on the Windows version and press **Connect Google**. After consent, Scout can use Gmail and Google Calendar for read/briefing requests. The phone uses the same connected companion; it does not store the Google refresh token.

### Live Scout voice

The large **Talk to Scout** button opens a Realtime WebRTC conversation. The permanent OpenAI API key remains on the companion service. Android requests microphone permission the first time.

Windows companion: `npm run electron`

Android project: `npm run android:add` the first time, then `npm run android:sync` after web changes. Open the generated `android` directory in Android Studio to build/install the APK.

## Architecture

The shared React app stores everyday data locally on the device. The Node companion service holds the OpenAI API connection. On Windows it starts with the desktop app. Android can point to the companion service address in Settings. This avoids embedding a long-lived OpenAI API key in the Android application.

Bigfoot's Day does not inherit a private ChatGPT session or its installed apps. External services are connected explicitly through supported API/connector integrations. Sensitive write actions should always require user confirmation.
