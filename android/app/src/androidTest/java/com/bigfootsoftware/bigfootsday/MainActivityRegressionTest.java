package com.bigfootsoftware.bigfootsday;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.Manifest;
import androidx.lifecycle.Lifecycle;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class MainActivityRegressionTest {
    @Before
    public void grantMicrophonePermission() {
        String packageName = InstrumentationRegistry.getInstrumentation().getTargetContext().getPackageName();
        InstrumentationRegistry.getInstrumentation().getUiAutomation().grantRuntimePermission(packageName, Manifest.permission.RECORD_AUDIO);
    }

    @Test
    public void appLaunchesAndRendersTheVersionedInterface() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> {
                assertNotNull(activity.getBridge());
                assertNotNull(activity.getBridge().getWebView());
                assertTrue(activity.getBridge().getWebView().getVisibility() == android.view.View.VISIBLE);
            });
            assertTrue(waitForJavascript(scenario, "document.body && document.body.innerText.includes('Bigfoot')", "true"));
            assertEquals(Lifecycle.State.RESUMED, scenario.getState());
        }
    }

    @Test
    public void voiceRequestKeepsBigfootActivityVisibleAndResumed() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            assertTrue(waitForJavascript(scenario, "Boolean(window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CallAssistant)", "true"));
            evaluate(scenario, "window.Capacitor.Plugins.CallAssistant.startVoiceInput().catch(function(){ return null; }); 'started'");
            Thread.sleep(1800L);
            assertEquals("Voice input must not launch a white external activity", Lifecycle.State.RESUMED, scenario.getState());
            scenario.onActivity(activity -> assertTrue(activity.getBridge().getWebView().getVisibility() == android.view.View.VISIBLE));
        }
    }

    private boolean waitForJavascript(ActivityScenario<MainActivity> scenario, String script, String expected) throws Exception {
        for (int attempt = 0; attempt < 20; attempt++) {
            if (expected.equals(evaluate(scenario, script))) return true;
            Thread.sleep(500L);
        }
        return false;
    }

    private String evaluate(ActivityScenario<MainActivity> scenario, String script) throws Exception {
        CountDownLatch latch = new CountDownLatch(1);
        AtomicReference<String> value = new AtomicReference<>("");
        scenario.onActivity(activity -> activity.getBridge().getWebView().evaluateJavascript(script, result -> {
            value.set(result == null ? "" : result.replace("\"", ""));
            latch.countDown();
        }));
        assertTrue("JavaScript evaluation timed out", latch.await(5, TimeUnit.SECONDS));
        return value.get();
    }
}
