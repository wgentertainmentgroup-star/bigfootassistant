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
    expect(result.reply).toContain('save a note')
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
})

describe('Android voice and setup safety contracts', () => {
  const java = readFileSync('android/app/src/main/java/com/bigfootsoftware/bigfootsday/CallAssistantPlugin.java', 'utf8')
  const app = readFileSync('src/App.tsx', 'utf8')
  const manifest = readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8')

  it('uses in-app SpeechRecognizer instead of the external white-screen activity', () => {
    expect(java).toContain('SpeechRecognizer.createSpeechRecognizer')
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

  it('keeps the nine-step setup and voice pass/fail check', () => {
    expect(app).toContain('Setup step ${step + 1} of 9')
    expect(app).toContain("status: 'idle' | 'listening' | 'passed' | 'failed'")
  })

  it('does not permit cleartext network traffic', () => {
    expect(manifest).toContain('android:usesCleartextTraffic="false"')
  })
})
