package com.bigfootsoftware.bigfootsday;

import android.os.Bundle;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.provider.MediaStore;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import com.getcapacitor.BridgeActivity;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

public class MainActivity extends BridgeActivity {
    private LinearLayout voiceSafetyPanel;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(CallAssistantPlugin.class);
        super.onCreate(savedInstanceState);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        View content = findViewById(android.R.id.content);
        ViewCompat.setOnApplyWindowInsetsListener(content, (view, windowInsets) -> {
            Insets safe = windowInsets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
            );
            view.setPadding(safe.left, safe.top, safe.right, safe.bottom);
            return windowInsets;
        });
        ViewCompat.requestApplyInsets(content);
        // A visible teal fallback makes a WebView or speech-service failure obvious
        // and prevents the user from ever being stranded on a featureless black page.
        getWindow().setBackgroundDrawable(new ColorDrawable(Color.rgb(8, 54, 68)));
        keepInterfaceVisible();
    }

    @Override
    public void onResume() {
        super.onResume();
        keepInterfaceVisible();
    }

    private void keepInterfaceVisible() {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        WebView webView = getBridge().getWebView();
        webView.setVisibility(View.VISIBLE);
        webView.setBackgroundColor(Color.rgb(8, 54, 68));
        webView.bringToFront();
        if (voiceSafetyPanel != null) voiceSafetyPanel.bringToFront();
        webView.postDelayed(() -> webView.evaluateJavascript(
            "(function(){var blank=!document.querySelector('.app,.setup-shell')&&(!document.body||document.body.innerText.trim().length===0);if(!blank){var home=document.querySelector('.app .brand');if(home)home.click();}return blank;})()",
            blank -> { if ("true".equals(blank)) webView.reload(); }
        ), 1200L);
    }

    public void showVoiceSafetyPanel(String assistantName, Runnable stopAction) {
        runOnUiThread(() -> {
            hideVoiceSafetyPanel();
            String name = assistantName == null || assistantName.trim().isEmpty() ? "Bubba" : assistantName.trim();
            LinearLayout panel = new LinearLayout(this);
            panel.setOrientation(LinearLayout.VERTICAL);
            panel.setGravity(Gravity.CENTER);
            panel.setPadding(dp(18), dp(14), dp(18), dp(14));
            panel.setBackgroundColor(Color.rgb(11, 74, 91));
            panel.setElevation(dp(18));
            panel.setContentDescription(name + " voice safety controls");

            TextView status = new TextView(this);
            status.setText(name.toUpperCase(java.util.Locale.US) + " IS LISTENING — YOUR LESSON IS STILL OPEN");
            status.setTextColor(Color.WHITE);
            status.setTextSize(17f);
            status.setGravity(Gravity.CENTER);
            status.setPadding(0, 0, 0, dp(10));
            panel.addView(status, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ));

            Button stop = new Button(this);
            stop.setText("STOP AND RETURN");
            stop.setTextSize(19f);
            stop.setTextColor(Color.WHITE);
            stop.setBackgroundColor(Color.rgb(177, 48, 44));
            stop.setMinHeight(dp(62));
            stop.setContentDescription("Stop " + name + " voice and return to the lesson");
            stop.setOnClickListener(view -> {
                hideVoiceSafetyPanel();
                if (stopAction != null) stopAction.run();
                recoverAfterVoice();
            });
            panel.addView(stop, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ));

            FrameLayout.LayoutParams layout = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
                Gravity.BOTTOM
            );
            layout.setMargins(dp(12), dp(12), dp(12), dp(18));
            addContentView(panel, layout);
            voiceSafetyPanel = panel;
        });
    }

    public void hideVoiceSafetyPanel() {
        runOnUiThread(() -> {
            if (voiceSafetyPanel == null) return;
            ViewGroup parent = (ViewGroup) voiceSafetyPanel.getParent();
            if (parent != null) parent.removeView(voiceSafetyPanel);
            voiceSafetyPanel = null;
        });
    }

    public void recoverAfterVoice() {
        runOnUiThread(() -> {
            hideVoiceSafetyPanel();
            if (getBridge() == null || getBridge().getWebView() == null) return;
            WebView webView = getBridge().getWebView();
            webView.setVisibility(View.VISIBLE);
            webView.setBackgroundColor(Color.rgb(8, 54, 68));
            webView.bringToFront();
            // Keep the mounted page intact. Reload only when the document truly failed;
            // unconditional reloads caused a black transition on some Samsung WebViews.
            webView.evaluateJavascript(
                "(function(){var shell=document.querySelector('.app,.setup-shell');if(!shell||!document.body||document.body.innerText.trim().length===0)return 'reload';var home=document.querySelector('.brand');if(home)home.click();return 'ok';})()",
                result -> { if (result != null && result.contains("reload")) webView.reload(); }
            );
        });
    }

    public static boolean isCameraHardwareKey(int keyCode) {
        return keyCode == KeyEvent.KEYCODE_CAMERA
            || keyCode == KeyEvent.KEYCODE_HEADSETHOOK
            || keyCode == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE
            || keyCode == KeyEvent.KEYCODE_MEDIA_PLAY;
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (event.getAction() == KeyEvent.ACTION_UP && isCameraHardwareKey(event.getKeyCode())) {
            try {
                startActivity(new Intent(MediaStore.ACTION_IMAGE_CAPTURE));
                return true;
            } catch (Exception ignored) {
                // Let Android or the glasses companion app handle unsupported keys.
            }
        }
        return super.dispatchKeyEvent(event);
    }

    @Override
    public void onBackPressed() {
        if (voiceSafetyPanel != null) {
            recoverAfterVoice();
            return;
        }
        super.onBackPressed();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    @Override
    public void onDestroy() {
        hideVoiceSafetyPanel();
        super.onDestroy();
    }
}
