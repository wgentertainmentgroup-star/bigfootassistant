export type Section = 'home' | 'assistant' | 'tasks' | 'people' | 'notes' | 'settings'

export type Task = {
  id: string
  text: string
  due: string
  done: boolean
  important: boolean
  updatedAt: string
  deleted?: boolean
}

export type Person = {
  id: string
  name: string
  phone: string
  relationship: string
  favorite: boolean
  updatedAt: string
  deleted?: boolean
}

export type Note = { id: string; text: string; createdAt: string; updatedAt: string; deleted?: boolean }

export type ChatMessage = { role: 'user' | 'assistant'; text: string }

export type Preferences = {
  userName: string
  assistantName: string
  voice: boolean
  largeText: boolean
  highContrast: boolean
  apiBase: string
  companionToken: string
  autoSync: boolean
  setupComplete: boolean
}

export type AppState = {
  tasks: Task[]
  people: Person[]
  notes: Note[]
  chat: ChatMessage[]
  preferences: Preferences
}
