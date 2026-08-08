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

export function speak(text: string, enabled = true) {
  if (!enabled || !('speechSynthesis' in window)) return
  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(text.replace(/[*#]/g, ''))
  utterance.rate = 0.94
  utterance.pitch = 0.96
  const voices = window.speechSynthesis.getVoices()
  const preferred = voices.find(v => /Samantha|David|Google US English/i.test(v.name))
  if (preferred) utterance.voice = preferred
  window.speechSynthesis.speak(utterance)
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
