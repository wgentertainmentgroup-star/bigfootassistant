package com.bigfootsoftware.bigfootsday;

import android.Manifest;
import android.app.role.RoleManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ShortcutInfo;
import android.content.pm.ShortcutManager;
import android.graphics.drawable.Icon;
import android.os.Build;
import android.speech.RecognizerIntent;
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

    @PluginMethod
    public void startVoiceInput(PluginCall call) {
        if (getPermissionState("microphone") != com.getcapacitor.PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "microphoneResult");
            return;
        }
        launchSpeechInput(call);
    }

    @PermissionCallback
    private void microphoneResult(PluginCall call) {
        if (getPermissionState("microphone") != com.getcapacitor.PermissionState.GRANTED) {
            resolveVoice(call, "", "Microphone permission was not allowed.");
            return;
        }
        launchSpeechInput(call);
    }

    private void launchSpeechInput(PluginCall call) {
        try {
            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.US.toLanguageTag());
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, Locale.US.toLanguageTag());
            intent.putExtra(RecognizerIntent.EXTRA_ONLY_RETURN_LANGUAGE_PREFERENCE, false);
            intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3);
            intent.putExtra(RecognizerIntent.EXTRA_PROMPT, "Speak to Bubba");
            if (intent.resolveActivity(getContext().getPackageManager()) == null) {
                resolveVoice(call, "", "No speech recognition service is enabled on this phone.");
                return;
            }
            startActivityForResult(call, intent, "speechResult");
        } catch (Exception error) {
            resolveVoice(call, "", "Speech recognition could not start.");
        }
    }

    @ActivityCallback
    private void speechResult(PluginCall call, ActivityResult result) {
        String text = "";
        if (result.getResultCode() == android.app.Activity.RESULT_OK && result.getData() != null) {
            ArrayList<String> choices = result.getData().getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
            if (choices != null && !choices.isEmpty()) text = choices.get(0);
        }
        resolveVoice(call, text, text.isEmpty() ? "Nothing was heard. Please try again." : "");
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
