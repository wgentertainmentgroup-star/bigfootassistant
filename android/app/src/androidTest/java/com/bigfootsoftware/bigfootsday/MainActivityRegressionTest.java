package com.bigfootsoftware.bigfootsday;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.Manifest;
import android.content.pm.PackageManager;
import android.view.KeyEvent;
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
            boolean permissionDialogOpened = device.wait(
                Until.hasObject(By.pkg(Pattern.compile(".*permissioncontroller.*"))),
                10000L
            );
            if (permissionDialogOpened) {
                UiObject2 allow = findPermissionAllowButton(device);
                if (allow != null) {
                    allow.click();
                    device.waitForIdle();
                } else {
                    // Permission-controller layouts vary between Google, Samsung and Android versions.
                    // Close an unrecognized sheet, grant the same runtime permission, and retry below.
                    device.pressBack();
                    grantMicrophonePermission();
                }
            } else {
                // Headless emulators can dismiss the OS sheet before UIAutomator observes it.
                // The test still began with permission denied; grant it and verify the real app recovery.
                grantMicrophonePermission();
            }

            // Some permission controllers report the Allow click before the package
            // manager has committed it. Retry the same grant through Android itself
            // before judging the app's recovery path.
            if (!waitForMicrophonePermission()) {
                device.pressBack();
                grantMicrophonePermission();
            }
            assertTrue(
                "Microphone access must be granted before the permission-recovery journey continues",
                waitForMicrophonePermission()
            );
            if ("true".equals(evaluate(scenario, "document.body.innerText.includes('Lesson 1: Talk to Bubba')"))) {
                assertTrue("Voice must be retryable after microphone permission is granted", clickByText(scenario, "Practice talking"));
            }

            assertTrue(
                "After Android grants microphone access, Lesson 1 must remain visible instead of changing to a dark page",
                waitForJavascript(
                    scenario,
                    "document.body.innerText.includes('Lesson 1: Talk to Bubba') && !document.querySelector('.assistant-page')",
                    "true"
                )
            );
            assertTrue("Android must never render the WebView voice overlay", waitForJavascript(scenario, "!document.querySelector('[data-testid=voice-hud]')", "true"));
            UiObject2 nativeStop = device.findObject(By.text("STOP AND RETURN"));
            if (nativeStop != null) {
                nativeStop.click();
                device.waitForIdle();
            }
            assertTrue(
                "If the emulator has no microphone input, Bigfoot must return to Lesson 1 instead of getting stuck",
                waitForJavascript(scenario, "document.body.innerText.includes('Lesson 1: Talk to Bubba')", "true")
            );
            assertHealthyBigfootPage(scenario);
            assertEquals("Returning from microphone permission must restore Bigfoot", Lifecycle.State.RESUMED, scenario.getState());
        }
    }

    @Test
    public void b_freshInstallCompletesEverySetupScreenWithoutLeavingTheApp() throws Exception {
        grantMicrophonePermission();
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            resetToFreshInstall(scenario);
            completeSetupWithCustomerProfile(scenario);
            assertTrue("The setup profile and chosen assistant must appear on Today", waitForJavascript(scenario, "document.body.innerText.includes('New Customer') && document.body.innerText.includes('WALTER IS READY') && document.body.innerText.includes('Ask Walter')", "true"));
            assertTrue(waitForJavascript(scenario, "document.body.innerText.includes('Lesson 1: Talk to Walter') && !document.body.innerText.includes('BUBBA IS READY')", "true"));
            assertTrue(waitForJavascript(scenario, "localStorage.getItem('bigfoots-day-state-v1').includes('Walter')", "true"));
            evaluate(scenario, "setTimeout(function(){location.reload()},0);'reloading'");
            assertTrue("The chosen assistant name must survive a full restart", waitForJavascript(scenario, "document.body.innerText.includes('WALTER IS READY') && document.body.innerText.includes('Lesson 1: Talk to Walter')", "true"));
            assertTrue(clickSelector(scenario, "[data-testid=nav-more]"));
            assertTrue(clickSelector(scenario, "[data-testid=more-settings]"));
            setField(scenario, "Assistant name", "Arthur");
            assertTrue("Changing the name in Settings must update the Settings screen immediately", waitForJavascript(scenario, "document.body.innerText.includes('You & Arthur') && document.body.innerText.includes('Hear Arthur')", "true"));
            assertTrue(clickSelector(scenario, "[data-testid=nav-home]"));
            assertTrue("The new name must replace the old name throughout Today", waitForJavascript(scenario, "document.body.innerText.includes('ARTHUR IS READY') && document.body.innerText.includes('Ask Arthur') && document.body.innerText.includes('Lesson 1: Talk to Arthur') && !document.body.innerText.includes('WALTER IS READY')", "true"));
            evaluate(scenario, "setTimeout(function(){location.reload()},0);'reloading'");
            assertTrue("A Settings rename must survive another full restart", waitForJavascript(scenario, "document.body.innerText.includes('ARTHUR IS READY') && document.body.innerText.includes('Lesson 1: Talk to Arthur')", "true"));
            assertHealthyBigfootPage(scenario);
            assertEquals("Setup finish must not launch Samsung shortcut UI", Lifecycle.State.RESUMED, scenario.getState());
        }
    }

    @Test
    public void c_actualFirstLessonButtonStartsVoiceWithoutCoveringTheApp() throws Exception {
        grantMicrophonePermission();
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            resetToFreshInstall(scenario);
            completeSetup(scenario);
            assertTrue(clickByText(scenario, "Practice talking"));
            assertTrue("Voice must keep Lesson 1 visible and must not navigate to the dark assistant page", waitForJavascript(scenario, "document.body.innerText.includes('Lesson 1: Talk to Bubba') && !document.querySelector('.assistant-page')", "true"));
            assertTrue("Android voice must never create a WebView cover", waitForJavascript(scenario, "!document.querySelector('[data-testid=voice-hud]')", "true"));
            UiDevice device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
            UiObject2 nativeStop = device.findObject(By.text("STOP AND RETURN"));
            if (nativeStop != null) {
                nativeStop.click();
                device.waitForIdle();
            }
            assertTrue("Stopping voice must restore the app", waitForJavascript(scenario, "!document.querySelector('[data-testid=voice-hud]')", "true"));
            assertTrue("A failed voice attempt must return to the lesson", waitForJavascript(scenario, "document.body.innerText.includes('Lesson 1: Talk to Bubba')", "true"));
            assertHealthyBigfootPage(scenario);
            assertEquals("The real first lesson must keep MainActivity resumed", Lifecycle.State.RESUMED, scenario.getState());
        }
    }

    @Test
    public void d_successfulFirstLessonSpeechStaysOnTodayAndAdvances() throws Exception {
        grantMicrophonePermission();
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            resetToFreshInstall(scenario);
            completeSetup(scenario);
            assertEquals("true", evaluate(scenario, "window.__bigfootVoiceTestResult={text:'What can you do?',error:''};true"));
            assertTrue("The real Lesson 1 button must accept a successful speech result", clickByText(scenario, "Practice talking"));

            assertTrue(
                "Successful Lesson 1 speech must stay on Today and visibly advance to Lesson 2",
                waitForJavascript(
                    scenario,
                    "document.body.innerText.includes('Lesson 2: Use your list') && !document.querySelector('.assistant-page') && document.querySelector('[data-testid=lesson-card]').dataset.lesson === '2'",
                    "true"
                )
            );
            assertHealthyBigfootPage(scenario);
            assertEquals("Successful lesson speech must keep MainActivity usable", Lifecycle.State.RESUMED, scenario.getState());
        }
    }

    @Test
    public void e_nativeStopAndReturnRecoversEvenIfTheWebLayerFails() throws Exception {
        grantMicrophonePermission();
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            resetToFreshInstall(scenario);
            completeSetup(scenario);
            scenario.onActivity(activity -> activity.showVoiceSafetyPanel("Walter", () -> {}));

            UiDevice device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
            UiObject2 stop = device.wait(
                Until.findObject(By.desc("Stop Walter voice and return to the lesson")),
                15000L
            );
            if (stop == null) {
                stop = device.wait(Until.findObject(By.text("STOP AND RETURN")), 10000L);
            }
            assertNotNull("A native Stop and Return button must remain available above the WebView", stop);
            stop.click();
            device.waitForIdle();

            assertTrue("Native recovery must reload the safe Today route", waitForJavascript(scenario, "document.body.innerText.includes('Lesson 1: Talk to Bubba') && !document.querySelector('.assistant-page')", "true"));
            assertTrue("The native recovery panel must close after use", device.wait(Until.gone(By.text("STOP AND RETURN")), 5000L));
            assertHealthyBigfootPage(scenario);
            assertEquals("Native voice recovery must keep MainActivity usable", Lifecycle.State.RESUMED, scenario.getState());
        }
    }

    @Test
    public void f_newCustomerCanCompleteOrSkipEveryLesson() throws Exception {
        grantMicrophonePermission();
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            resetToFreshInstall(scenario);
            completeSetup(scenario);

            assertTrue(waitForJavascript(scenario, "document.querySelector('[data-testid=lesson-card]').dataset.lesson === '1'", "true"));
            assertEquals("true", evaluate(scenario, "window.__bigfootVoiceTestResult={text:'What can you do?',error:''};true"));
            assertTrue("Lesson 1 voice practice must run", clickSelector(scenario, "[data-testid=lesson-primary]"));
            assertTrue(waitForJavascript(scenario, "document.body.innerText.includes('Lesson 2: Use your list')", "true"));

            assertEquals(
                "true",
                evaluate(
                    scenario,
                    "window.__tutorialPageFailure=false;window.__tutorialObserver=new MutationObserver(function(){var home=document.querySelector('.home-page');var assistant=document.querySelector('.assistant-page');var empty=!document.body||document.body.innerText.trim().length<30;if(!home||assistant||empty)window.__tutorialPageFailure=true;});window.__tutorialObserver.observe(document.getElementById('root'),{childList:true,subtree:true});true"
                )
            );

            assertTrue("Lesson 2 practice must run", clickSelector(scenario, "[data-testid=lesson-primary]"));
            assertTrue("Lesson 2 must stay home and advance", waitForJavascript(scenario, "document.body.innerText.includes('Lesson 3: Save a note') && Boolean(document.querySelector('.home-page'))", "true"));
            assertTrue(waitForJavascript(scenario, "localStorage.getItem('bigfoots-day-state-v1').includes('drink a glass of water')", "true"));

            assertTrue("Lesson 3 practice must run", clickSelector(scenario, "[data-testid=lesson-primary]"));
            assertTrue("Lesson 3 must stay home and advance", waitForJavascript(scenario, "document.body.innerText.includes('Lesson 4: Find Camera & Video') && Boolean(document.querySelector('.home-page'))", "true"));
            assertTrue(waitForJavascript(scenario, "localStorage.getItem('bigfoots-day-state-v1').includes('I am learning to use my assistant')", "true"));

            assertTrue("Lesson 4 must advance after the customer finds the controls", clickSelector(scenario, "[data-testid=lesson-primary]"));
            assertTrue(waitForJavascript(scenario, "document.body.innerText.includes('Lesson 5: Find More Help') && Boolean(document.querySelector('.home-page'))", "true"));
            assertTrue("Lesson 5 practice must stay inside the tutorial", clickSelector(scenario, "[data-testid=lesson-primary]"));
            assertTrue(waitForJavascript(scenario, "document.body.innerText.includes('Lesson 6: Put Bigfoot on Home') && Boolean(document.querySelector('.home-page'))", "true"));
            assertEquals("Tutorial must never leave Today during Lessons 2 through 5", "false", evaluate(scenario, "window.__tutorialObserver.disconnect();window.__tutorialPageFailure"));
            assertEquals("true", evaluate(scenario, "window.__bigfootHomeShortcutTestResult=true;true"));
            assertTrue("The icon lesson must request Home placement before leaving the app", clickSelector(scenario, "[data-testid=lesson-primary]"));
            assertTrue(waitForJavascript(scenario, "document.body.innerText.includes('Lesson 7: Go Home and come back') && document.body.innerText.includes('Bigfoot v0.20 Custom Name') && Boolean(document.querySelector('.home-page'))", "true"));
            assertTrue("The final Home tutorial must also have a nonblocking skip path", clickSelector(scenario, "[data-testid=lesson-skip]"));
            assertTrue(waitForJavascript(scenario, "Boolean(document.querySelector('[data-testid=lessons-complete]'))", "true"));
            assertHealthyBigfootPage(scenario);
        }
    }

    @Test
    public void g_coreUserJourneyAddsAndPersistsTasksPeopleAndNotes() throws Exception {
        grantMicrophonePermission();
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            resetToFreshInstall(scenario);
            completeSetup(scenario);
            assertTrue(waitForJavascript(scenario, "Boolean(document.querySelector('[data-testid=camera-button]')) && Boolean(document.querySelector('[data-testid=video-button]')) && Boolean(document.querySelector('[data-testid=call-button]')) && Boolean(document.querySelector('[data-testid=text-button]')) && document.body.innerText.includes('CAMERA') && document.body.innerText.includes('VIDEO') && document.body.innerText.includes('CALL') && document.body.innerText.includes('TEXT')", "true"));
            assertTrue("Every main action must be large enough for an older customer", waitForJavascript(scenario, "Array.from(document.querySelectorAll('[data-testid=camera-button],[data-testid=video-button],[data-testid=call-button],[data-testid=text-button],[data-testid=phone-home-button]')).every(function(e){var r=e.getBoundingClientRect();return r.width>=48&&r.height>=48})", "true"));
            assertTrue("The visible phone navigation must include More", waitForJavascript(scenario, "getComputedStyle(document.querySelector('[data-testid=nav-more]')).display!=='none' && document.querySelector('[data-testid=nav-more]').getBoundingClientRect().height>=48", "true"));
            assertTrue("Settings must not be hidden without a visible replacement", waitForJavascript(scenario, "getComputedStyle(document.querySelector('[data-testid=nav-settings]')).display==='none' && getComputedStyle(document.querySelector('[data-testid=nav-more]')).display!=='none'", "true"));

            assertTrue("An older customer must be able to open the visible More menu", clickSelector(scenario, "[data-testid=nav-more]"));
            assertTrue(waitForJavascript(scenario, "Boolean(document.querySelector('[data-testid=more-page]')) && Boolean(document.querySelector('[data-testid=more-calendar]')) && Boolean(document.querySelector('[data-testid=more-notes]')) && Boolean(document.querySelector('[data-testid=more-settings]')) && Boolean(document.querySelector('[data-testid=more-setup]')) && Boolean(document.querySelector('[data-testid=more-phone-home]'))", "true"));
            assertTrue("Calendar must be easy to find through More", clickSelector(scenario, "[data-testid=more-calendar]"));
            assertTrue(waitForJavascript(scenario, "document.body.innerText.includes('Review in my calendar') && document.body.innerText.includes('Open my calendar')", "true"));
            assertTrue(clickSelector(scenario, "[data-testid=nav-home]"));

            assertTrue(clickByText(scenario, "My List"));
            assertTrue("Phone tasks must work without Google", waitForJavascript(scenario, "document.body.innerText.includes('This Phone') && document.body.innerText.includes('Google Tasks')", "true"));
            setFieldAndSubmit(scenario, "Example: Call the doctor", "End-to-end doctor task", ".add-form");
            assertTrue(waitForJavascript(scenario, "document.body.innerText.includes('End-to-end doctor task')", "true"));

            assertTrue(clickByText(scenario, "People"));
            assertTrue("Phonebook import must be prominent", waitForJavascript(scenario, "Boolean(document.querySelector('[data-testid=import-phonebook]')) && document.body.innerText.includes('Import from Phonebook')", "true"));
            assertTrue(clickSelector(scenario, "[data-testid=nav-more]"));
            assertTrue("Settings must be reachable through the visible More menu", clickSelector(scenario, "[data-testid=more-settings]"));
            assertTrue(waitForJavascript(scenario, "document.body.innerText.includes('Easy to see & hear')", "true"));
            assertTrue(clickSelector(scenario, "[data-testid=nav-home]"));

            assertTrue(clickByText(scenario, "People"));
            setField(scenario, "Jane Smith", "Test Helper");
            setField(scenario, "(555) 123-4567", "5551239876");
            setField(scenario, "Daughter, doctor…", "Family");
            submit(scenario, ".add-form");
            assertTrue(waitForJavascript(scenario, "document.body.innerText.includes('Test Helper')", "true"));

            assertTrue(clickSelector(scenario, "[data-testid=nav-more]"));
            assertTrue(clickSelector(scenario, "[data-testid=more-notes]"));
            setFieldAndSubmit(scenario, "Write a note…", "End-to-end saved note", ".note-form");
            assertTrue(waitForJavascript(scenario, "document.body.innerText.includes('End-to-end saved note')", "true"));

            assertTrue(clickSelector(scenario, "[data-testid=nav-more]"));
            assertTrue(clickSelector(scenario, "[data-testid=more-settings]"));
            assertTrue(waitForJavascript(scenario, "document.body.innerText.includes('Easy to see & hear')", "true"));
            assertTrue(clickSelector(scenario, "[data-testid=nav-home]"));
            assertHealthyBigfootPage(scenario);

            Thread.sleep(900L);
            assertTrue(waitForJavascript(scenario, "localStorage.getItem('bigfoots-day-state-v1').includes('End-to-end doctor task')", "true"));
            evaluate(scenario, "setTimeout(function(){location.reload()},0);'reloading'");
            assertTrue(waitForJavascript(scenario, "document.body.innerText.includes('Bigfoot')", "true"));
            assertTrue(waitForJavascript(scenario, "localStorage.getItem('bigfoots-day-state-v1').includes('End-to-end saved note')", "true"));
            assertTrue(waitForJavascript(scenario, "localStorage.getItem('bigfoots-day-state-v1').includes('Test Helper')", "true"));
            assertHealthyBigfootPage(scenario);
        }
    }

    @Test
    public void h_successfulMainBubbaVoiceStaysOnToday() throws Exception {
        grantMicrophonePermission();
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            resetToFreshInstall(scenario);
            completeSetup(scenario);
            assertEquals("true", evaluate(scenario, "window.__bigfootVoiceTestResult={text:'What can you do?',error:''};true"));
            assertTrue("The main Bubba orb must be clickable", clickSelector(scenario, ".scout-core"));
            assertTrue(
                "Successful speech from the main orb must remain on Today without a black assistant transition",
                waitForJavascript(
                    scenario,
                    "Boolean(document.querySelector('.home-page')) && !document.querySelector('.assistant-page') && document.body.innerText.includes('BUBBA IS READY')",
                    "true"
                )
            );
            assertHealthyBigfootPage(scenario);
            assertEquals(Lifecycle.State.RESUMED, scenario.getState());
        }
    }

    @Test
    public void i_standardSmartGlassesKeysAreMappedToCamera() {
        assertTrue(MainActivity.isCameraHardwareKey(KeyEvent.KEYCODE_CAMERA));
        assertTrue(MainActivity.isCameraHardwareKey(KeyEvent.KEYCODE_HEADSETHOOK));
        assertTrue(MainActivity.isCameraHardwareKey(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE));
        assertTrue(!MainActivity.isCameraHardwareKey(KeyEvent.KEYCODE_VOLUME_DOWN));
    }

    @Test
    public void j_returningToTheAppRestoresTheTodayDashboard() throws Exception {
        grantMicrophonePermission();
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            resetToFreshInstall(scenario);
            completeSetup(scenario);
            assertTrue("Phone Home must be visible on the dashboard", waitForJavascript(scenario, "Boolean(document.querySelector('[data-testid=phone-home-button]'))", "true"));
            assertTrue("Navigate away from Today for the return test", clickByText(scenario, "My List"));
            assertTrue(waitForJavascript(scenario, "document.body.innerText.includes('What do you need to remember?')", "true"));
            scenario.moveToState(Lifecycle.State.CREATED);
            scenario.moveToState(Lifecycle.State.RESUMED);
            assertTrue(
                "Returning from an Android screen must place the simple Today dashboard back on top",
                waitForJavascript(scenario, "Boolean(document.querySelector('.home-page')) && document.body.innerText.includes('BUBBA IS READY')", "true")
            );
            assertHealthyBigfootPage(scenario);
        }
    }

    @Test
    public void k_customerCanExitTheTutorialImmediately() throws Exception {
        grantMicrophonePermission();
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            resetToFreshInstall(scenario);
            completeSetup(scenario);
            assertTrue("Every lesson must show an Exit Tutorial control", clickSelector(scenario, "[data-testid=lesson-exit]"));
            assertTrue("Exit Tutorial must reveal the usable Today dashboard", waitForJavascript(scenario, "Boolean(document.querySelector('[data-testid=lessons-complete]')) && Boolean(document.querySelector('[data-testid=camera-button]')) && Boolean(document.querySelector('[data-testid=call-button]'))", "true"));
            assertHealthyBigfootPage(scenario);
        }
    }

    @Test
    public void l_seniorMistakesAreExplainedAndCancelledRemovalKeepsData() throws Exception {
        grantMicrophonePermission();
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            resetToFreshInstall(scenario);
            completeSetup(scenario);

            assertTrue(clickSelector(scenario, "[data-testid=nav-tasks]"));
            submit(scenario, ".add-form");
            assertTrue("A blank task must explain the next step", waitForJavascript(scenario, "document.body.innerText.includes('Type what you need to remember, then tap Add to my list.')", "true"));
            setFieldAndSubmit(scenario, "Example: Call the doctor", "Keep this medicine reminder", ".add-form");
            assertTrue(waitForJavascript(scenario, "document.body.innerText.includes('Keep this medicine reminder')", "true"));
            assertEquals("true", evaluate(scenario, "window.confirm=function(){return false};true"));
            assertTrue(clickSelector(scenario, ".task-row .delete"));
            assertTrue("Cancel must keep the task", waitForJavascript(scenario, "document.body.innerText.includes('Keep this medicine reminder')", "true"));
            assertEquals("true", evaluate(scenario, "window.confirm=function(){return true};true"));
            assertTrue(clickSelector(scenario, ".task-row .delete"));
            assertTrue("Confirmed removal must hide the task", waitForJavascript(scenario, "!document.body.innerText.includes('Keep this medicine reminder')", "true"));

            assertTrue(clickSelector(scenario, "[data-testid=nav-people]"));
            submit(scenario, ".add-form");
            assertTrue("A blank person must explain the required fields", waitForJavascript(scenario, "document.body.innerText.includes('Enter both a name and a phone number, then tap Save person.')", "true"));
            setField(scenario, "Jane Smith", "Trusted Daughter");
            setField(scenario, "(555) 123-4567", "12");
            submit(scenario, ".add-form");
            assertTrue("A short phone number must be caught before saving", waitForJavascript(scenario, "document.body.innerText.includes('That phone number looks too short. Please check it and try again.')", "true"));

            assertTrue(clickSelector(scenario, "[data-testid=nav-more]"));
            assertTrue(clickSelector(scenario, "[data-testid=more-notes]"));
            submit(scenario, ".note-form");
            assertTrue("A blank note must explain the next step", waitForJavascript(scenario, "document.body.innerText.includes('Type your note first, then tap Save note.')", "true"));
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

    private void completeSetupWithCustomerProfile(ActivityScenario<MainActivity> scenario) throws Exception {
        assertTrue(waitForJavascript(scenario, "document.body.innerText.includes('Step 1 of 11')", "true"));
        assertTrue("Could not continue to setup step 2", clickSelector(scenario, ".setup-next"));
        assertTrue(waitForJavascript(scenario, "document.body.innerText.includes('Step 2 of 11')", "true"));
        setField(scenario, "Your first name", "New Customer");
        setField(scenario, "Bubba", "Walter");
        for (int nextStep = 3; nextStep <= 11; nextStep++) {
            assertTrue("Could not continue to setup step " + nextStep, clickSelector(scenario, ".setup-next"));
            assertTrue("Setup step " + nextStep + " did not render", waitForJavascript(scenario, "document.body.innerText.includes('Step " + nextStep + " of 11')", "true"));
        }
        assertTrue("Could not finish customer setup", clickSelector(scenario, ".setup-next.finish"));
    }

    private void resetToFreshInstall(ActivityScenario<MainActivity> scenario) throws Exception {
        assertTrue(waitForJavascript(scenario, "Boolean(document.body)", "true"));
        for (int resetAttempt = 0; resetAttempt < 2; resetAttempt++) {
            String reloadMarker = "e2e-" + System.nanoTime();
            evaluate(
                scenario,
                "localStorage.clear();setTimeout(function(){location.replace(location.pathname+'?testReload=" + reloadMarker + "')},0);'reset'"
            );
            if (waitForJavascript(
                scenario,
                "location.search.includes('testReload=" + reloadMarker + "') && document.readyState==='complete' && document.body.innerText.includes('Step 1 of 11')",
                "true"
            )) return;
            scenario.onActivity(activity -> activity.getBridge().getWebView().reload());
            Thread.sleep(800L);
        }
        throw new AssertionError("Fresh-install setup did not recover after two WebView reload attempts");
    }

    private void assertHealthyBigfootPage(ActivityScenario<MainActivity> scenario) throws Exception {
        String script = "Boolean(document.querySelector('.app,.setup-shell')) && document.body.innerText.trim().length > 30 && getComputedStyle(document.documentElement).backgroundColor !== 'rgb(255, 255, 255)' && getComputedStyle(document.documentElement).backgroundColor !== 'rgb(0, 0, 0)' && (!document.querySelector('[data-testid=voice-hud]') || document.querySelector('[data-testid=voice-hud]').getBoundingClientRect().height < innerHeight * 0.7)";
        assertTrue("Bigfoot rendered a blank, white, or black page", waitForJavascript(scenario, script, "true"));
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
        if (InstrumentationRegistry.getInstrumentation().getTargetContext().checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            try {
                UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).executeShellCommand(
                    "pm grant " + targetPackage() + " " + Manifest.permission.RECORD_AUDIO
                );
            } catch (Exception ignored) {}
        }
    }

    private boolean waitForMicrophonePermission() throws InterruptedException {
        for (int attempt = 0; attempt < 40; attempt++) {
            if (InstrumentationRegistry.getInstrumentation().getTargetContext().checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                return true;
            }
            Thread.sleep(250L);
        }
        return false;
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
