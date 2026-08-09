export type RealtimeController = { stop: () => void }

export async function startRealtimeVoice(options: {
  apiBase: string
  companionToken: string
  onStatus?: (message: string) => void
  onAssistantText?: (text: string) => void
}): Promise<RealtimeController> {
  if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) throw new Error('Live voice is not supported on this device')

  const pc = new RTCPeerConnection()
  const audio = document.createElement('audio')
  audio.autoplay = true
  audio.setAttribute('playsinline', 'true')
  pc.ontrack = event => { audio.srcObject = event.streams[0] }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false })
  for (const track of stream.getTracks()) pc.addTrack(track, stream)

  const events = pc.createDataChannel('oai-events')
  events.onopen = () => options.onStatus?.('Bubba is listening')
  events.onmessage = event => {
    try {
      const message = JSON.parse(event.data)
      if (message.type === 'response.output_audio_transcript.done' && message.transcript) options.onAssistantText?.(message.transcript)
    } catch { /* Ignore non-JSON WebRTC events. */ }
  }

  const offer = await pc.createOffer()
  await pc.setLocalDescription(offer)
  const base = options.apiBase.trim().replace(/\/$/, '') || (location.protocol === 'file:' ? 'http://127.0.0.1:8787' : '')
  const response = await fetch(`${base}/api/realtime`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/sdp', 'X-Bigfoot-Token': options.companionToken },
    body: offer.sdp,
  })
  if (!response.ok) {
    stream.getTracks().forEach(track => track.stop())
    pc.close()
    throw new Error(await response.text())
  }
  await pc.setRemoteDescription({ type: 'answer', sdp: await response.text() })

  return {
    stop: () => {
      stream.getTracks().forEach(track => track.stop())
      events.close()
      pc.close()
      audio.srcObject = null
    },
  }
}
