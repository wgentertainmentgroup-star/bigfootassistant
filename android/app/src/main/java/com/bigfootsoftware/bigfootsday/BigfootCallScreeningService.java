package com.bigfootsoftware.bigfootsday;

import android.content.Context;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.provider.ContactsContract;
import android.speech.tts.TextToSpeech;
import android.telecom.Call;
import android.telecom.CallScreeningService;
import androidx.core.content.ContextCompat;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;

public class BigfootCallScreeningService extends CallScreeningService {
    @Override
    public void onScreenCall(Call.Details details) {
        String number = details.getHandle() == null ? "" : details.getHandle().getSchemeSpecificPart();
        String name = findContactName(number);
        getSharedPreferences("bigfoots_day_calls", Context.MODE_PRIVATE).edit()
            .putString("number", number).putString("name", name).putLong("time", System.currentTimeMillis()).apply();

        respondToCall(details, new CallResponse.Builder().build());
        announce(name, number);
    }

    private String findContactName(String number) {
        if (number == null || number.isBlank()) return "";
        String saved = findSavedName(number);
        if (!saved.isBlank()) return saved;
        if (ContextCompat.checkSelfPermission(this, android.Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED) return "";
        Uri uri = Uri.withAppendedPath(ContactsContract.PhoneLookup.CONTENT_FILTER_URI, Uri.encode(number));
        try (Cursor c = getContentResolver().query(uri, new String[]{ContactsContract.PhoneLookup.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) return c.getString(0);
        } catch (Exception ignored) {}
        return "";
    }

    private String findSavedName(String number) {
        String wanted = normalize(number);
        try {
            JSONArray people = new JSONArray(getSharedPreferences("bigfoots_day_calls", Context.MODE_PRIVATE).getString("known_people", "[]"));
            for (int i = 0; i < people.length(); i++) {
                JSONObject person = people.getJSONObject(i);
                if (normalize(person.optString("phone")).equals(wanted)) return person.optString("name");
            }
        } catch (Exception ignored) {}
        return "";
    }

    private String normalize(String number) {
        String digits = number == null ? "" : number.replaceAll("\\D", "");
        return digits.length() > 10 ? digits.substring(digits.length() - 10) : digits;
    }

    private void announce(String name, String number) {
        String who = !name.isBlank() ? name : (!number.isBlank() ? number : "an unknown number");
        final TextToSpeech[] holder = new TextToSpeech[1];
        holder[0] = new TextToSpeech(getApplicationContext(), status -> {
            if (status == TextToSpeech.SUCCESS) {
                holder[0].setLanguage(Locale.US);
                holder[0].setSpeechRate(0.92f);
                holder[0].speak("Incoming call from " + who, TextToSpeech.QUEUE_FLUSH, null, "bigfoot-caller");
            }
        });
    }
}
