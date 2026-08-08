import { Capacitor, registerPlugin } from '@capacitor/core'
import type { Person } from './types'
import { LocalNotifications } from '@capacitor/local-notifications'

type CallAssistant = {
  requestCallerIdAccess(): Promise<{ granted: boolean }>
  getLastCaller(): Promise<{ number: string; name: string; time: number }>
  setKnownPeople(options: { people: Array<{ name: string; phone: string }> }): Promise<void>
}

const CallAssistantPlugin = registerPlugin<CallAssistant>('CallAssistant')

export const isAndroid = () => Capacitor.getPlatform() === 'android'

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
