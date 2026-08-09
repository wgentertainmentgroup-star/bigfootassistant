package com.bigfootsoftware.bigfootsday;

import android.os.Bundle;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(CallAssistantPlugin.class);
        super.onCreate(savedInstanceState);
        getWindow().setBackgroundDrawable(new ColorDrawable(Color.rgb(3, 11, 17)));
        keepInterfaceVisible();
    }

    @Override
    protected void onResume() {
        super.onResume();
        keepInterfaceVisible();
    }

    private void keepInterfaceVisible() {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        WebView webView = getBridge().getWebView();
        webView.setBackgroundColor(Color.rgb(3, 11, 17));
        webView.postDelayed(() -> webView.evaluateJavascript(
            "(function(){return !document.querySelector('.app,.setup-shell') && (!document.body || document.body.innerText.trim().length===0);})()",
            blank -> { if ("true".equals(blank)) webView.reload(); }
        ), 1200L);
    }
}
