export type Section = 'home' | 'assistant' | 'email' | 'tasks' | 'calendar' | 'people' | 'notes' | 'settings'

export type EmailMessage = {
  id: string
  threadId: string
  from: string
  fromEmail: string
  subject: string
  snippet: string
  date: string
  unread: boolean
  messageId?: string
}

export type Task = {
  id: string
  text: string
  due: string
  done: boolean
  important: boolean
  updatedAt: string
  deleted?: boolean
}

export type GoogleTask = {
  id: string
  title: string
  due?: string
  status: 'needsAction' | 'completed'
  updated?: string
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
  slowVoice: boolean
  largeText: boolean
  highContrast: boolean
  trustedHelperName: string
  trustedHelperPhone: string
  apiBase: string
  companionToken: string
  autoSync: boolean
  taskSource: 'phone' | 'google'
  setupComplete: boolean
  learningStep: number
}

export type AppState = {
  tasks: Task[]
  people: Person[]
  notes: Note[]
  chat: ChatMessage[]
  preferences: Preferences
}
