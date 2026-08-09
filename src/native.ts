import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import type { Person } from './types'
import { LocalNotifications } from '@capacitor/local-notifications'

type CallAssistant = {
  requestHomeShortcut(): Promise<{ requested: boolean }>
  startVoiceInput(): Promise<{ text: string; error?: string }>
  speakText(options: { text: string; slow: boolean }): Promise<{ spoken: boolean; error?: string }>
  openChatGPT(): Promise<{ opened: boolean }>
  setTimer(options: { seconds: number; label: string }): Promise<{ opened: boolean }>
  setAlarm(options: { hour: number; minute: number; label: string }): Promise<{ opened: boolean }>
  openMap(options: { query: string }): Promise<{ opened: boolean }>
  openCamera(): Promise<{ opened: boolean }>
  openVideoCamera(): Promise<{ opened: boolean }>
  openDeviceSettings(): Promise<{ opened: boolean }>
  requestCallerIdAccess(): Promise<{ granted: boolean }>
  getLastCaller(): Promise<{ number: string; name: string; time: number }>
  setKnownPeople(options: { people: Array<{ name: string; phone: string }> }): Promise<void>
  addListener(eventName: 'voiceState', listener: (event: NativeVoiceState) => void): Promise<PluginListenerHandle>
}

const CallAssistantPlugin = registerPlugin<CallAssistant>('CallAssistant')

export const isAndroid = () => Capacitor.getPlatform() === 'android'
export const isAndroidDevice = () => isAndroid() || (typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent))

export async function requestHomeShortcut() {
  if (!isAndroid()) return false
  try { return (await CallAssistantPlugin.requestHomeShortcut()).requested } catch { return false }
}

export type VoiceInputResult = { text: string; error: string }
export type NativeVoiceState = { state: 'idle' | 'starting' | 'listening' | 'hearing' | 'processing' | 'complete'; message?: string; level?: number }

export async function addVoiceStateListener(listener: (event: NativeVoiceState) => void): Promise<PluginListenerHandle> {
  if (!isAndroid()) return { remove: async () => undefined }
  return CallAssistantPlugin.addListener('voiceState', listener)
}

export async function requestVoiceInput(): Promise<VoiceInputResult> {
  if (!isAndroid()) return { text: '', error: 'not-android' }
  try {
    const result = await CallAssistantPlugin.startVoiceInput()
    return { text: result.text || '', error: result.error || '' }
  } catch (error) {
    return { text: '', error: error instanceof Error ? error.message : 'voice-error' }
  }
}

export async function speakNative(text: string, slow = false) {
  if (!isAndroid()) return false
  try { return (await CallAssistantPlugin.speakText({ text, slow })).spoken } catch { return false }
}

export async function openChatGPT() {
  if (!isAndroid()) {
    window.open('https://chatgpt.com/', '_blank', 'noopener,noreferrer')
    return true
  }
  try { return (await CallAssistantPlugin.openChatGPT()).opened } catch { return false }
}

async function openNativeAction(action: () => Promise<{ opened: boolean }>) {
  if (!isAndroid()) return false
  try { return (await action()).opened } catch { return false }
}

export const setDeviceTimer = (seconds: number, label = "Bubba's timer") =>
  openNativeAction(() => CallAssistantPlugin.setTimer({ seconds, label }))

export const setDeviceAlarm = (hour: number, minute: number, label = "Bigfoot's Day alarm") =>
  openNativeAction(() => CallAssistantPlugin.setAlarm({ hour, minute, label }))

export const openMapSearch = (query: string) =>
  openNativeAction(() => CallAssistantPlugin.openMap({ query }))

export const openCamera = () => openNativeAction(() => CallAssistantPlugin.openCamera())
export const openVideoCamera = () => openNativeAction(() => CallAssistantPlugin.openVideoCamera())
export const openDeviceSettings = () => openNativeAction(() => CallAssistantPlugin.openDeviceSettings())

export async function requestCallerIdAccess() {
  if (!isAndroid()) return false
  try { return (await CallAssistantPlugin.requestCallerIdAccess()).granted } catch { return false }
}

export async function getLastCaller() {
  if (!isAndroid()) return null
  try { return await CallAssistantPlugin.getLastCaller() } catch { return null }
}

export async function syncPeopleForCallerId(people: Person[]) {
  if (!isAndroid()) return
  try { await CallAssistantPlugin.setKnownPeople({ people: people.map(({ name, phone }) => ({ name, phone })) }) } catch { /* Caller ID is optional. */ }
}

export async function scheduleReminder(id: number, title: string, body: string, when: Date) {
  if (!isAndroid()) return
  const permission = await LocalNotifications.requestPermissions()
  if (permission.display !== 'granted') return
  await LocalNotifications.schedule({ notifications: [{ id, title, body, schedule: { at: when }, smallIcon: 'ic_stat_icon_config_sample' }] })
}

export async function requestNotificationAccess() {
  if (!isAndroid()) return true
  try {
    const permission = await LocalNotifications.requestPermissions()
    return permission.display === 'granted'
  } catch {
    return false
  }
}
