type SpeechRecognitionLike = {
  lang: string
  interimResults: boolean
  continuous: boolean
  start(): void
  stop(): void
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike

export async function speak(text: string, enabled = true, slow = false) {
  if (!enabled) return false
  const clean = text.replace(/[*#]/g, '')
  if (isAndroid() && await speakNative(clean, slow)) return true
  if (!('speechSynthesis' in window)) return false
  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(clean)
  utterance.rate = slow ? 0.78 : 0.91
  utterance.pitch = 0.90
  const voices = window.speechSynthesis.getVoices()
  const preferred = voices.find(v => /Daniel|George|Ryan|Arthur|Microsoft David|Google UK English Male/i.test(v.name))
    || voices.find(v => /^en-GB$/i.test(v.lang) && !/female/i.test(v.name))
    || voices.find(v => /David|Google US English/i.test(v.name))
  if (preferred) utterance.voice = preferred
  window.speechSynthesis.speak(utterance)
  return true
}

export function listen(onText: (text: string) => void, onDone: () => void) {
  const w = window as typeof window & { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor }
  const Recognition = w.SpeechRecognition || w.webkitSpeechRecognition
  if (!Recognition) { onDone(); return false }
  const recognition = new Recognition()
  recognition.lang = 'en-US'
  recognition.interimResults = false
  recognition.continuous = false
  recognition.onresult = (event) => onText(event.results[0][0].transcript)
  recognition.onend = onDone
  recognition.onerror = onDone
  recognition.start()
  return true
}
import { isAndroid, speakNative } from './native'
