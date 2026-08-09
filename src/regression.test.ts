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

  it('sets a 7:30 PM alarm using 24-hour Android time', () => {
    const result = localAssistant('Set an alarm for 7:30 PM', freshState())
    expect(result.action).toEqual({ type: 'alarm', hour: 19, minute: 30, label: "Bigfoot's Day" })
  })

  it('keeps a separate spoken shopping list', () => {
    const state = freshState()
    const added = localAssistant('Add milk to my shopping list', state)
    expect(added.changes?.tasks?.[0].text).toBe('Shopping — milk')
    state.tasks = added.changes?.tasks || []
    expect(localAssistant('What is on my shopping list?', state).reply).toContain('milk')
  })

  it('opens maps, camera and phone settings through native actions', () => {
    expect(localAssistant('Directions to the pharmacy', freshState()).action).toEqual({ type: 'map', query: 'the pharmacy' })
    expect(localAssistant('Open camera', freshState()).action).toEqual({ type: 'camera' })
    expect(localAssistant('Open phone settings', freshState()).action).toEqual({ type: 'settings' })
  })

  it('calls only a person already saved by the user', () => {
    const state = freshState()
    state.people = [{ id: 'jane', name: 'Jane', phone: '5551234567', relationship: 'Daughter', favorite: true, updatedAt: new Date().toISOString() }]
    expect(localAssistant('Call Jane', state).action).toEqual({ type: 'call', phone: '5551234567' })
    expect(localAssistant('Call Someone Else', state).action).toBeUndefined()
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
})

describe('Android voice and setup safety contracts', () => {
  const java = readFileSync('android/app/src/main/java/com/bigfootsoftware/bigfootsday/CallAssistantPlugin.java', 'utf8')
  const app = readFileSync('src/App.tsx', 'utf8')
  const manifest = readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8')
  const nativeBridge = readFileSync('src/native.ts', 'utf8')
  const labels = readFileSync('android/app/src/main/res/values/strings.xml', 'utf8')

  it('uses in-app SpeechRecognizer instead of the external white-screen activity', () => {
    expect(java).toContain('SpeechRecognizer.createSpeechRecognizer')
    expect(java).toContain('SpeechRecognizer.createOnDeviceSpeechRecognizer')
    expect(java).toContain('SpeechRecognizer.isOnDeviceRecognitionAvailable')
    expect(java).not.toContain('startActivityForResult(call, intent, "speechResult")')
  })

  it('has a listening timeout and actionable error messages', () => {
    expect(java).toContain('postDelayed(voiceTimeout, 15000L)')
    expect(java).toContain('Microphone permission is required')
    expect(java).toContain('ERROR_RECOGNIZER_BUSY')
  })

  it('keeps the animated Bubba HUD visible during voice input', () => {
    expect(app).toContain('function VoiceHud')
    expect(app).toContain('The app will stay on this screen.')
  })

  it('keeps the eleven-step setup and voice pass/fail check', () => {
    expect(app).toContain('Setup step ${step + 1} of 11')
    expect(app).toContain("['Welcome', 'About you', 'Text size', 'Voice speed', 'Voice test', 'Reminders', 'Caller ID', 'Trusted helper', 'Connections', 'Learning', 'Ready']")
    expect(app).toContain("status: 'idle' | 'listening' | 'passed' | 'failed'")
  })

  it('does not graduate the voice lesson when listening fails', () => {
    expect(app).toContain('if (await talk()) advanceLearning()')
  })

  it('uses a calm UK speech profile with a US fallback', () => {
    expect(java).toContain('setLanguage(Locale.UK)')
    expect(java).toContain('setLanguage(Locale.US)')
    expect(java).toContain('setPitch(0.82f)')
    expect(java).toContain('slow ? 0.78f : 0.92f')
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

  it('provides native assistant tools without cloud setup', () => {
    expect(java).toContain('AlarmClock.ACTION_SET_TIMER')
    expect(java).toContain('AlarmClock.ACTION_SET_ALARM')
    expect(java).toContain('MediaStore.ACTION_IMAGE_CAPTURE')
    expect(java).toContain('Settings.ACTION_SETTINGS')
    expect(manifest).toContain('com.android.alarm.permission.SET_ALARM')
  })

  it('gives the repaired package a distinguishable home-screen label', () => {
    expect(labels).toContain('Bigfoot v0.9 Easy')
    expect(app).toContain("const appVersion = 'v0.9 EASY SETUP'")
  })

  it('does not permit cleartext network traffic', () => {
    expect(manifest).toContain('android:usesCleartextTraffic="false"')
  })
})
