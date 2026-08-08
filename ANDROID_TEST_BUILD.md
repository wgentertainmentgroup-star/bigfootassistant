# Bigfoot's Day — Android Sideload Test

This project is configured so the debug build installs as a separate Android test app:

- Display name: **Bigfoot's Day Test**
- Test application ID: `com.bigfootsoftware.bigfootsday.test`
- Version: `0.2.0-test`
- Minimum Android API: 24
- Target/compile API: 36
- Build variant: `debug`
- Expected APK: `android/app/build/outputs/apk/debug/app-debug.apk`

The debug variant is signed automatically with the standard Android debug key when built by Gradle/Android Studio, so it can be sideloaded without a Play Store account.

## Test checklist on the phone

1. Install the debug APK and open **Bigfoot's Day Test**.
2. Allow microphone access when starting live Scout.
3. Open **People → Turn on caller ID** and approve the Android call-screening role and contacts access.
4. Add a test person and verify one-tap calling.
5. Add a task dated tomorrow and allow notifications; confirm the reminder is scheduled.
6. In Settings, enter the companion service address and private connection code if testing AI/Google/sync features.
7. Start **Talk to Scout** and confirm two-way audio.
8. Make an incoming call from a saved number and confirm the caller is announced.

## Build command

From the `android` directory on a machine with Android SDK API 36 and Gradle dependencies available:

```text
gradlew.bat assembleDebug
```

No production signing key is required for this sideload test build.
