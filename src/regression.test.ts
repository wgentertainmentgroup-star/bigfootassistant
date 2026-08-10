import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { localAssistant } from './App'
import { defaultState, loadState, saveState } from './storage'
import type { AppState } from './types'

function freshState(): AppState {
  return JSON.parse(JSON.stringify(defaultState)) as AppState
}

describe('Bubba local assistant regression suite', () => {
  it('adds a spoken task to the list', () => {
    const state = freshState()
    const result = localAssistant('Add call the doctor to my list', state)
    expect(result.reply).toContain('call the doctor')
    expect(result.changes?.tasks?.[0].text).toBe('call the doctor')
  })

  it('saves a spoken note', () => {
    const state = freshState()
    const result = localAssistant('Save a note that my appointment is Tuesday', state)
    expect(result.reply).toContain('I saved your note')
    expect(result.changes?.notes?.[0].text).toBe('my appointment is Tuesday')
  })

  it('marks an existing task complete', () => {
    const state = freshState()
    state.tasks = [{ id: 'doctor', text: 'Call the doctor', due: '', done: false, important: false, updatedAt: new Date().toISOString() }]
    const result = localAssistant('Mark call the doctor done', state)
    expect(result.changes?.tasks?.[0].done).toBe(true)
  })

  it('explains its offline capabilities', () => {
    const result = localAssistant('What can you do?', freshState())
    expect(result.reply).toContain('manage your day')
    expect(result.reply).toContain('timers and alarms')
  })

  it('sets a native ten-minute timer without a cloud account', () => {
    const result = localAssistant('Set a timer for 10 minutes', freshState())
    expect(result.action).toEqual({ type: 'timer', seconds: 600, label: "Bubba's timer" })
  })

  it('supports seconds and hours while safely capping an oversized timer', () => {
    expect(localAssistant('Set timer for 30 seconds', freshState()).action).toEqual({ type: 'timer', seconds: 30, label: "Bubba's timer" })
    expect(localAssistant('Set a timer for 2 hours', freshState()).action).toEqual({ type: 'timer', seconds: 7200, label: "Bubba's timer" })
    expect(localAssistant('Set a timer for 100 hours', freshState()).action).toEqual({ type: 'timer', seconds: 86399, label: "Bubba's timer" })
  })

  it('sets a 7:30 PM alarm using 24-hour Android time', () => {
    const result = localAssistant('Set an alarm for 7:30 PM', freshState())
    expect(result.action).toEqual({ type: 'alarm', hour: 19, minute: 30, label: "Bigfoot's Day" })
  })

  it('rejects an invalid alarm minute instead of opening Android Clock', () => {
    const result = localAssistant('Set an alarm for 7:99 PM', freshState())
    expect(result.action).toBeUndefined()
    expect(result.reply).toContain('not valid')
  })

  it('keeps a separate spoken shopping list', () => {
    const state = freshState()
    const added = localAssistant('Add milk to my shopping list', state)
    expect(added.changes?.tasks?.[0].text).toBe('Shopping — milk')
    state.tasks = added.changes?.tasks || []
    expect(localAssistant('What is on my shopping list?', state).reply).toContain('milk')
  })

  it('does not read completed or deleted shopping items', () => {
    const state = freshState()
    state.tasks = [
      { id: 'done', text: 'Shopping — bread', due: '', done: true, important: false, updatedAt: new Date().toISOString() },
      { id: 'deleted', text: 'Shopping — eggs', due: '', done: false, important: false, deleted: true, updatedAt: new Date().toISOString() },
    ]
    expect(localAssistant('What is on my shopping list?', state).reply).toContain('empty')
  })

  it('opens maps, camera and phone settings through native actions', () => {
    expect(localAssistant('Directions to the pharmacy', freshState()).action).toEqual({ type: 'map', query: 'the pharmacy' })
    expect(localAssistant('Open camera', freshState()).action).toEqual({ type: 'camera' })
    expect(localAssistant('Open phone settings', freshState()).action).toEqual({ type: 'settings' })
  })

  it('opens Samsung Camera in video mode from speech', () => {
    expect(localAssistant('Open video camera', freshState()).action).toEqual({ type: 'video' })
  })

  it('hands detailed questions to the installed ChatGPT app', () => {
    expect(localAssistant('Open ChatGPT', freshState()).action).toEqual({ type: 'chatgpt' })
  })

  it('calls only a person already saved by the user', () => {
    const state = freshState()
    state.people = [{ id: 'jane', name: 'Jane', phone: '5551234567', relationship: 'Daughter', favorite: true, updatedAt: new Date().toISOString() }]
    expect(localAssistant('Call Jane', state).action).toEqual({ type: 'call', phone: '5551234567' })
    expect(localAssistant('Call Someone Else', state).action).toBeUndefined()
  })

  it('does not complete a task that is not on the open list', () => {
    const result = localAssistant('Mark pick up medicine done', freshState())
    expect(result.changes).toBeUndefined()
    expect(result.reply).toContain('couldn’t find')
  })

  it('puts an important item first in the daily briefing', () => {
    const state = freshState()
    const stamp = new Date().toISOString()
    state.tasks = [
      { id: 'ordinary', text: 'Water plants', due: '', done: false, important: false, updatedAt: stamp },
      { id: 'important', text: 'Take medicine', due: '', done: false, important: true, updatedAt: stamp },
    ]
    expect(localAssistant('Manage my day', state).reply).toContain('1, Take medicine. 2, Water plants')
  })
})

describe('saved-state compatibility', () => {
  const memory = new Map<string, string>()
  beforeEach(() => {
    memory.clear()
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => memory.get(key) ?? null,
        setItem: (key: string, value: string) => memory.set(key, value),
      },
    })
  })

  it('migrates the old Scout name to Bubba without losing data', () => {
    const old = freshState()
    old.preferences.assistantName = 'Scout'
    old.notes = [{ id: 'keep', text: 'Keep this', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }]
    saveState(old)
    const restored = loadState()
    expect(restored.preferences.assistantName).toBe('Bubba')
    expect(restored.notes[0].text).toBe('Keep this')
  })

  it('adds senior-friendly defaults to an older saved profile', () => {
    const old = freshState()
    delete (old.preferences as unknown as Record<string, unknown>).slowVoice
    delete (old.preferences as unknown as Record<string, unknown>).trustedHelperName
    delete (old.preferences as unknown as Record<string, unknown>).trustedHelperPhone
    saveState(old)
    const restored = loadState()
    expect(restored.preferences.slowVoice).toBe(true)
    expect(restored.preferences.trustedHelperName).toBe('')
    expect(restored.preferences.trustedHelperPhone).toBe('')
  })

  it('recovers safely from corrupt saved data', () => {
    localStorage.setItem('bigfoots-day-state-v1', '{not-json')
    const restored = loadState()
    expect(restored.preferences.assistantName).toBe('Bubba')
    expect(restored.tasks[0].id).toBe('welcome-task')
  })
})

describe('Android voice and setup safety contracts', () => {
  const java = readFileSync('android/app/src/main/java/com/bigfootsoftware/bigfootsday/CallAssistantPlugin.java', 'utf8')
  const app = readFileSync('src/App.tsx', 'utf8')
  const manifest = readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8')
  const nativeBridge = readFileSync('src/native.ts', 'utf8')
  const labels = readFileSync('android/app/src/main/res/values/strings.xml', 'utf8')
  const activity = readFileSync('android/app/src/main/java/com/bigfootsoftware/bigfootsday/MainActivity.java', 'utf8')
  const androidE2E = readFileSync('android/app/src/androidTest/java/com/bigfootsoftware/bigfootsday/MainActivityRegressionTest.java', 'utf8')
  const workflow = readFileSync('.github/workflows/publish-test-apk-release.yml', 'utf8')
  const capacitor = readFileSync('capacitor.config.ts', 'utf8')
  const voice = readFileSync('src/voice.ts', 'utf8')
  const styles = readFileSync('src/styles.css', 'utf8')

  it('uses on-device-first SpeechRecognizer without launching an external speech activity', () => {
    expect(java).toContain('SpeechRecognizer.createOnDeviceSpeechRecognizer')
    expect(java).toContain('SpeechRecognizer.createSpeechRecognizer')
    expect(java).toContain('getContext().getApplicationContext()')
    expect(java).not.toContain('SpeechRecognizer.createSpeechRecognizer(getActivity())')
    expect(java).not.toContain('startActivityForResult(call, intent, "speechResult")')
    expect(manifest).toContain('android.speech.RecognitionService')
    expect(nativeBridge).toContain('/Android/i.test(navigator.userAgent)')
    expect(app).toContain('if (isAndroidDevice()) return new Promise')
    expect(app).toContain('void requestVoiceInput().then(finish)')
  })

  it('keeps Lesson 1 visible before and during microphone access', () => {
    expect(app).not.toContain("flushSync(() => setSection('assistant'))")
    expect(app).toContain("if (!state.preferences.apiBase.trim()) {\n      return startListening()")
    expect(app).toContain('This practice never opens another page')
    expect(app).not.toContain("localStorage.setItem(setupMarker, 'done'); void requestHomeShortcut()")
    expect(app).toContain('Add Icon to Home')
  })

  it('uses a separate Lesson 1 success path that cannot open the assistant page', () => {
    const start = app.indexOf('async function practiceLessonVoice()')
    const end = app.indexOf('async function stopListening()', start)
    const lessonVoice = app.slice(start, end)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    expect(lessonVoice).toContain("setSection('home')")
    expect(lessonVoice).toContain('Voice is working. Lesson two is ready.')
    expect(lessonVoice).not.toContain('askAssistant(')
    expect(app).toContain('const worked = await practiceTalk(); if (worked) advanceLearning()')
    expect(app).toContain('data-testid="assistant-home"')
  })

  it('uses a visible teal native fallback and can forcibly recover the WebView', () => {
    expect(activity).toContain('setBackgroundColor(Color.rgb(8, 54, 68))')
    expect(activity).toContain("document.querySelector('.app,.setup-shell')")
    expect(activity).toContain('webView.reload()')
    expect(activity).toContain('STOP AND RETURN')
    expect(activity).toContain('recoverAfterVoice()')
    expect(activity).toContain('public void onBackPressed()')
    expect(capacitor).toContain("backgroundColor: '#083644'")
    expect(capacitor).toContain('allowMixedContent: false')
  })

  it('has a listening timeout and actionable error messages', () => {
    expect(java).toContain('postDelayed(voiceTimeout, 9000L)')
    expect(app).toContain("}, 9000)")
    expect(app).toContain("}, 11000)")
    expect(java).toContain('Microphone permission is required')
    expect(java).toContain('ERROR_RECOGNIZER_BUSY')
  })

  it('uses the native Android voice safety panel and provides a tested escape path', () => {
    expect(app).toContain('function VoiceHud')
    expect(app).toContain('if (isAndroidDevice()) return null')
    expect(app).toContain('This lesson stays on screen. Listening stops automatically after 9 seconds.')
    expect(nativeBridge).toContain('cancelVoiceInput()')
    expect(java).toContain('public void cancelVoiceInput(PluginCall call)')
    expect(java).toContain('showVoiceSafetyPanel')
    expect(java).toContain('handleOnPause()')
    expect(app).toContain('data-testid="voice-cancel"')
    expect(androidE2E).toContain("!document.querySelector('[data-testid=voice-hud]')")
    expect(androidE2E).toContain('STOP AND RETURN')
    expect(androidE2E).toContain('Stopping voice must restore the app')
    expect(androidE2E).toContain('Android voice must never create a WebView cover')
    expect(styles).toContain('.voice-hud{position:fixed;left:16px;right:16px;bottom:18px')
    expect(styles).not.toContain('.voice-hud{position:fixed;inset:0')
  })

  it('keeps the eleven-step setup and voice pass/fail check', () => {
    expect(app).toContain('Setup step ${step + 1} of 11')
    expect(app).toContain("['Welcome', 'About you', 'Text size', 'Voice speed', 'Voice test', 'Reminders', 'Caller ID', 'Trusted helper', 'Connections', 'Learning', 'Ready']")
    expect(app).toContain("status: 'idle' | 'listening' | 'passed' | 'failed'")
  })

  it('keeps a failed voice lesson visible while providing a clear skip path', () => {
    expect(app).toContain('Lesson 1 is still here, and you can try again or skip it.')
    expect(app).toContain('data-testid="lesson-skip"')
    expect(app).toContain('Skip this lesson →')
  })

  it('provides five lessons and returns the customer home after practice actions', () => {
    expect(app).toContain('Lesson 1: Talk to Bubba')
    expect(app).toContain('Lesson 2: Use your list')
    expect(app).toContain('Lesson 3: Save a note')
    expect(app).toContain('Lesson 4: Find Camera & Video')
    expect(app).toContain('Lesson 5: Get detailed help')
    expect(app).toContain("go('home'); advanceLearning()")
    expect(app).toContain('Lesson {state.preferences.learningStep + 1} of 5')
    expect(androidE2E).toContain('newCustomerCanCompleteOrSkipEveryLesson')
    expect(androidE2E).toContain('completeSetupWithCustomerProfile')
    expect(androidE2E).toContain('The setup profile must appear on Today')
    expect(androidE2E).toContain('Lesson 2 must return home and advance')
    expect(androidE2E).toContain('Lesson 3 must return home and advance')
    expect(androidE2E).toContain('[data-testid=lessons-complete]')
  })

  it('uses a calm UK speech profile with a US fallback', () => {
    expect(java).toContain('setLanguage(Locale.UK)')
    expect(java).toContain('setLanguage(Locale.US)')
    expect(java).toContain('setPitch(0.82f)')
    expect(java).toContain('slow ? 0.78f : 0.92f')
  })

  it('never lets a stalled Android text-to-speech service block a lesson', () => {
    expect(voice).toContain('Promise.race([')
    expect(voice).toContain('speakNative(clean, slow)')
    expect(voice).toContain('window.setTimeout(() => resolve(false), 3500)')
  })

  it('requires confirmation before placing calls and supports one trusted helper', () => {
    expect(app).toContain('window.confirm(`Call ${name} at ${phone}?`)')
    expect(app).toContain('Call My Helper')
    expect(app).toContain('This button does not contact emergency services.')
  })

  it('preserves caller identification, contacts, and ChatGPT handoff', () => {
    expect(manifest).toContain('android.telecom.CallScreeningService')
    expect(manifest).toContain('android.permission.READ_CONTACTS')
    expect(java).toContain('ROLE_CALL_SCREENING')
    expect(java).toContain('com.openai.chatgpt')
  })

  it('preserves reminders and the home-screen shortcut', () => {
    expect(nativeBridge).toContain('LocalNotifications.schedule')
    expect(java).toContain('requestPinShortcut')
  })

  it('runs the real fresh-install setup and first-lesson buttons in Android', () => {
    expect(androidE2E).toContain('freshInstallCompletesEverySetupScreenWithoutLeavingTheApp')
    expect(androidE2E).toContain('actualFirstLessonButtonStartsVoiceWithoutCoveringTheApp')
    expect(androidE2E).toContain('firstLessonHandlesTheRealAndroidMicrophonePermissionPrompt')
    expect(androidE2E).toContain('successfulFirstLessonSpeechStaysOnTodayAndAdvances')
    expect(androidE2E).toContain('nativeStopAndReturnRecoversEvenIfTheWebLayerFails')
    expect(androidE2E).toContain('coreUserJourneyAddsAndPersistsTasksPeopleAndNotes')
    expect(androidE2E).toContain('location.reload()')
    expect(androidE2E).toContain('document.body.innerText.includes(\'Lesson 1: Talk to Bubba\')')
    expect(androidE2E).toContain('Bigfoot rendered a blank, white, or black page')
    expect(workflow).toContain(':app:connectedDebugAndroidTest')
    expect(workflow).toContain('Retry complete customer journey on a fresh emulator')
    expect(workflow).toContain('timeout 8s adb logcat')
  })

  it('provides native assistant tools without cloud setup', () => {
    expect(java).toContain('AlarmClock.ACTION_SET_TIMER')
    expect(java).toContain('AlarmClock.ACTION_SET_ALARM')
    expect(java).toContain('MediaStore.ACTION_IMAGE_CAPTURE')
    expect(java).toContain('MediaStore.ACTION_VIDEO_CAPTURE')
    expect(app).toContain('data-testid="camera-button"')
    expect(app).toContain('data-testid="video-button"')
    expect(app).toContain('<b>CAMERA</b>')
    expect(app).toContain('<b>VIDEO</b>')
    expect(androidE2E).toContain('[data-testid=camera-button]')
    expect(androidE2E).toContain('[data-testid=video-button]')
    expect(java).toContain('Settings.ACTION_SETTINGS')
    expect(manifest).toContain('com.android.alarm.permission.SET_ALARM')
  })

  it('gives the repaired package a distinguishable home-screen label', () => {
    expect(labels).toContain('Bigfoot v0.14 Lesson Fix')
    expect(app).toContain("const appVersion = 'v0.14 LESSON VOICE REPAIR'")
    expect(app).toContain("const setupMarker = 'bigfoots-day-easy-setup-v0140'")
    expect(styles).not.toContain('linear-gradient(145deg,#030b11')
  })

  it('does not permit cleartext network traffic', () => {
    expect(manifest).toContain('android:usesCleartextTraffic="false"')
  })
})
