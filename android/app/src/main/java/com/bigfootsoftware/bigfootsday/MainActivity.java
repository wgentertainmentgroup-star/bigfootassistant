package com.bigfootsoftware.bigfootsday;

import android.os.Bundle;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private LinearLayout voiceSafetyPanel;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(CallAssistantPlugin.class);
        super.onCreate(savedInstanceState);
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
            "(function(){return !document.querySelector('.app,.setup-shell') && (!document.body || document.body.innerText.trim().length===0);})()",
            blank -> { if ("true".equals(blank)) webView.reload(); }
        ), 1200L);
    }

    public void showVoiceSafetyPanel(Runnable stopAction) {
        runOnUiThread(() -> {
            hideVoiceSafetyPanel();
            LinearLayout panel = new LinearLayout(this);
            panel.setOrientation(LinearLayout.VERTICAL);
            panel.setGravity(Gravity.CENTER);
            panel.setPadding(dp(18), dp(14), dp(18), dp(14));
            panel.setBackgroundColor(Color.rgb(11, 74, 91));
            panel.setElevation(dp(18));
            panel.setContentDescription("Bubba voice safety controls");

            TextView status = new TextView(this);
            status.setText("BUBBA IS LISTENING — YOUR LESSON IS STILL OPEN");
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
            stop.setContentDescription("Stop Bubba voice and return to the lesson");
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
            // Reloading restores React's safe Today route while preserving saved data.
            webView.reload();
        });
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
