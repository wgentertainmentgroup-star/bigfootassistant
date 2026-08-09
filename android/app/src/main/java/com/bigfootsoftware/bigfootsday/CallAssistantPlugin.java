package com.bigfootsoftware.bigfootsday;

import android.Manifest;
import android.app.role.RoleManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ShortcutInfo;
import android.content.pm.ShortcutManager;
import android.graphics.drawable.Icon;
import android.os.Build;
import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import org.json.JSONArray;
import org.json.JSONObject;

@CapacitorPlugin(
    name = "CallAssistant",
    permissions = { @Permission(alias = "contacts", strings = { Manifest.permission.READ_CONTACTS }) }
)
public class CallAssistantPlugin extends Plugin {
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
