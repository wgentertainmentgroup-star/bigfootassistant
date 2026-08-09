package com.bigfootsoftware.bigfootsday;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.Manifest;
import android.content.pm.PackageManager;
import androidx.lifecycle.Lifecycle;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.By;
import androidx.test.uiautomator.UiDevice;
import androidx.test.uiautomator.UiObject2;
import androidx.test.uiautomator.Until;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.regex.Pattern;
import org.junit.FixMethodOrder;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.junit.runners.MethodSorters;

@RunWith(AndroidJUnit4.class)
@FixMethodOrder(MethodSorters.NAME_ASCENDING)
public class MainActivityRegressionTest {
    @Test
    public void a_firstLessonHandlesTheRealAndroidMicrophonePermissionPrompt() throws Exception {
        assertEquals(
            "The first device test must begin without microphone permission",
            PackageManager.PERMISSION_DENIED,
            InstrumentationRegistry.getInstrumentation().getTargetContext().checkSelfPermission(Manifest.permission.RECORD_AUDIO)
        );
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            resetToFreshInstall(scenario);
            completeSetup(scenario);
            assertTrue(clickByText(scenario, "Practice talking"));

            UiDevice device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
            assertTrue(
                "Android microphone permission dialog must open on a fresh install",
                device.wait(Until.hasObject(By.pkg(Pattern.compile(".*permissioncontroller.*"))), 10000L)
            );
            UiObject2 allow = findPermissionAllowButton(device);
            assertNotNull("Android microphone permission prompt must appear on a fresh install", allow);
            allow.click();
            device.waitForIdle();

            assertTrue(waitForJavascript(scenario, "Boolean(document.querySelector('.assistant-page'))", "true"));
            Thread.sleep(1800L);
            assertHealthyBigfootPage(scenario);
            assertEquals("Returning from microphone permission must restore Bigfoot", Lifecycle.State.RESUMED, scenario.getState());
        }
    }

    @Test
    public void b_freshInstallCompletesEverySetupScreenWithoutLeavingTheApp() throws Exception {
        grantMicrophonePermission();
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            resetToFreshInstall(scenario);
            completeSetup(scenario);
            assertTrue(waitForJavascript(scenario, "document.body.innerText.includes('Lesson 1: Talk to Bubba')", "true"));
            assertHealthyBigfootPage(scenario);
            assertEquals("Setup finish must not launch Samsung shortcut UI", Lifecycle.State.RESUMED, scenario.getState());
        }
    }

    @Test
    public void c_actualFirstLessonButtonStartsVoiceWithoutAWhiteScreen() throws Exception {
        grantMicrophonePermission();
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            resetToFreshInstall(scenario);
            completeSetup(scenario);
            assertTrue(clickByText(scenario, "Practice talking"));
            assertTrue(waitForJavascript(scenario, "Boolean(document.querySelector('.assistant-page'))", "true"));
            Thread.sleep(2200L);
            assertHealthyBigfootPage(scenario);
            assertEquals("The real first lesson must keep MainActivity resumed", Lifecycle.State.RESUMED, scenario.getState());
        }
    }

    @Test
    public void d_coreUserJourneyAddsAndPersistsTasksPeopleAndNotes() throws Exception {
        grantMicrophonePermission();
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            resetToFreshInstall(scenario);
            completeSetup(scenario);
            assertTrue(waitForJavascript(scenario, "document.body.innerText.includes('Photo Camera') && document.body.innerText.includes('Video Camera')", "true"));

            assertTrue(clickByText(scenario, "My List"));
            setFieldAndSubmit(scenario, "Example: Call the doctor", "End-to-end doctor task", ".add-form");
            assertTrue(waitForJavascript(scenario, "document.body.innerText.includes('End-to-end doctor task')", "true"));

            assertTrue(clickByText(scenario, "People"));
            setField(scenario, "Jane Smith", "Test Helper");
            setField(scenario, "(555) 123-4567", "5551239876");
            setField(scenario, "Daughter, doctor…", "Family");
            submit(scenario, ".add-form");
            assertTrue(waitForJavascript(scenario, "document.body.innerText.includes('Test Helper')", "true"));

            assertTrue(clickByText(scenario, "Notes"));
            setFieldAndSubmit(scenario, "Write a note…", "End-to-end saved note", ".note-form");
            assertTrue(waitForJavascript(scenario, "document.body.innerText.includes('End-to-end saved note')", "true"));

            assertTrue(clickByText(scenario, "Settings"));
            assertTrue(waitForJavascript(scenario, "document.body.innerText.includes('Easy to see & hear')", "true"));
            assertTrue(clickByText(scenario, "Today"));
            assertHealthyBigfootPage(scenario);

            Thread.sleep(900L);
            assertTrue(waitForJavascript(scenario, "localStorage.getItem('bigfoots-day-state-v1').includes('End-to-end doctor task')", "true"));
            scenario.recreate();
            assertTrue(waitForJavascript(scenario, "document.body.innerText.includes('Bigfoot')", "true"));
            assertTrue(waitForJavascript(scenario, "localStorage.getItem('bigfoots-day-state-v1').includes('End-to-end saved note')", "true"));
            assertTrue(waitForJavascript(scenario, "localStorage.getItem('bigfoots-day-state-v1').includes('Test Helper')", "true"));
            assertHealthyBigfootPage(scenario);
        }
    }

    private void completeSetup(ActivityScenario<MainActivity> scenario) throws Exception {
        assertTrue(waitForJavascript(scenario, "document.body.innerText.includes('Step 1 of 11')", "true"));
        for (int nextStep = 2; nextStep <= 11; nextStep++) {
            assertTrue("Could not continue to setup step " + nextStep, clickSelector(scenario, ".setup-next"));
            assertTrue("Setup step " + nextStep + " did not render", waitForJavascript(scenario, "document.body.innerText.includes('Step " + nextStep + " of 11')", "true"));
        }
        assertTrue("Could not finish setup", clickSelector(scenario, ".setup-next.finish"));
    }

    private void resetToFreshInstall(ActivityScenario<MainActivity> scenario) throws Exception {
        assertTrue(waitForJavascript(scenario, "Boolean(document.body)", "true"));
        evaluate(scenario, "localStorage.clear(); location.reload(); 'reset'");
        assertTrue(waitForJavascript(scenario, "document.body.innerText.includes('Step 1 of 11')", "true"));
    }

    private void assertHealthyBigfootPage(ActivityScenario<MainActivity> scenario) throws Exception {
        String script = "Boolean(document.querySelector('.app,.setup-shell')) && document.body.innerText.trim().length > 30 && getComputedStyle(document.documentElement).backgroundColor !== 'rgb(255, 255, 255)'";
        assertTrue("Bigfoot rendered a blank or white page", waitForJavascript(scenario, script, "true"));
        scenario.onActivity(activity -> {
            assertNotNull(activity.getBridge());
            assertNotNull(activity.getBridge().getWebView());
            assertTrue(activity.getBridge().getWebView().getVisibility() == android.view.View.VISIBLE);
        });
    }

    private boolean clickSelector(ActivityScenario<MainActivity> scenario, String selector) throws Exception {
        return "true".equals(evaluate(scenario, "(function(){var e=document.querySelector('" + selector + "');if(!e)return false;e.click();return true;})()"));
    }

    private boolean clickByText(ActivityScenario<MainActivity> scenario, String text) throws Exception {
        String escaped = text.replace("'", "\\'");
        String script = "(function(){var e=Array.from(document.querySelectorAll('button')).find(function(x){return x.innerText.includes('" + escaped + "')});if(!e)return false;e.click();return true;})()";
        return "true".equals(evaluate(scenario, script));
    }

    private void setField(ActivityScenario<MainActivity> scenario, String placeholder, String value) throws Exception {
        String script = "(function(){var e=document.querySelector('[placeholder=\"" + placeholder + "\"]');if(!e)return false;var p=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(e,'" + value + "');e.dispatchEvent(new Event('input',{bubbles:true}));return true;})()";
        assertEquals("true", evaluate(scenario, script));
    }

    private void setFieldAndSubmit(ActivityScenario<MainActivity> scenario, String placeholder, String value, String form) throws Exception {
        setField(scenario, placeholder, value);
        submit(scenario, form);
    }

    private void submit(ActivityScenario<MainActivity> scenario, String selector) throws Exception {
        String script = "(function(){var f=document.querySelector('" + selector + "');if(!f)return false;f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));return true;})()";
        assertEquals("true", evaluate(scenario, script));
    }

    private void grantMicrophonePermission() {
        try {
            InstrumentationRegistry.getInstrumentation().getUiAutomation().grantRuntimePermission(targetPackage(), Manifest.permission.RECORD_AUDIO);
        } catch (Exception ignored) {}
    }

    private UiObject2 findPermissionAllowButton(UiDevice device) {
        String[] controllers = {
            "com.google.android.permissioncontroller",
            "com.android.permissioncontroller",
            "com.samsung.android.permissioncontroller"
        };
        String[] allowIds = {
            "permission_allow_foreground_only_button",
            "permission_allow_one_time_button",
            "permission_allow_button"
        };
        for (String controller : controllers) {
            for (String id : allowIds) {
                UiObject2 button = device.findObject(By.res(controller + ":id/" + id));
                if (button != null) return button;
            }
        }
        for (UiObject2 candidate : device.findObjects(By.clickable(true))) {
            String text = candidate.getText();
            if (text == null) continue;
            String normalized = text.toLowerCase();
            if (normalized.contains("while using") || normalized.contains("only this time") || normalized.equals("allow")) {
                return candidate;
            }
        }
        return null;
    }

    private String targetPackage() {
        return InstrumentationRegistry.getInstrumentation().getTargetContext().getPackageName();
    }

    private boolean waitForJavascript(ActivityScenario<MainActivity> scenario, String script, String expected) throws Exception {
        for (int attempt = 0; attempt < 30; attempt++) {
            if (expected.equals(evaluate(scenario, script))) return true;
            Thread.sleep(350L);
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
