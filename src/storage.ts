import type { AppState } from './types'

const KEY = 'bigfoots-day-state-v1'
const serviceBase = (import.meta.env.VITE_BIGFOOT_API_BASE || '').trim().replace(/\/$/, '')
const appToken = (import.meta.env.VITE_BIGFOOT_APP_TOKEN || '').trim()

export const defaultState: AppState = {
  tasks: [
    { id: 'welcome-task', text: 'Take a minute to set up Bigfoot\'s Day', due: new Date().toISOString().slice(0, 10), done: false, important: true, updatedAt: new Date().toISOString() },
  ],
  people: [],
  notes: [],
  chat: [
    { role: 'assistant', text: "Hi. I’m Bubba, your Bigfoot’s Day assistant. Tell me what you need, or tap one of the big buttons below." },
  ],
  preferences: {
    userName: 'Bryan',
    assistantName: 'Bubba',
    voice: true,
    slowVoice: true,
    largeText: true,
    highContrast: false,
    trustedHelperName: '',
    trustedHelperPhone: '',
    apiBase: serviceBase,
    companionToken: appToken,
    autoSync: Boolean(serviceBase),
    setupComplete: false,
    learningStep: 0,
  },
}

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return defaultState
    const parsed = JSON.parse(raw) as AppState
    const stamp = new Date(0).toISOString()
    return {
      ...defaultState,
      ...parsed,
      tasks: (parsed.tasks || []).map(t => ({ ...t, updatedAt: t.updatedAt || stamp })),
      people: (parsed.people || []).map(p => ({ ...p, updatedAt: p.updatedAt || stamp })),
      notes: (parsed.notes || []).map(n => ({ ...n, updatedAt: n.updatedAt || n.createdAt || stamp })),
      preferences: {
        ...defaultState.preferences,
        ...parsed.preferences,
        assistantName: !parsed.preferences?.assistantName || parsed.preferences.assistantName === 'Scout' ? 'Bubba' : parsed.preferences.assistantName,
        apiBase: serviceBase || parsed.preferences?.apiBase || '',
        companionToken: appToken || parsed.preferences?.companionToken || '',
      },
    }
  } catch {
    return defaultState
  }
}

export function saveState(state: AppState) {
  localStorage.setItem(KEY, JSON.stringify(state))
}
