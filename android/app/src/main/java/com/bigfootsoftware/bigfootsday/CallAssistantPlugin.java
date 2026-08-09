package com.bigfootsoftware.bigfootsday;

import android.Manifest;
import android.app.role.RoleManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ShortcutInfo;
import android.content.pm.ShortcutManager;
import android.graphics.drawable.Icon;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;

@CapacitorPlugin(
    name = "CallAssistant",
    permissions = {
        @Permission(alias = "contacts", strings = { Manifest.permission.READ_CONTACTS }),
        @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO })
    }
)
public class CallAssistantPlugin extends Plugin {
    private TextToSpeech textToSpeech;
    private SpeechRecognizer speechRecognizer;
    private PluginCall activeVoiceCall;
    private final Handler voiceHandler = new Handler(Looper.getMainLooper());
    private Runnable voiceTimeout;

    @PluginMethod
    public void startVoiceInput(PluginCall call) {
        if (getPermissionState("microphone") != com.getcapacitor.PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "microphoneResult");
            return;
        }
        startInAppSpeechRecognition(call);
    }

    @PermissionCallback
    private void microphoneResult(PluginCall call) {
        if (getPermissionState("microphone") != com.getcapacitor.PermissionState.GRANTED) {
            resolveVoice(call, "", "Microphone permission was not allowed.");
            return;
        }
        startInAppSpeechRecognition(call);
    }

    private void startInAppSpeechRecognition(PluginCall call) {
        if (!SpeechRecognizer.isRecognitionAvailable(getContext())) {
            resolveVoice(call, "", "Samsung could not find an enabled speech recognition service. Enable the Google app or Samsung voice input, then try again.");
            return;
        }
        getActivity().runOnUiThread(() -> {
            finishVoice("", "A new voice request started.");
            activeVoiceCall = call;
            speechRecognizer = SpeechRecognizer.createSpeechRecognizer(getContext().getApplicationContext());
            speechRecognizer.setRecognitionListener(new RecognitionListener() {
                @Override public void onReadyForSpeech(Bundle params) { sendVoiceState("listening", "Listening…"); }
                @Override public void onBeginningOfSpeech() { sendVoiceState("hearing", "I hear you…"); }
                @Override public void onRmsChanged(float rmsdB) {
                    JSObject event = new JSObject();
                    event.put("state", "hearing");
                    event.put("level", Math.max(0, Math.min(10, Math.round(rmsdB))));
                    notifyListeners("voiceState", event);
                }
                @Override public void onBufferReceived(byte[] buffer) {}
                @Override public void onEndOfSpeech() { sendVoiceState("processing", "Working on that…"); }
                @Override public void onError(int error) { finishVoice("", speechError(error)); }
                @Override public void onResults(Bundle results) {
                    ArrayList<String> choices = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                    finishVoice(choices != null && !choices.isEmpty() ? choices.get(0) : "", choices == null || choices.isEmpty() ? "Nothing was heard. Please try again." : "");
                }
                @Override public void onPartialResults(Bundle partialResults) {}
                @Override public void onEvent(int eventType, Bundle params) {}
            });

            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.US.toLanguageTag());
            intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3);
            intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false);
            intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 1100L);
            intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 900L);
            voiceTimeout = () -> finishVoice("", "Listening timed out. Tap the microphone and try again.");
            voiceHandler.postDelayed(voiceTimeout, 15000L);
            sendVoiceState("starting", "Starting microphone…");
            try {
                speechRecognizer.startListening(intent);
            } catch (Exception error) {
                finishVoice("", "The microphone could not start. Close other apps using the microphone and try again.");
            }
        });
    }

    private String speechError(int error) {
        switch (error) {
            case SpeechRecognizer.ERROR_AUDIO: return "The microphone had an audio problem. Please try again.";
            case SpeechRecognizer.ERROR_CLIENT: return "Voice listening stopped. Please tap the microphone again.";
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS: return "Microphone permission is required. Open Android Settings, Apps, Bigfoot’s Day, Permissions, then allow Microphone.";
            case SpeechRecognizer.ERROR_NETWORK:
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT: return "The phone’s speech service could not connect. Check Wi-Fi or mobile data and try again.";
            case SpeechRecognizer.ERROR_NO_MATCH: return "I could not understand that. Please speak clearly and try again.";
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY: return "The speech service is busy. Wait a moment and try again.";
            case SpeechRecognizer.ERROR_SERVER: return "The phone’s speech service is temporarily unavailable. Please try again.";
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT: return "I did not hear speech. Tap the microphone and try again.";
            default: return "Voice input stopped unexpectedly. Please try again.";
        }
    }

    private void sendVoiceState(String state, String message) {
        JSObject event = new JSObject();
        event.put("state", state);
        event.put("message", message);
        notifyListeners("voiceState", event);
    }

    private void finishVoice(String text, String error) {
        if (voiceTimeout != null) {
            voiceHandler.removeCallbacks(voiceTimeout);
            voiceTimeout = null;
        }
        PluginCall call = activeVoiceCall;
        activeVoiceCall = null;
        SpeechRecognizer recognizer = speechRecognizer;
        speechRecognizer = null;
        if (recognizer != null) {
            recognizer.cancel();
            recognizer.destroy();
        }
        if (call != null) resolveVoice(call, text, error);
        sendVoiceState(error.isEmpty() ? "complete" : "idle", error);
    }

    private void resolveVoice(PluginCall call, String text, String error) {
        JSObject response = new JSObject();
        response.put("text", text);
        response.put("error", error);
        call.resolve(response);
    }

    @PluginMethod
    public void speakText(PluginCall call) {
        String text = call.getString("text", "").trim();
        if (text.isEmpty()) {
            resolveSpeech(call, false, "There is no text to speak.");
            return;
        }
        getActivity().runOnUiThread(() -> {
            if (textToSpeech != null) textToSpeech.stop();
            textToSpeech = new TextToSpeech(getContext().getApplicationContext(), status -> {
                if (status != TextToSpeech.SUCCESS || textToSpeech == null) {
                    resolveSpeech(call, false, "Android text-to-speech is not ready.");
                    return;
                }
                int language = textToSpeech.setLanguage(Locale.US);
                if (language == TextToSpeech.LANG_MISSING_DATA || language == TextToSpeech.LANG_NOT_SUPPORTED) {
                    resolveSpeech(call, false, "The English voice is not installed.");
                    return;
                }
                textToSpeech.setSpeechRate(0.90f);
                textToSpeech.setPitch(0.88f);
                int queued = textToSpeech.speak(text, TextToSpeech.QUEUE_FLUSH, null, "bigfoot-scout");
                resolveSpeech(call, queued == TextToSpeech.SUCCESS, queued == TextToSpeech.SUCCESS ? "" : "Android could not play the voice.");
            });
        });
    }

    private void resolveSpeech(PluginCall call, boolean spoken, String error) {
        JSObject response = new JSObject();
        response.put("spoken", spoken);
        response.put("error", error);
        call.resolve(response);
    }

    @Override
    protected void handleOnDestroy() {
        finishVoice("", "Voice listening ended because the app closed.");
        if (textToSpeech != null) {
            textToSpeech.stop();
            textToSpeech.shutdown();
            textToSpeech = null;
        }
        super.handleOnDestroy();
    }

    @PluginMethod
    public void openChatGPT(PluginCall call) {
        JSObject result = new JSObject();
        try {
            Intent launch = getContext().getPackageManager().getLaunchIntentForPackage("com.openai.chatgpt");
            if (launch == null) {
                launch = new Intent(Intent.ACTION_VIEW, android.net.Uri.parse("https://chatgpt.com/"));
            }
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(launch);
            result.put("opened", true);
        } catch (Exception error) {
            result.put("opened", false);
        }
        call.resolve(result);
    }

    @PluginMethod
    public void requestHomeShortcut(PluginCall call) {
        JSObject result = new JSObject();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            result.put("requested", false);
            call.resolve(result);
            return;
        }

        ShortcutManager manager = getContext().getSystemService(ShortcutManager.class);
        if (manager == null || !manager.isRequestPinShortcutSupported()) {
            result.put("requested", false);
            call.resolve(result);
            return;
        }

        Intent launchIntent = new Intent(getContext(), MainActivity.class)
            .setAction(Intent.ACTION_MAIN)
            .addCategory(Intent.CATEGORY_LAUNCHER);
        ShortcutInfo shortcut = new ShortcutInfo.Builder(getContext(), "bigfoots-day-home")
            .setShortLabel("Bigfoot’s Day")
            .setLongLabel("Open Bigfoot’s Day")
            .setIcon(Icon.createWithResource(getContext(), R.mipmap.ic_launcher))
            .setIntent(launchIntent)
            .build();

        result.put("requested", manager.requestPinShortcut(shortcut, null));
        call.resolve(result);
    }

    @PluginMethod
    public void requestCallerIdAccess(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            requestPermissionForAlias("contacts", call, "contactsResult");
            return;
        }
        RoleManager manager = (RoleManager) getContext().getSystemService(Context.ROLE_SERVICE);
        if (manager != null && manager.isRoleHeld(RoleManager.ROLE_CALL_SCREENING)) {
            requestPermissionForAlias("contacts", call, "contactsResult");
            return;
        }
        if (manager == null || !manager.isRoleAvailable(RoleManager.ROLE_CALL_SCREENING)) {
            resolve(call, false);
            return;
        }
        Intent intent = manager.createRequestRoleIntent(RoleManager.ROLE_CALL_SCREENING);
        startActivityForResult(call, intent, "roleResult");
    }

    @ActivityCallback
    private void roleResult(PluginCall call, ActivityResult result) {
        RoleManager manager = (RoleManager) getContext().getSystemService(Context.ROLE_SERVICE);
        boolean held = manager != null && manager.isRoleHeld(RoleManager.ROLE_CALL_SCREENING);
        if (!held) { resolve(call, false); return; }
        requestPermissionForAlias("contacts", call, "contactsResult");
    }

    @PermissionCallback
    private void contactsResult(PluginCall call) {
        boolean roleOkay = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            RoleManager manager = (RoleManager) getContext().getSystemService(Context.ROLE_SERVICE);
            roleOkay = manager != null && manager.isRoleHeld(RoleManager.ROLE_CALL_SCREENING);
        }
        resolve(call, roleOkay);
    }

    private void resolve(PluginCall call, boolean granted) {
        JSObject result = new JSObject();
        result.put("granted", granted);
        call.resolve(result);
    }

    @PluginMethod
    public void getLastCaller(PluginCall call) {
        var prefs = getContext().getSharedPreferences("bigfoots_day_calls", Context.MODE_PRIVATE);
        JSObject result = new JSObject();
        result.put("number", prefs.getString("number", ""));
        result.put("name", prefs.getString("name", ""));
        result.put("time", prefs.getLong("time", 0));
        call.resolve(result);
    }

    @PluginMethod
    public void setKnownPeople(PluginCall call) {
        JSONArray people = call.getArray("people");
        getContext().getSharedPreferences("bigfoots_day_calls", Context.MODE_PRIVATE).edit()
            .putString("known_people", people == null ? "[]" : people.toString()).apply();
        call.resolve();
    }
}
