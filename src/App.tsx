import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { defaultState, loadState, saveState } from './storage'
import { addCalendarEvent, addVoiceStateListener, cancelVoiceInput, getLastCaller, importPhoneContacts, isAndroidDevice, openCalendar, openCamera, openChatGPT, openDeviceSettings, openDialer, openMapSearch, openPhoneHome, openTextMessage, openVideoCamera, requestCallerIdAccess, requestHomeShortcut, requestNotificationAccess, requestVoiceInput, scheduleReminder, setDeviceAlarm, setDeviceTimer, syncPeopleForCallerId, type NativeVoiceState } from './native'
import { listen, speak } from './voice'
import { startRealtimeVoice, type RealtimeController } from './realtime'
import { assistantPossessive, cleanAssistantName, personalizeStarterGreeting } from './assistantName'
import type { AppState, EmailMessage, GoogleTask, Person, Section, Task } from './types'
import brandLogo from './assets/bigfoot-software-logo.png'
import brandMark from './assets/bigfoot-software-mark.png'

const icon: Record<Section, string> = { home: '⌂', assistant: '✦', email: '✉', tasks: '✓', calendar: '▦', people: '☎', notes: '▤', settings: '⚙' }
const label: Record<Section, string> = { home: 'Today', assistant: 'Assistant', email: 'Email', tasks: 'My List', calendar: 'Calendar', people: 'People', notes: 'Notes', settings: 'Settings' }
const setupMarker = 'bigfoots-day-easy-setup-v0140'
const appVersion = 'v0.20 CUSTOM NAME'

function uid() { return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}` }
function localDate() { return new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) }
function timeGreeting() { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening' }

function placeConfirmedCall(name: string, phone: string) {
  const dialable = phone.replace(/[^\d+*#]/g, '')
  if (!dialable || !window.confirm(`Call ${name} at ${phone}?`)) return false
  location.href = `tel:${dialable}`
  return true
}

async function captureVoiceOnce(assistantName = 'Bubba'): Promise<{ text: string; error: string }> {
  const testWindow = window as typeof window & { __bigfootVoiceTestResult?: { text: string; error: string } }
  if (location.search.includes('testReload=') && testWindow.__bigfootVoiceTestResult) {
    const result = testWindow.__bigfootVoiceTestResult
    delete testWindow.__bigfootVoiceTestResult
    return result
  }
  // Android must never use WebView SpeechRecognition. On some Samsung phones that
  // fallback opens an external blank speech surface instead of staying in the app.
  if (isAndroidDevice()) return new Promise(resolve => {
    let finished = false
    const finish = (result: { text: string; error: string }) => {
      if (finished) return
      finished = true
      clearTimeout(watchdog)
      resolve(result)
    }
    const watchdog = window.setTimeout(() => {
      void cancelVoiceInput()
      finish({ text: '', error: 'Voice listening took too long and was safely stopped. Tap the microphone to try again.' })
    }, 9000)
    void requestVoiceInput(cleanAssistantName(assistantName)).then(finish)
  })
  return new Promise(resolve => {
    let finished = false
    const done = (result: { text: string; error: string }) => {
      if (finished) return
      finished = true
      resolve(result)
    }
    const supported = listen(text => done({ text, error: '' }), () => done({ text: '', error: 'Nothing was heard. Please try again.' }))
    if (!supported) done({ text: '', error: 'Voice input is not supported on this device.' })
  })
}

function App() {
  const [state, setState] = useState<AppState>(() => loadState())
  const [showSetup, setShowSetup] = useState(() => !state.preferences.setupComplete || localStorage.getItem(setupMarker) !== 'done')
  const [section, setSection] = useState<Section>('home')
  const [listening, setListening] = useState(false)
  const [thinking, setThinking] = useState(false)
  const [liveVoice, setLiveVoice] = useState(false)
  const [lastCaller, setLastCaller] = useState('')
  const [toast, setToast] = useState('')
  const [voiceUi, setVoiceUi] = useState<NativeVoiceState>({ state: 'idle' })
  const [showMobileMore, setShowMobileMore] = useState(false)
  const stateRef = useRef(state)
  const realtimeRef = useRef<RealtimeController | null>(null)
  const voiceRequestRef = useRef(false)
  stateRef.current = state
  const assistantName = cleanAssistantName(state.preferences.assistantName)

  useEffect(() => saveState(state), [state])
  useEffect(() => { void syncPeopleForCallerId(state.people.filter(p => !p.deleted)) }, [state.people])
  useEffect(() => {
    getLastCaller().then(c => {
      if (!c?.number) return
      const person = stateRef.current.people.find(p => !p.deleted && normalizePhone(p.phone) === normalizePhone(c.number))
      setLastCaller(person ? `${person.name} called` : c.name ? `${c.name} called` : `${c.number} called`)
    })
  }, [])

  useEffect(() => {
    if (voiceUi.state === 'idle' || voiceUi.state === 'complete') return
    const watchdog = window.setTimeout(() => {
      void cancelVoiceInput()
      setVoiceUi({ state: 'idle' })
      setListening(false)
      notify('Voice was safely stopped. The app is ready—tap the microphone to try again.')
    }, 11000)
    return () => clearTimeout(watchdog)
  }, [voiceUi.state])

  useEffect(() => {
    if (!state.preferences.autoSync || !state.preferences.apiBase.trim()) return
    let stopped = false
    const sync = async () => {
      const current = stateRef.current
      try {
        const base = getCompanionBase(current.preferences.apiBase)
        const r = await fetch(`${base}/api/sync`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Bigfoot-Token': current.preferences.companionToken }, body: JSON.stringify({ tasks: current.tasks, people: current.people, notes: current.notes, chat: current.chat }) })
        if (!r.ok || stopped) return
        const data = await r.json() as Partial<AppState>
        if (data.tasks && data.people && data.notes) setState(s => ({ ...s, tasks: data.tasks!, people: data.people!, notes: data.notes!, chat: data.chat || s.chat }))
      } catch { /* Local-first: retry automatically. */ }
    }
    const first = window.setTimeout(() => void sync(), 1800)
    const timer = window.setInterval(() => void sync(), 15000)
    return () => { stopped = true; clearTimeout(first); clearInterval(timer) }
  }, [state.preferences.autoSync, state.preferences.apiBase, state.preferences.companionToken])

  useEffect(() => () => realtimeRef.current?.stop(), [])
  useEffect(() => {
    let handle: { remove: () => Promise<void> } | null = null
    let idleTimer = 0
    void addVoiceStateListener(event => {
      clearTimeout(idleTimer)
      setVoiceUi(event)
      if (event.state === 'complete') idleTimer = window.setTimeout(() => setVoiceUi({ state: 'idle' }), 700)
    }).then(value => { handle = value })
    return () => { clearTimeout(idleTimer); void handle?.remove() }
  }, [])

  const todayTasks = useMemo(() => state.tasks.filter(t => !t.deleted && !t.done && (!t.due || t.due <= new Date().toISOString().slice(0, 10))), [state.tasks])

  function patch(next: Partial<AppState>) { setState(s => ({ ...s, ...next })) }
  function notify(message: string) { setToast(message); window.setTimeout(() => setToast(''), 6500) }

  function go(section: Section) {
    setShowMobileMore(false)
    setSection(section)
  }

  async function openPhoneTool(action: () => Promise<boolean>, name: string) {
    const opened = await action()
    if (!opened) notify(`${name} could not open. Tap HOME, then open it from your phone’s Apps screen.`)
    return opened
  }

  async function goToPhoneHome() {
    return openPhoneTool(openPhoneHome, 'The phone Home screen')
  }

  async function installHomeIcon() {
    const requested = await requestHomeShortcut()
    notify(requested ? 'Samsung is asking to add the icon. Tap Add. Then return here for the final Home test.' : 'Open Apps, press and hold Bigfoot v0.20 Custom Name, then tap Add to Home.')
    return requested
  }

  async function askAssistant(message: string) {
    const text = message.trim()
    if (!text) return
    const userMessage = { role: 'user' as const, text }
    setState(s => ({ ...s, chat: [...s.chat, userMessage] }))
    setThinking(true)
    try {
      const configuredBase = state.preferences.apiBase.trim().replace(/\/$/, '')
      if (!configuredBase) throw new Error(`Using local ${assistantName}`)
      const base = configuredBase || (location.protocol === 'file:' ? 'http://127.0.0.1:8787' : '')
      const response = await fetch(`${base}/api/assistant`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bigfoot-Token': state.preferences.companionToken },
        body: JSON.stringify({ message: text, assistantName, history: state.chat.slice(-10), context: { tasks: state.tasks, people: state.people, notes: state.notes.slice(-10), userName: state.preferences.userName, assistantName } }),
      })
      if (!response.ok) throw new Error('Assistant is offline')
      const data = await response.json() as { text: string; action?: { type: string; text?: string } }
      setState(s => ({ ...s, chat: [...s.chat, { role: 'assistant', text: data.text }] }))
      speak(data.text, state.preferences.voice, state.preferences.slowVoice)
    } catch {
      const result = localAssistant(text, stateRef.current)
      setState(s => ({ ...s, ...result.changes, chat: [...s.chat, { role: 'assistant', text: result.reply }] }))
      await speak(result.reply, state.preferences.voice, state.preferences.slowVoice)
      if (result.action) await runAssistantAction(result.action)
    } finally { setThinking(false) }
  }

  async function runAssistantAction(action: AssistantAction) {
    let opened = true
    if (action.type === 'timer') opened = await setDeviceTimer(action.seconds, action.label)
    if (action.type === 'alarm') opened = await setDeviceAlarm(action.hour, action.minute, action.label)
    if (action.type === 'map') opened = await openMapSearch(action.query)
    if (action.type === 'camera') opened = await openCamera()
    if (action.type === 'video') opened = await openVideoCamera()
    if (action.type === 'dialer') opened = await openDialer()
    if (action.type === 'text') opened = await openTextMessage()
    if (action.type === 'calendar') opened = await addCalendarEvent(action.title, action.startTime, action.endTime, action.guests)
    if (action.type === 'calendar-open') opened = await openCalendar()
    if (action.type === 'google-task') {
      try {
        const base = getCompanionBase(stateRef.current.preferences.apiBase)
        const response = await fetch(`${base}/api/google/tasks`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bigfoot-Token': stateRef.current.preferences.companionToken }, body: JSON.stringify({ title: action.title, due: action.due }) })
        opened = response.ok
        notify(opened ? `Added “${action.title}” to Google Tasks.` : 'Google Tasks could not add that. Your phone list is still available.')
      } catch { opened = false }
    }
    if (action.type === 'settings') opened = await openDeviceSettings()
    if (action.type === 'chatgpt') await launchChatGPT()
    if (action.type === 'call') {
      const person = stateRef.current.people.find(p => !p.deleted && normalizePhone(p.phone) === normalizePhone(action.phone))
      placeConfirmedCall(person?.name || 'this person', action.phone)
    }
    if (!opened) notify('The phone could not open that tool. Please try it from the phone’s Apps screen.')
  }

  async function startListening() {
    if (voiceRequestRef.current) {
      await stopListening()
      return false
    }
    voiceRequestRef.current = true
    setListening(true)
    try {
      const result = await captureVoiceOnce(assistantName)
      // Speech must never change pages. Keeping the current screen mounted avoids
      // Samsung WebView black/white transitions and makes every mic button safe.
      if (result.text) { await askAssistant(result.text); return true }
      notify(result.error || 'I didn’t hear anything. Tap the microphone and try again.')
      return false
    } finally {
      voiceRequestRef.current = false
      setListening(false)
    }
  }

  async function practiceLessonVoice() {
    if (voiceRequestRef.current) {
      await stopListening()
      return false
    }
    voiceRequestRef.current = true
    setSection('home')
    setListening(true)
    try {
      const result = await captureVoiceOnce(assistantName)
      setSection('home')
      if (!result.text) {
        notify(result.error || 'I didn’t hear anything. Lesson 1 is still here, and you can try again or skip it.')
        return false
      }
      notify(`✓ ${assistantName} heard you. Lesson 1 is complete and Lesson 2 is ready.`)
      void speak(`I heard you say, ${result.text}. Voice is working. Lesson two is ready.`, state.preferences.voice, state.preferences.slowVoice)
      return true
    } finally {
      voiceRequestRef.current = false
      setListening(false)
      setSection('home')
    }
  }

  function practiceLessonTask() {
    const stamp = new Date().toISOString()
    const today = stamp.slice(0, 10)
    setSection('home')
    setState(s => {
      const alreadyAdded = s.tasks.some(task => !task.deleted && task.text.toLowerCase() === 'drink a glass of water')
      const tasks = alreadyAdded ? s.tasks : [{ id: uid(), text: 'drink a glass of water', due: today, done: false, important: false, updatedAt: stamp }, ...s.tasks]
      return { ...s, tasks, preferences: { ...s.preferences, learningStep: Math.max(2, s.preferences.learningStep) } }
    })
    notify('✓ Added to your list. Lesson 3 is ready.')
    void speak('Done. I added drink a glass of water to your list. Lesson three is ready.', state.preferences.voice, state.preferences.slowVoice)
  }

  function practiceLessonNote() {
    const stamp = new Date().toISOString()
    setSection('home')
    setState(s => {
      const noteText = 'I am learning to use my assistant'
      const alreadyAdded = s.notes.some(note => !note.deleted && note.text === noteText)
      const notes = alreadyAdded ? s.notes : [{ id: uid(), text: noteText, createdAt: stamp, updatedAt: stamp }, ...s.notes]
      return { ...s, notes, preferences: { ...s.preferences, learningStep: Math.max(3, s.preferences.learningStep) } }
    })
    notify('✓ Note saved. Lesson 4 is ready.')
    void speak('Done. I saved the practice note. Lesson four is ready.', state.preferences.voice, state.preferences.slowVoice)
  }

  async function stopListening() {
    await cancelVoiceInput()
    voiceRequestRef.current = false
    setVoiceUi({ state: 'idle' })
    setListening(false)
    notify('Voice listening stopped. You can try again whenever you are ready.')
  }

  async function toggleLiveVoice() {
    if (realtimeRef.current) {
      realtimeRef.current.stop(); realtimeRef.current = null; setLiveVoice(false); notify('Live conversation ended.'); return true
    }
    if (!state.preferences.apiBase.trim()) {
      return startListening()
    }
    try {
      notify(`Starting live ${assistantName}…`)
      realtimeRef.current = await startRealtimeVoice({
        apiBase: state.preferences.apiBase,
        companionToken: state.preferences.companionToken,
        assistantName,
        onStatus: () => { setLiveVoice(true); notify(`${assistantName} is listening. Just speak naturally.`) },
        onAssistantText: text => setState(s => ({ ...s, chat: [...s.chat, { role: 'assistant', text }] })),
      })
      setLiveVoice(true)
      return true
    } catch { setLiveVoice(false); notify(`Live ${assistantName} could not connect. Check Settings and microphone permission.`); return false }
  }

  async function launchChatGPT() {
    const opened = await openChatGPT()
    if (!opened) notify('ChatGPT could not open. Install the official ChatGPT app and try again.')
  }

  const rootClass = `${state.preferences.largeText ? 'large-text' : ''} ${state.preferences.highContrast ? 'high-contrast' : ''}`
  if (showSetup) return <SetupWizard state={state} voiceUi={voiceUi} onCancelVoice={stopListening} onChange={setState} onFinish={() => { setState(s => ({ ...s, preferences: { ...s.preferences, assistantName: cleanAssistantName(s.preferences.assistantName), setupComplete: true } })); localStorage.setItem(setupMarker, 'done'); setShowSetup(false); setShowMobileMore(false); setSection('home') }} />
  return <div className={`app ${rootClass}`}>
    <header className="topbar">
      <button className="brand" onClick={() => go('home')} aria-label="Bigfoot's Day home">
        <img className="brand-mark" src={brandMark} alt="" /><span><b>Bigfoot’s Day</b><small>Your day. Made simple.</small></span>
      </button>
      <div className="version-badge">{appVersion}</div>
      <div className="topbar-actions"><div className="date-chip"><span className="status-dot" /> {localDate()}</div><button className="phone-home" data-testid="phone-home-button" onClick={() => void goToPhoneHome()} aria-label="Return to the phone home screen">⌂ HOME</button></div>
    </header>

    <div className="layout">
      <nav className="sidebar" aria-label="Main navigation">
        {(Object.keys(label) as Section[]).filter(key => key !== 'email' || Boolean(state.preferences.apiBase.trim())).map(key => <button key={key} data-section={key} data-testid={`nav-${key}`} className={section === key && !showMobileMore ? 'active' : ''} onClick={() => go(key)}>
          <span className="nav-icon">{icon[key]}</span><span>{key === 'assistant' ? `Ask ${assistantName}` : label[key]}</span>
        </button>)}
        <button className={`mobile-more-nav ${showMobileMore ? 'active' : ''}`} data-testid="nav-more" onClick={() => setShowMobileMore(true)}><span className="nav-icon">☰</span><span>More</span></button>
        <div className="help-card"><b>Need help?</b><span>Say “{assistantName}, help me.”</span><button onClick={() => void toggleLiveVoice()}>🎙 {liveVoice ? 'End live talk' : `Talk to ${assistantName}`}</button></div>
      </nav>

      <main>
        {showMobileMore ? <MorePage hasEmail={Boolean(state.preferences.apiBase.trim())} go={go} goPhoneHome={goToPhoneHome} runSetup={() => setShowSetup(true)} /> : <>
          {section === 'home' && <Home state={state} todayTasks={todayTasks} lastCaller={lastCaller} go={go} ask={askAssistant} talk={toggleLiveVoice} practiceTalk={practiceLessonVoice} practiceTask={practiceLessonTask} practiceNote={practiceLessonNote} openChatGPT={launchChatGPT} openCamera={() => openPhoneTool(openCamera, 'Camera')} openVideo={() => openPhoneTool(openVideoCamera, 'Video camera')} openPhone={() => openPhoneTool(openDialer, 'Phone dialer')} openTexts={() => openPhoneTool(openTextMessage, 'Text messages')} addHomeIcon={installHomeIcon} openPhoneHome={goToPhoneHome} callHelper={() => placeConfirmedCall(state.preferences.trustedHelperName || 'your trusted helper', state.preferences.trustedHelperPhone)} advanceLearning={() => setState(s => ({ ...s, preferences: { ...s.preferences, learningStep: Math.min(7, s.preferences.learningStep + 1) } }))} finishLearning={() => setState(s => ({ ...s, preferences: { ...s.preferences, learningStep: 7 } }))} toggleTask={id => patch({ tasks: state.tasks.map(t => t.id === id ? { ...t, done: !t.done, updatedAt: new Date().toISOString() } : t) })} />}
          {section === 'assistant' && <Assistant state={state} thinking={thinking} listening={listening} liveVoice={liveVoice} ask={askAssistant} listen={startListening} toggleLiveVoice={toggleLiveVoice} openChatGPT={launchChatGPT} goHome={() => go('home')} />}
          {section === 'email' && <Email state={state} notify={notify} />}
          {section === 'tasks' && <Tasks state={state} onChange={setState} notify={notify} />}
          {section === 'calendar' && <CalendarPage state={state} notify={notify} />}
          {section === 'people' && <People people={state.people} onChange={people => patch({ people })} notify={notify} onCallerAccess={async () => notify(await requestCallerIdAccess() ? 'Caller identification is turned on.' : 'Caller identification permission was not granted.')} />}
          {section === 'notes' && <Notes assistantName={assistantName} notes={state.notes} onChange={notes => patch({ notes })} notify={notify} />}
          {section === 'settings' && <Settings state={state} onChange={setState} notify={notify} onRunSetup={() => setShowSetup(true)} onAddHomeShortcut={async () => notify(await requestHomeShortcut() ? 'Samsung opened the Add to Home screen request.' : 'Open Apps, press and hold your app icon, then tap Add to Home.')} onReset={() => { if (!window.confirm('Start over and erase your lists, people, notes, and settings from this phone? Tap Cancel to keep everything.')) return; setState(defaultState); localStorage.removeItem(setupMarker); setShowSetup(true) }} />}
        </>}
      </main>
    </div>

    <button className={`floating-mic ${liveVoice ? 'listening' : ''}`} onClick={() => void toggleLiveVoice()} aria-label={`Talk to ${assistantName}`}>🎙<span>{liveVoice ? 'End live talk' : `Talk to ${assistantName}`}</span></button>
    <VoiceHud assistantName={assistantName} state={voiceUi} onCancel={stopListening} />
    {toast && <div className="toast" role="status">{toast}</div>}
  </div>
}

function VoiceHud({ assistantName, state, onCancel }: { assistantName: string; state: NativeVoiceState; onCancel: () => Promise<void> }) {
  // Android has a native safety panel above the WebView. Rendering a second
  // WebView overlay can expand to the full Fold screen on some Samsung layouts.
  if (isAndroidDevice()) return null
  if (state.state === 'idle' || state.state === 'complete') return null
  const message = state.message || (state.state === 'hearing' ? 'I hear you…' : state.state === 'processing' ? 'Working on that…' : 'Listening…')
  return <div className={`voice-hud ${state.state}`} data-testid="voice-hud" role="status" aria-live="polite"><div className="voice-hud-ring"><span>✦</span><i /><i /><i /></div><b>{assistantName.toUpperCase()}</b><strong>{message}</strong><div className="voice-meter" aria-hidden="true">{Array.from({ length: 9 }, (_, i) => <i key={i} style={{ height: `${12 + ((i * 7 + (state.level || 2) * 5) % 31)}px` }} />)}</div><small>This lesson stays on screen. Listening stops automatically after 9 seconds.</small><button className="voice-cancel" data-testid="voice-cancel" onClick={() => void onCancel()}>Stop listening</button></div>
}

function SetupWizard({ state, voiceUi, onCancelVoice, onChange, onFinish }: { state: AppState; voiceUi: NativeVoiceState; onCancelVoice: () => Promise<void>; onChange: (s: AppState | ((s: AppState) => AppState)) => void; onFinish: () => void }) {
  const [step, setStep] = useState(0)
  const [voiceTest, setVoiceTest] = useState<{ status: 'idle' | 'listening' | 'passed' | 'failed'; text: string }>({ status: 'idle', text: '' })
  const [reminderStatus, setReminderStatus] = useState<'idle' | 'granted' | 'not-granted'>('idle')
  const [callerStatus, setCallerStatus] = useState<'idle' | 'granted' | 'not-granted'>('idle')
  const [phonebookStatus, setPhonebookStatus] = useState<'idle' | 'imported' | 'not-granted'>('idle')
  const [googleStatus, setGoogleStatus] = useState<'idle' | 'connected' | 'not-connected'>('idle')
  const p = state.preferences
  const assistantName = cleanAssistantName(p.assistantName)
  const rootClass = `${p.largeText ? 'large-text' : ''} ${p.highContrast ? 'high-contrast' : ''}`
  const setPref = (key: keyof typeof p, value: string | boolean) => onChange({ ...state, chat: key === 'assistantName' ? state.chat.map(message => message.role === 'assistant' ? { ...message, text: personalizeStarterGreeting(message.text, String(value)) } : message) : state.chat, preferences: { ...p, [key]: value } })
  const stepNames = ['Welcome', 'About you', 'Text size', 'Voice speed', 'Voice test', 'Reminders', 'Caller ID', 'Phonebook & helper', 'Connections', 'Learning', 'Ready']
  const readCopy = [
    "Welcome. I will walk you through your setup one simple step at a time. You can go back, or do optional steps later.",
    `Let's make this personal. Your name is ${p.userName || 'not entered yet'}, and your assistant is named ${assistantName}.`,
    'Choose the text that is easiest for you to read. You can use larger text and extra-high contrast.',
    `Choose how ${assistantName} should speak. You can hear answers at a normal pace or a slower pace.`,
    `Now we will test the microphone and speaker. Tap Test my voice, say hello ${assistantName}, and listen for the reply.`,
    'Your assistant can tell you when something on your list needs attention. Android will ask for permission before notifications are turned on.',
    'Your caller ID can announce who is calling when the phone recognizes the number. Android will ask you to approve caller identification and contacts access.',
    'You can import the names and phone numbers already saved in your phonebook, then choose one trusted helper. Android will ask first. You can say no and enter people by hand.',
    p.apiBase.trim() ? `Connect Google with one button so ${assistantName} can help with Gmail, Google Tasks, and Google Calendar. Google will show the permissions before you approve them.` : 'Your phone list and phone calendar work without Google. Google services can be connected later if you want them.',
    `You will learn one skill at a time: talking to ${assistantName}, managing your list, saving notes, using reminders and caller identification, and opening ChatGPT for more detailed help.`,
    `Setup is finished. ${assistantName} is ready to help. You can run this setup guide again any time from Settings.`,
  ]

  async function testVoice() {
    setVoiceTest({ status: 'listening', text: '' })
    const result = await captureVoiceOnce(assistantName)
    if (!result.text) {
      setVoiceTest({ status: 'failed', text: result.error || 'Nothing was heard.' })
      return
    }
    const reply = `I heard you say, ${result.text}. Your microphone and my voice are working.`
    const spoken = await speak(reply, true, p.slowVoice)
    setVoiceTest({ status: spoken ? 'passed' : 'failed', text: spoken ? result.text : 'I heard you, but Android could not play the spoken reply. Check the phone’s media volume and text-to-speech settings.' })
  }

  async function enableReminders() {
    const granted = await requestNotificationAccess()
    setReminderStatus(granted ? 'granted' : 'not-granted')
  }

  async function enableCallerId() {
    const granted = await requestCallerIdAccess()
    setCallerStatus(granted ? 'granted' : 'not-granted')
  }

  async function importSetupPhonebook() {
    const result = await importPhoneContacts()
    if (!result.granted) { setPhonebookStatus('not-granted'); return }
    const existing = new Set(state.people.filter(person => !person.deleted).map(person => `${person.name.toLowerCase()}\u0000${normalizePhone(person.phone)}`))
    const stamp = new Date().toISOString()
    const added = result.people.filter(person => !existing.has(`${person.name.toLowerCase()}\u0000${normalizePhone(person.phone)}`)).map(person => ({ id: uid(), name: person.name, phone: person.phone, relationship: 'Phonebook', favorite: false, updatedAt: stamp }))
    onChange({ ...state, people: [...added, ...state.people] })
    setPhonebookStatus('imported')
  }

  async function connectGoogle() {
    const base = p.apiBase.trim().replace(/\/$/, '')
    if (!base) { setGoogleStatus('not-connected'); return }
    try {
      const r = await fetch(`${base}/api/google/auth-url`, { headers: { 'X-Bigfoot-Token': p.companionToken } })
      if (!r.ok) throw new Error()
      const data = await r.json() as { url: string }
      window.open(data.url, '_blank', 'noopener,noreferrer')
      setGoogleStatus('connected')
    } catch { setGoogleStatus('not-connected') }
  }

  return <div className={`setup-shell ${rootClass}`} data-testid="setup-wizard">
    <header className="setup-header"><div className="setup-brand"><img src={brandMark} alt="" /><b>Bigfoot’s Day</b></div><span>Easy Setup · v0.20</span></header>
    <main className="setup-main">
      <div className="setup-progress" aria-label={`Setup step ${step + 1} of 11`}><div className="setup-progress-copy"><b>Step {step + 1} of 11</b><span>{stepNames[step]}</span></div><div className="setup-dots" aria-hidden="true">{stepNames.map((name, index) => <i key={name} className={index <= step ? 'done' : ''} />)}</div></div>
      <section className="setup-card">
        {step === 0 && <div className="setup-content center"><img className="setup-logo" src={brandLogo} alt="Bigfoot Software" /><span className="eyebrow">WELCOME</span><h1>Let’s set up your day together.</h1><p className="setup-lead">I’ll walk you through it one simple step at a time. There is no rush.</p><div className="setup-reassurance">✓ You can go back at any time.<br />✓ Optional steps can be done later.<br />✓ Nothing important is sent without your approval.</div></div>}

        {step === 1 && <div className="setup-content"><span className="eyebrow">MAKE IT PERSONAL</span><h1>What should we call you?</h1><p className="setup-lead">This helps your assistant speak to you naturally.</p><label className="setup-label">Your first name<input autoFocus value={p.userName} onChange={e => setPref('userName', e.target.value)} placeholder="Your first name" /></label><label className="setup-label">Name your assistant<input data-testid="setup-assistant-name" maxLength={24} value={p.assistantName} onChange={e => setPref('assistantName', e.target.value)} onBlur={() => setPref('assistantName', assistantName)} placeholder="Bubba" /></label><p className="setup-tip">Choose any short name you like. The app will use it on every screen and when the assistant speaks.</p></div>}

        {step === 2 && <div className="setup-content"><span className="eyebrow">EASY TO READ</span><h1>How should the words look?</h1><p className="setup-lead">Tap the choices that are most comfortable. You can change these later.</p><button className={`setup-choice ${p.largeText ? 'selected' : ''}`} onClick={() => setPref('largeText', !p.largeText)}><span>🔎</span><div><b>Larger text</b><small>{p.largeText ? 'On — keep words larger' : 'Off — use standard-sized words'}</small></div><em>{p.largeText ? 'ON' : 'OFF'}</em></button><button className={`setup-choice ${p.highContrast ? 'selected' : ''}`} onClick={() => setPref('highContrast', !p.highContrast)}><span>◐</span><div><b>Extra-high contrast</b><small>Makes words and controls stand out more</small></div><em>{p.highContrast ? 'ON' : 'OFF'}</em></button></div>}

        {step === 3 && <div className="setup-content"><span className="eyebrow">VOICE SPEED</span><h1>How fast should {assistantName} talk?</h1><p className="setup-lead">Choose a pace, then listen to the sample.</p><div className="setup-pace"><button className={!p.slowVoice ? 'selected' : ''} onClick={() => setPref('slowVoice', false)}><b>Normal pace</b><small>Clear, everyday speaking speed</small></button><button className={p.slowVoice ? 'selected' : ''} onClick={() => setPref('slowVoice', true)}><b>Slower pace</b><small>More time between the words</small></button></div><button className={`setup-choice ${p.voice ? 'selected' : ''}`} onClick={() => setPref('voice', !p.voice)}><span>🔊</span><div><b>Speak answers out loud</b><small>{assistantName} can read answers to you</small></div><em>{p.voice ? 'ON' : 'OFF'}</em></button><button className="setup-test" onClick={() => speak(`Hi ${p.userName || 'there'}. I’m ${assistantName}. This is the ${p.slowVoice ? 'slower' : 'normal'} speaking pace.`, true, p.slowVoice)}>🔊 Hear {assistantPossessive(assistantName)} voice</button></div>}

        {step === 4 && <div className="setup-content"><span className="eyebrow">VOICE CHECK</span><h1>Let’s make sure voice really works.</h1><p className="setup-lead">Tap the button, allow the microphone when Samsung asks, then say <strong>“Hello {assistantName}.”</strong> {assistantName} will repeat what was heard.</p><button className="setup-action voice-check" disabled={voiceTest.status === 'listening'} onClick={() => void testVoice()}>🎙 {voiceTest.status === 'listening' ? 'Listening…' : voiceTest.status === 'passed' ? 'Test voice again' : 'Test my voice'}</button>{voiceTest.status === 'passed' && <div className="setup-success">✓ Voice passed. {assistantName} heard: “{voiceTest.text}” and played a spoken reply.</div>}{voiceTest.status === 'failed' && <div className="setup-later"><b>Voice is not ready yet.</b><br />{voiceTest.text}<br /><br />Check that media volume is turned up, then tap <strong>Test my voice</strong> again.<button className="setup-action secondary-action voice-settings" onClick={() => void openDeviceSettings()}>Open phone settings</button></div>}</div>}

        {step === 5 && <div className="setup-content"><span className="eyebrow">REMINDERS</span><h1>Would you like helpful reminders?</h1><p className="setup-lead">Your assistant can remind you about appointments, calls, medicine, errands, and anything else you put on your list.</p><div className="setup-permission"><span>🔔</span><div><b>Android will ask for permission.</b><p>When the phone asks, tap <strong>Allow</strong> if you want your reminders to appear.</p></div></div><button className="setup-action" onClick={() => void enableReminders()}>Turn on reminders</button>{reminderStatus === 'granted' && <div className="setup-success">✓ Reminders are turned on.</div>}{reminderStatus === 'not-granted' && <div className="setup-later">That’s okay. Reminders are not on. You can change this later.</div>}</div>}

        {step === 6 && <div className="setup-content"><span className="eyebrow">CALLER ID</span><h1>Let your assistant tell you who is calling.</h1><p className="setup-lead">When a call comes in, your assistant can announce the person’s name when it recognizes the number.</p><div className="setup-permission"><span>☎</span><div><b>You may see two Android questions.</b><p>Choose your assistant app for caller identification, then allow contacts so names can be recognized.</p></div></div><button className="setup-action" onClick={() => void enableCallerId()}>Turn on caller ID</button>{callerStatus === 'granted' && <div className="setup-success">✓ Caller identification is turned on.</div>}{callerStatus === 'not-granted' && <div className="setup-later">Caller ID is not on yet. No problem — you can do this later.</div>}</div>}

        {step === 7 && <div className="setup-content"><span className="eyebrow">PHONEBOOK & TRUSTED HELPER</span><h1>Bring in people already saved on this phone?</h1><p className="setup-lead">This is optional. Android will ask before your app reads contact names and phone numbers.</p><div className="setup-permission"><span>☎</span><div><b>Tap Allow to import your phonebook.</b><p>Contacts are used for People and caller identification. They are not sent anywhere. Tap Don’t allow if you prefer to enter people by hand.</p></div></div><button className="setup-action" onClick={() => void importSetupPhonebook()}>Import my phonebook</button>{phonebookStatus === 'imported' && <div className="setup-success">✓ Your phonebook was imported. Existing people were not duplicated.</div>}{phonebookStatus === 'not-granted' && <div className="setup-later">Phonebook permission was not granted. That is okay — enter people by hand later.</div>}<h2 className="setup-subhead">Choose one trusted helper — optional</h2><label className="setup-label">Helper’s name<input value={p.trustedHelperName} onChange={e => setPref('trustedHelperName', e.target.value)} placeholder="For example: Linda" /></label><label className="setup-label">Helper’s phone number<input type="tel" inputMode="tel" value={p.trustedHelperPhone} onChange={e => setPref('trustedHelperPhone', e.target.value)} placeholder="Phone number" /></label><div className="setup-reassurance compact">✓ The app always shows the name and asks before opening a call.<br />✓ This button does not contact emergency services.</div></div>}

        {step === 8 && (p.apiBase.trim() ? <div className="setup-content"><span className="eyebrow">GOOGLE — OPTIONAL</span><h1>Would you like Gmail, Google Tasks, and Google Calendar?</h1><p className="setup-lead">One connection lets {assistantName} show important email, use Google Tasks, and help with appointments.</p><div className="setup-permission"><span>G</span><div><b>Google shows every permission before you approve it.</b><p>Choose your account, review Gmail, Tasks, and Calendar, then tap Allow. Google handles your password; your app never sees it.</p></div></div><button className="setup-action google-button" onClick={() => void connectGoogle()}>Connect Google</button>{googleStatus === 'connected' && <div className="setup-success">✓ Google opened. Finish the Google steps, then return to your app.</div>}{googleStatus === 'not-connected' && <div className="setup-later"><b>Google isn’t available yet.</b><br />Keep using the phone list and calendar, then connect later.</div>}<p className="setup-tip">You can skip Google. Your phone list, reminders, calendar, people, notes, and caller ID still work.</p></div> : <div className="setup-content"><span className="eyebrow">GOOGLE IS OPTIONAL</span><h1>Your phone list and calendar are ready without Google.</h1><p className="setup-lead">Tasks stay on this phone and appointments open in your installed calendar. A helper can enable the optional Google connection later.</p><div className="setup-permission"><span>✓</span><div><b>No Google permission is required.</b><p>Voice, lists, reminders, calendar review, phonebook, calls, camera, Maps, and notes work directly on this phone.</p></div></div><div className="setup-success">✓ Your phone-only tools are ready.</div></div>)}

        {step === 9 && <div className="setup-content"><span className="eyebrow">LEARN A LITTLE AT A TIME</span><h1>{assistantName} will teach you inside the app.</h1><p className="setup-lead">You will see one short lesson at a time. Finish it when you are ready, then try the everyday tools on Today.</p><div className="capability-roadmap"><div><b>1. Talk & listen</b><small>Ask a question and hear {assistantName} answer.</small></div><div><b>2. Manage your day</b><small>Use lists, Google Tasks, notes and reminders.</small></div><div><b>3. Use phone tools</b><small>Use voice for calendar events, timers, maps and camera.</small></div><div><b>4. People & caller ID</b><small>Import your phonebook and keep people easy to reach.</small></div><div><b>5. More Help</b><small>Open ChatGPT for detailed questions.</small></div><div><b>6. Add the Home icon</b><small>Ask Samsung to put Bigfoot on Home before leaving the app.</small></div><div><b>7. Go Home & come back</b><small>Test the new icon and return to your dashboard.</small></div></div></div>}

        {step === 10 && <div className="setup-content center"><div className="setup-paw ready">✓</div><span className="eyebrow">READY TO BEGIN</span><h1>Your first lesson is waiting.</h1><p className="setup-lead">Start simple. Your assistant will show only one new lesson at a time.</p><div className="setup-summary"><div><span>👤</span><b>{p.userName || 'Your name'}</b><small>Your profile</small></div><div><span>🎙</span><b>{voiceTest.status === 'passed' ? 'Voice tested' : 'Voice needs testing'}</b><small>{p.slowVoice ? 'Slower' : 'Normal'} speaking pace</small></div><div><span>☎</span><b>{p.trustedHelperName && p.trustedHelperPhone ? p.trustedHelperName : 'Can add later'}</b><small>Trusted helper</small></div><div><span>⌂</span><b>Home icon lesson is ready</b><small>The tutorial adds it before sending you Home</small></div></div><p className="setup-tip">You can run this setup and the voice test again from Settings.</p></div>}

        <button className="setup-read" onClick={() => speak(readCopy[step], true, p.slowVoice)}>🔊 Read this screen to me</button>
      </section>
      <div className="setup-nav">{step > 0 ? <button className="setup-back" onClick={() => setStep(s => Math.max(0, s - 1))}>← Back</button> : <span />}{step < 10 ? <button className="setup-next" onClick={() => { if (step === 1) setPref('assistantName', assistantName); setStep(s => Math.min(10, s + 1)) }}>{step === 4 && voiceTest.status !== 'passed' ? 'Test later →' : step >= 5 && ((step === 5 && reminderStatus !== 'granted') || (step === 6 && callerStatus !== 'granted') || (step === 7 && (!p.trustedHelperName || !p.trustedHelperPhone)) || (step === 8 && p.apiBase.trim() && googleStatus !== 'connected')) ? 'Do this later →' : 'Continue →'}</button> : <button className="setup-next finish" onClick={onFinish}>Begin my first lesson</button>}</div>
      <p className="setup-footer">Take your time. Nothing here has to be perfect.</p>
    </main>
    <VoiceHud assistantName={assistantName} state={voiceUi} onCancel={onCancelVoice} />
  </div>
}

function MorePage({ hasEmail, go, goPhoneHome, runSetup }: { hasEmail: boolean; go: (s: Section) => void; goPhoneHome: () => Promise<boolean>; runSetup: () => void }) {
  return <div className="page more-page" data-testid="more-page"><div className="page-title"><div><span className="eyebrow">MORE CHOICES</span><h1>What would you like?</h1><p>These less-used choices are kept here so the bottom of your screen stays simple.</p></div></div><div className="more-grid">
    {hasEmail && <button data-testid="more-email" onClick={() => go('email')}><span>✉</span><b>Email</b><small>Read important messages and review suggested replies.</small></button>}
    <button data-testid="more-calendar" onClick={() => go('calendar')}><span>▦</span><b>Calendar</b><small>See dated tasks or add an appointment to your phone calendar.</small></button>
    <button data-testid="more-notes" onClick={() => go('notes')}><span>▤</span><b>Notes</b><small>Save something you do not want to forget.</small></button>
    <button data-testid="more-settings" onClick={() => go('settings')}><span>⚙</span><b>Settings & Help</b><small>Change text, voice, helper, or run setup again.</small></button>
    <button data-testid="more-setup" onClick={runSetup}><span>?</span><b>Walk through setup again</b><small>Start the easy step-by-step guide. Your saved information stays.</small></button>
    <button data-testid="more-phone-home" onClick={() => void goPhoneHome()}><span>⌂</span><b>Phone Home</b><small>Leave the app and return to the normal Samsung Home screen.</small></button>
  </div></div>
}

function Home({ state, todayTasks, lastCaller, go, ask, talk, practiceTalk, practiceTask, practiceNote, openChatGPT, openCamera, openVideo, openPhone, openTexts, addHomeIcon, openPhoneHome, callHelper, advanceLearning, finishLearning, toggleTask }: { state: AppState; todayTasks: Task[]; lastCaller: string; go: (s: Section) => void; ask: (s: string) => Promise<void>; talk: () => Promise<boolean>; practiceTalk: () => Promise<boolean>; practiceTask: () => void; practiceNote: () => void; openChatGPT: () => Promise<void>; openCamera: () => Promise<boolean>; openVideo: () => Promise<boolean>; openPhone: () => Promise<boolean>; openTexts: () => Promise<boolean>; addHomeIcon: () => Promise<boolean>; openPhoneHome: () => Promise<boolean>; callHelper: () => boolean; advanceLearning: () => void; finishLearning: () => void; toggleTask: (id: string) => void }) {
  const name = state.preferences.userName || 'there'
  const assistantName = cleanAssistantName(state.preferences.assistantName)
  const lesson = [
    { title: `Lesson 1: Talk to ${assistantName}`, copy: `Tap Practice talking and say “What can you do?” ${assistantName} will confirm what was heard and Lesson 2 will appear here. This practice never opens another page.`, action: '🎙 Practice talking', run: async () => { const worked = await practiceTalk(); if (worked) advanceLearning() } },
    { title: 'Lesson 2: Use your list', copy: `${assistantName} will add “drink a glass of water” while this Today screen stays open.`, action: '✓ Practice adding a task', run: async () => practiceTask() },
    { title: 'Lesson 3: Save a note', copy: `${assistantName} will save a practice note while this Today screen stays open.`, action: '▤ Practice saving a note', run: async () => practiceNote() },
    { title: 'Lesson 4: Find Camera & Video', copy: 'The two large Camera and Video buttons are directly above this lesson. Tap below when you have found them.', action: '▣ I found both buttons', run: async () => { document.querySelector('[data-testid="camera-button"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); advanceLearning() } },
    { title: 'Lesson 5: Find More Help', copy: 'The More Help button is below the everyday tools. It opens ChatGPT when you choose to use it. This practice stays on Today.', action: '✦ Find More Help', run: async () => { document.querySelector('.chatgpt-quick')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); advanceLearning() } },
    { title: 'Lesson 6: Put Bigfoot on Home', copy: 'Tap Add my icon. When Samsung asks, tap Add. The app stays open so you cannot get stranded.', action: '＋ Add my icon', run: async () => { const requested = await addHomeIcon(); if (requested) advanceLearning() } },
    { title: 'Lesson 7: Go Home and come back', copy: 'Now tap Try HOME. On the Samsung Home screen, tap the Bigfoot Software logo labeled “Bigfoot v0.20 Custom Name” to return.', action: '⌂ Try HOME', run: async () => { advanceLearning(); await openPhoneHome() } },
  ][Math.min(6, state.preferences.learningStep)]
  return <div className="page home-page">
    <section className="welcome jarvis-welcome"><div className="welcome-copy"><span className="eyebrow">{assistantName.toUpperCase()} // PERSONAL ASSISTANT</span><h1>{timeGreeting()}, {name}.</h1><p>{todayTasks.length ? `You have ${todayTasks.length} thing${todayTasks.length === 1 ? '' : 's'} to take care of. I’ll help you handle them one at a time.` : 'Your list is clear. I’m ready whenever you are.'}</p><div className="system-ready"><i /> {assistantName.toUpperCase()} IS READY</div><small className="talk-example">Try saying: “What do I need to do today?”</small></div><button className="scout-core" onClick={() => void talk()} aria-label={`Start a conversation with ${assistantName}`}><span className="orbit orbit-one" /><span className="orbit orbit-two" /><span className="core-center"><em>✦</em><b>{assistantName.toUpperCase()}</b><small>TAP TO TALK</small></span></button></section>
    <section className="media-launcher" aria-label="Phone and camera shortcuts">
      <button className="media-button camera" data-testid="camera-button" onClick={() => void openCamera()}><span>▣</span><div><b>CAMERA</b><small>Take a photo</small></div></button>
      <button className="media-button video" data-testid="video-button" onClick={() => void openVideo()}><span>▶</span><div><b>VIDEO</b><small>Record a video</small></div></button>
      <button className="media-button call" data-testid="call-button" onClick={() => void openPhone()}><span>☎</span><div><b>CALL</b><small>Open phone dialer</small></div></button>
      <button className="media-button text" data-testid="text-button" onClick={() => void openTexts()}><span>✉</span><div><b>TEXT</b><small>Open text messages</small></div></button>
    </section>
    {state.preferences.learningStep < 7 ? <section className="panel learning-card" data-testid="lesson-card" data-lesson={state.preferences.learningStep + 1}><div className="learning-number">{state.preferences.learningStep + 1}</div><div><span className="eyebrow">LEARN ONE THING AT A TIME</span><h2>{lesson.title}</h2><p>{lesson.copy}</p><small>Lesson {state.preferences.learningStep + 1} of 7 · You can skip this lesson or exit the tutorial at any time.</small></div><div className="learning-actions"><button className="lesson-primary" data-testid="lesson-primary" onClick={() => void lesson.run()}>{lesson.action}</button><button className="lesson-skip" data-testid="lesson-skip" onClick={advanceLearning}>Skip this lesson →</button><button className="lesson-exit" data-testid="lesson-exit" onClick={finishLearning}>Exit tutorial and use the app</button></div></section> : <section className="panel learning-complete" data-testid="lessons-complete"><span>✓</span><div><b>You completed the starter lessons.</b><small>Use “Run Easy Setup Again” in Settings whenever you want a refresher.</small></div></section>}
    <div className="quick-grid">
      <button className="quick primary" onClick={() => ask('Manage my day. Review my open list and notes. Tell me what needs attention first and keep it short.')}><span>☀</span><b>Manage my day</b><small>Your list and notes — one simple plan.</small></button>
      <button className="quick" onClick={() => go('tasks')}><span>✓</span><b>What do I need to do?</b><small>{todayTasks.length} open for today</small></button>
      <button className="quick" onClick={() => ask('Set a timer for 10 minutes')}><span>◷</span><b>10-minute timer</b><small>Open Samsung Clock and start a timer.</small></button>
      <button className="quick" onClick={() => ask('What is on my shopping list?')}><span>🛒</span><b>Shopping list</b><small>Add an item by telling {assistantName}.</small></button>
      <button className="quick" onClick={() => ask('Open maps')}><span>⌖</span><b>Maps</b><small>Find a place or get directions.</small></button>
      <button className="quick" onClick={() => go('people')}><span>☎</span><b>Call someone</b><small>{lastCaller || `${state.people.filter(p => !p.deleted).length} people saved`}</small></button>
      <button className="quick chatgpt-quick" onClick={() => void openChatGPT()}><span>✦</span><b>More Help</b><small>Get help with a detailed question.</small></button>
    </div>
    {state.preferences.trustedHelperName && state.preferences.trustedHelperPhone ? <button className="helper-call" onClick={callHelper}><span>☎</span><b>Call My Helper</b><small>{state.preferences.trustedHelperName} · The phone will ask you to confirm first.</small></button> : <button className="helper-call not-set" onClick={() => go('settings')}><span>＋</span><b>Add a Trusted Helper</b><small>Save one person for a large, easy-to-find call button.</small></button>}
    <section className="panel today-panel"><div className="panel-head"><div><span className="eyebrow">TODAY</span><h2>Your short list</h2></div><button className="text-button" onClick={() => go('tasks')}>See all →</button></div>
      {todayTasks.length === 0 ? <div className="empty">✓ Nothing urgent. You’re caught up.</div> : todayTasks.slice(0, 4).map(t => <label className="task-row" key={t.id}><input type="checkbox" checked={t.done} onChange={() => toggleTask(t.id)} /><span><b>{t.text}</b><small>{t.due ? 'Due today or earlier' : 'No date'}</small></span>{t.important && <em>Important</em>}</label>)}
    </section>
    <p className="reassurance">🔒 Your personal actions stay under your control. Your assistant will ask before sending or changing anything important.</p>
  </div>
}

function Assistant({ state, thinking, listening, liveVoice, ask, listen, toggleLiveVoice, openChatGPT, goHome }: { state: AppState; thinking: boolean; listening: boolean; liveVoice: boolean; ask: (s: string) => void; listen: () => void; toggleLiveVoice: () => Promise<boolean>; openChatGPT: () => Promise<void>; goHome: () => void }) {
  const [input, setInput] = useState('')
  const assistantName = cleanAssistantName(state.preferences.assistantName)
  const bottom = useRef<HTMLDivElement>(null)
  useEffect(() => bottom.current?.scrollIntoView({ behavior: 'smooth' }), [state.chat, thinking])
  function submit(e: FormEvent) { e.preventDefault(); if (input.trim()) { ask(input); setInput('') } }
  const localMode = !state.preferences.apiBase.trim()
  return <div className="page assistant-page"><button className="assistant-home" data-testid="assistant-home" onClick={goHome}>← Return to Today</button><div className="page-title split"><div className="assistant-heading"><span className="assistant-orb">✦</span><div><span className="eyebrow">YOUR PERSONAL ASSISTANT</span><h1>{assistantName}</h1><p>Ask naturally about your list, notes, people and day.</p></div></div><button className={`live-talk ${liveVoice ? 'active' : ''}`} onClick={() => void toggleLiveVoice()}>🎙 {liveVoice ? 'End live conversation' : localMode ? `Talk to ${assistantName}` : 'Start live conversation'}</button></div>
    {localMode && <section className="panel chatgpt-bridge"><div><span className="eyebrow">MORE HELP</span><h2>Need a more detailed answer?</h2><p>Tap the button and continue speaking.</p></div><button onClick={() => void openChatGPT()}>✦ Continue</button></section>}
    <div className="chat panel">{state.chat.slice(-20).map((m, i) => <div key={i} className={`bubble ${m.role}`}><small>{m.role === 'assistant' ? assistantName : 'You'}</small>{m.text}</div>)}{thinking && <div className="bubble assistant thinking">{assistantName} is thinking <i>•••</i></div>}<div ref={bottom} /></div>
    <div className="suggestions"><button onClick={() => ask('Manage my day using my open list and notes. Tell me what to do first.')}>Manage my day</button><button onClick={() => ask('Set a timer for 10 minutes')}>Set a timer</button><button onClick={() => ask('Add milk to my shopping list')}>Add shopping item</button><button onClick={() => ask('Add call the doctor to my list')}>Add to my list</button><button onClick={() => ask('What can you help me with?')}>What can {assistantName} do?</button></div>
    <form className="ask-box" onSubmit={submit}><button type="button" className={listening ? 'listening' : ''} onClick={listen}>🎙</button><input value={input} onChange={e => setInput(e.target.value)} placeholder={`Ask ${assistantName} anything…`} aria-label={`Ask ${assistantName}`} /><button className="send">Send</button></form>
  </div>
}

function Email({ state, notify }: { state: AppState; notify: (s: string) => void }) {
  const assistantName = cleanAssistantName(state.preferences.assistantName)
  const writingMessage = `${assistantName} is writing a suggestion…`
  const isWritingMessage = (value: string) => value.endsWith(' is writing a suggestion…')
  const [messages, setMessages] = useState<EmailMessage[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [sending, setSending] = useState('')
  const [sent, setSent] = useState<Record<string, boolean>>({})
  const base = getCompanionBase(state.preferences.apiBase)
  const headers = { 'Content-Type': 'application/json', 'X-Bigfoot-Token': state.preferences.companionToken }

  async function suggest(message: EmailMessage) {
    setDrafts(d => ({ ...d, [message.id]: writingMessage }))
    try {
      const r = await fetch(`${base}/api/mail/suggest-reply`, { method: 'POST', headers, body: JSON.stringify({ email: message, userName: state.preferences.userName, assistantName }) })
      if (!r.ok) throw new Error()
      const data = await r.json() as { draft: string }
      setDrafts(d => ({ ...d, [message.id]: data.draft === 'NO_REPLY_NEEDED' ? 'No reply appears necessary.' : data.draft }))
    } catch { setDrafts(d => ({ ...d, [message.id]: 'Could not make a suggestion. Tap “Try suggestion again.”' })) }
  }

  async function load() {
    setLoading(true); setError('')
    try {
      const r = await fetch(`${base}/api/mail/inbox`, { headers: { 'X-Bigfoot-Token': state.preferences.companionToken } })
      if (!r.ok) throw new Error()
      const data = await r.json() as { messages: EmailMessage[] }
      setMessages(data.messages || [])
      setLoading(false)
      for (const message of data.messages || []) void suggest(message)
    } catch { setLoading(false); setError('Email is not connected yet. Open Settings and connect Gmail, then come back here.') }
  }

  useEffect(() => { void load() }, [state.preferences.apiBase, state.preferences.companionToken])

  async function sendReply(message: EmailMessage) {
    const draft = drafts[message.id]?.trim() || ''
    if (!draft || isWritingMessage(draft) || draft.startsWith('Could not ') || draft === 'No reply appears necessary.') return
    if (!window.confirm(`Send this reply to ${message.from}?\n\nNothing will be sent unless you choose OK.`)) return
    setSending(message.id)
    try {
      const r = await fetch(`${base}/api/mail/send-reply`, { method: 'POST', headers, body: JSON.stringify({ messageId: message.id, text: draft }) })
      if (!r.ok) throw new Error()
      setSent(s => ({ ...s, [message.id]: true })); notify('Your reply was sent.')
    } catch { notify('The reply was not sent. Please try again.') }
    finally { setSending('') }
  }

  return <div className="page email-page"><div className="page-title split"><div><span className="eyebrow">SIMPLE INBOX</span><h1>Important Email</h1><p>{assistantName} reads the newest useful messages and suggests a reply for you.</p></div><button className="email-refresh" onClick={() => void load()}>↻ Refresh email</button></div>
    <div className="email-safety">🔒 <b>You stay in control.</b> {assistantName} can write a suggested reply, but it will never send one until you approve it.</div>
    {loading && <section className="panel email-state">Checking your newest email…</section>}
    {error && <section className="panel email-state email-error"><b>Gmail needs attention.</b><span>{error}</span></section>}
    {!loading && !error && messages.length === 0 && <section className="panel email-state">No recent inbox messages need your attention.</section>}
    <div className="email-list">{messages.map(message => {
      const draft = drafts[message.id] || writingMessage
      const editable = !isWritingMessage(draft) && !draft.startsWith('Could not ') && draft !== 'No reply appears necessary.'
      return <article className={`panel email-card ${message.unread ? 'unread' : ''}`} key={message.id}>
        <div className="email-meta"><div><span className="eyebrow">{message.unread ? 'NEW MESSAGE' : 'RECENT MESSAGE'}</span><h2>{message.subject}</h2><b>{message.from}</b></div><small>{formatEmailDate(message.date)}</small></div>
        <p className="email-preview">{message.snippet || 'Open this message in Gmail to read the full content.'}</p>
        <button className="read-email" onClick={() => speak(`Email from ${message.from}. Subject: ${message.subject}. ${message.snippet}`, true, state.preferences.slowVoice)}>🔊 Read this email to me</button>
        <div className="reply-box"><div className="reply-title"><span>✦</span><div><b>{assistantPossessive(assistantName)} suggested reply</b><small>You can change any words before sending.</small></div></div>
          {editable ? <textarea value={draft} onChange={e => setDrafts(d => ({ ...d, [message.id]: e.target.value }))} aria-label={`Suggested reply to ${message.from}`} /> : <p className="draft-status">{draft}</p>}
          <div className="reply-actions"><button onClick={() => speak(draft, true, state.preferences.slowVoice)} disabled={!editable}>🔊 Read reply</button>{draft.startsWith('Could not ') && <button onClick={() => void suggest(message)}>Try suggestion again</button>}<button className="send-reply" onClick={() => void sendReply(message)} disabled={!editable || sending === message.id || sent[message.id]}>{sent[message.id] ? '✓ Sent' : sending === message.id ? 'Sending…' : 'Approve & send reply'}</button></div>
        </div>
      </article>
    })}</div>
  </div>
}

function Tasks({ state, onChange, notify }: { state: AppState; onChange: (s: AppState) => void; notify: (s: string) => void }) {
  const [text, setText] = useState(''); const [due, setDue] = useState(new Date().toISOString().slice(0, 10))
  const [googleTasks, setGoogleTasks] = useState<GoogleTask[]>([]); const [loadingGoogle, setLoadingGoogle] = useState(false)
  const tasks = state.tasks; const visible = tasks.filter(t => !t.deleted); const googleAvailable = Boolean(state.preferences.apiBase.trim()); const useGoogle = googleAvailable && state.preferences.taskSource === 'google'
  const headers = { 'Content-Type': 'application/json', 'X-Bigfoot-Token': state.preferences.companionToken }
  async function refreshGoogle() { setLoadingGoogle(true); try { const r = await fetch(`${getCompanionBase(state.preferences.apiBase)}/api/google/tasks`, { headers }); if (!r.ok) throw new Error(); const data = await r.json(); setGoogleTasks(data.tasks || []) } catch { notify('Google Tasks is not connected. You can switch back to This Phone.'); } finally { setLoadingGoogle(false) } }
  useEffect(() => { if (useGoogle) void refreshGoogle() }, [useGoogle, state.preferences.apiBase, state.preferences.companionToken])
  function choose(source: 'phone' | 'google') { onChange({ ...state, preferences: { ...state.preferences, taskSource: source } }) }
  async function add(e: FormEvent) {
    e.preventDefault(); if (!text.trim()) { notify('Type what you need to remember, then tap Add to my list.'); return }
    if (useGoogle) { try { const r = await fetch(`${getCompanionBase(state.preferences.apiBase)}/api/google/tasks`, { method: 'POST', headers, body: JSON.stringify({ title: text.trim(), due }) }); if (!r.ok) throw new Error(); notify(`Added “${text.trim()}” to Google Tasks.`); setText(''); await refreshGoogle() } catch { notify('Google Tasks could not add that. Nothing was lost — switch to This Phone to keep using the local list.') } return }
    const task: Task = { id: uid(), text: text.trim(), due, done: false, important: false, updatedAt: new Date().toISOString() }; onChange({ ...state, tasks: [task, ...tasks] }); setText(''); if (due) { const when = new Date(`${due}T09:00:00`); if (when > new Date()) await scheduleReminder(Number(Date.now().toString().slice(-8)), "Bigfoot's Day", task.text, when) } notify(`Added “${task.text}” to your phone list.`)
  }
  async function toggleGoogle(task: GoogleTask) { try { const r = await fetch(`${getCompanionBase(state.preferences.apiBase)}/api/google/tasks/update`, { method: 'POST', headers, body: JSON.stringify({ id: task.id, completed: task.status !== 'completed' }) }); if (!r.ok) throw new Error(); await refreshGoogle() } catch { notify('Google Tasks could not update that item. Please try again.') } }
  return <div className="page"><div className="page-title"><div><span className="eyebrow">KEEP IT SIMPLE</span><h1>My List</h1><p>Choose Google Tasks or keep everything privately on this phone.</p></div></div>
    <section className="panel task-source"><h2>Where should tasks be kept?</h2><div><button className={!useGoogle ? 'selected' : ''} onClick={() => choose('phone')}><b>📱 This Phone</b><small>Works without Google or internet.</small></button><button disabled={!googleAvailable} className={useGoogle ? 'selected' : ''} onClick={() => choose('google')}><b>G Google Tasks</b><small>{googleAvailable ? 'Use the connected Google account.' : 'Connect Google in Settings first.'}</small></button></div></section>
    <form className="add-form panel" onSubmit={add}><label>What do you need to remember?<input value={text} onChange={e => setText(e.target.value)} placeholder="Example: Call the doctor" /></label><label>When?<input type="date" value={due} onChange={e => setDue(e.target.value)} /></label><button>Add to {useGoogle ? 'Google Tasks' : 'my phone list'}</button></form>
    <section className="panel list-panel">{useGoogle ? loadingGoogle ? <div className="empty">Loading Google Tasks…</div> : googleTasks.length === 0 ? <div className="empty">Your Google Tasks list is empty.</div> : googleTasks.map(t => <div className={`task-row ${t.status === 'completed' ? 'done' : ''}`} key={t.id}><input type="checkbox" checked={t.status === 'completed'} onChange={() => void toggleGoogle(t)} /><span><b>{t.title}</b><small>{t.due ? t.due.slice(0, 10) : 'Any time'} · Google Tasks</small></span></div>) : visible.length === 0 ? <div className="empty">Your phone list is empty.</div> : visible.map(t => <div className={`task-row ${t.done ? 'done' : ''}`} key={t.id}><input type="checkbox" aria-label={`Mark ${t.text} ${t.done ? 'not done' : 'done'}`} checked={t.done} onChange={() => onChange({ ...state, tasks: tasks.map(x => x.id === t.id ? { ...x, done: !x.done, updatedAt: new Date().toISOString() } : x) })} /><span><b>{t.text}</b><small>{t.due || 'Any time'} · This phone</small></span><button className="star" aria-label={`${t.important ? 'Remove important mark from' : 'Mark important'} ${t.text}`} onClick={() => onChange({ ...state, tasks: tasks.map(x => x.id === t.id ? { ...x, important: !x.important, updatedAt: new Date().toISOString() } : x) })}>{t.important ? '★' : '☆'}</button><button className="delete" onClick={() => { if (!window.confirm(`Remove “${t.text}” from your list? Tap Cancel to keep it.`)) return; onChange({ ...state, tasks: tasks.map(x => x.id === t.id ? { ...x, deleted: true, updatedAt: new Date().toISOString() } : x) }); notify('The item was removed.') }}>Remove</button></div>)}</section>
  </div>
}

function CalendarPage({ state, notify }: { state: AppState; notify: (s: string) => void }) {
  const tomorrow = new Date(Date.now() + 86400000); const defaultDate = tomorrow.toISOString().slice(0, 10)
  const [title, setTitle] = useState(''); const [date, setDate] = useState(defaultDate); const [time, setTime] = useState('10:00'); const [guests, setGuests] = useState('')
  const dated = state.tasks.filter(t => !t.deleted && t.due).sort((a, b) => a.due.localeCompare(b.due)).slice(0, 12)
  async function add(e: FormEvent) { e.preventDefault(); if (!title.trim()) { notify('Enter an appointment name first.'); return } const start = new Date(`${date}T${time}:00`); if (Number.isNaN(start.getTime())) { notify('Check the appointment date and time.'); return } const emails = guests.split(/[,;\s]+/).filter(x => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)); const opened = await addCalendarEvent(title.trim(), start.getTime(), start.getTime() + 3600000, emails); notify(opened ? 'Your calendar opened. Check the details, choose the account, then tap Save.' : 'The phone calendar could not open.') }
  return <div className="page calendar-page"><div className="page-title split"><div><span className="eyebrow">APPOINTMENTS</span><h1>Calendar</h1><p>Works with Samsung Calendar, Google Calendar, or any calendar installed on this phone.</p></div><button className="secondary" onClick={() => void openCalendar()}>Open my calendar</button></div>
    <form className="panel calendar-form" onSubmit={add}><label>Appointment or event<input value={title} onChange={e => setTitle(e.target.value)} placeholder="Example: Doctor appointment" /></label><label>Date<input type="date" value={date} onChange={e => setDate(e.target.value)} /></label><label>Time<input type="time" value={time} onChange={e => setTime(e.target.value)} /></label><label>Invite people by email — optional<input value={guests} onChange={e => setGuests(e.target.value)} placeholder="name@example.com" /></label><button>Review in my calendar</button><p>Your calendar opens before saving. Nothing is sent until you review it and tap Save.</p></form>
    <section className="panel list-panel"><div className="panel-head"><h2>Dated items from your phone list</h2></div>{dated.length ? dated.map(t => <div className="task-row" key={t.id}><span><b>{t.text}</b><small>{t.due}</small></span></div>) : <div className="empty">No dated tasks yet.</div>}</section>
  </div>
}

function People({ people, onChange, notify, onCallerAccess }: { people: Person[]; onChange: (p: Person[]) => void; notify: (s: string) => void; onCallerAccess: () => void }) {
  const [name, setName] = useState(''); const [phone, setPhone] = useState(''); const [relationship, setRelationship] = useState('')
  const visible = people.filter(p => !p.deleted)
  function add(e: FormEvent) { e.preventDefault(); if (!name.trim() || !phone.trim()) { notify('Enter both a name and a phone number, then tap Save person.'); return } if (phone.replace(/\D/g, '').length < 7) { notify('That phone number looks too short. Please check it and try again.'); return } const savedName = name.trim(); onChange([{ id: uid(), name: savedName, phone: phone.trim(), relationship: relationship.trim(), favorite: false, updatedAt: new Date().toISOString() }, ...people]); setName(''); setPhone(''); setRelationship(''); notify(`${savedName} was saved.`) }
  async function importContacts() {
    const result = await importPhoneContacts()
    if (!result.granted) { notify('Phonebook permission was not granted. You can still add people by hand.'); return }
    const existing = new Set(people.filter(p => !p.deleted).map(p => `${p.name.toLowerCase()}\u0000${normalizePhone(p.phone)}`))
    const stamp = new Date().toISOString()
    const added = result.people.filter(p => !existing.has(`${p.name.toLowerCase()}\u0000${normalizePhone(p.phone)}`)).map(p => ({ id: uid(), name: p.name, phone: p.phone, relationship: 'Phonebook', favorite: false, updatedAt: stamp }))
    onChange([...added, ...people])
    notify(added.length ? `Imported ${added.length} people from your phonebook.` : 'Your phonebook is already up to date.')
  }
  return <div className="page"><div className="page-title split"><div><span className="eyebrow">YOUR PEOPLE</span><h1>People</h1><p>Keep important people easy to reach.</p></div><button className="secondary" onClick={onCallerAccess}>Turn on caller ID</button></div>
    <section className="panel phonebook-import"><div><h2>Bring in your phonebook</h2><p>Import names and phone numbers already saved on this phone. Duplicates are skipped.</p></div><button data-testid="import-phonebook" onClick={() => void importContacts()}>Import from Phonebook</button></section>
    <form className="add-form panel" onSubmit={add}><label>Name<input value={name} onChange={e => setName(e.target.value)} placeholder="Jane Smith" /></label><label>Phone<input value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" placeholder="(555) 123-4567" /></label><label>Who are they?<input value={relationship} onChange={e => setRelationship(e.target.value)} placeholder="Daughter, doctor…" /></label><button>Save person</button></form>
    <div className="people-grid">{visible.length === 0 ? <div className="panel empty">No people saved yet. Add someone above.</div> : visible.map(p => <div className="person-card panel" key={p.id}><div className="avatar">{p.name.slice(0, 1).toUpperCase()}</div><div><h3>{p.name}</h3><p>{p.relationship || 'Contact'}</p><span className="phone-number">{p.phone}</span></div><button className="call" onClick={() => placeConfirmedCall(p.name, p.phone)}>☎ Call</button><button className="delete" onClick={() => { if (!window.confirm(`Remove ${p.name} from People? Tap Cancel to keep this person.`)) return; onChange(people.map(x => x.id === p.id ? { ...x, deleted: true, updatedAt: new Date().toISOString() } : x)); notify(`${p.name} was removed.`) }}>Remove</button></div>)}</div>
  </div>
}

function Notes({ assistantName, notes, onChange, notify }: { assistantName: string; notes: AppState['notes']; onChange: (n: AppState['notes']) => void; notify: (s: string) => void }) {
  const [text, setText] = useState('')
  const visible = notes.filter(n => !n.deleted)
  function add(e: FormEvent) { e.preventDefault(); if (!text.trim()) { notify('Type your note first, then tap Save note.'); return } const now = new Date().toISOString(); onChange([{ id: uid(), text: text.trim(), createdAt: now, updatedAt: now }, ...notes]); setText(''); notify('Your note was saved.') }
  return <div className="page"><div className="page-title"><div><span className="eyebrow">DON’T LOSE THE THOUGHT</span><h1>Notes</h1><p>Quick notes {assistantName} can use when helping you.</p></div></div><form className="note-form panel" onSubmit={add}><textarea value={text} onChange={e => setText(e.target.value)} placeholder="Write a note…" /><button>Save note</button></form><div className="notes-grid">{visible.map(n => <article className="note panel" key={n.id}><p>{n.text}</p><small>{new Date(n.createdAt).toLocaleString()}</small><button className="delete" onClick={() => { if (!window.confirm('Remove this note? Tap Cancel to keep it.')) return; onChange(notes.map(x => x.id === n.id ? { ...x, deleted: true, updatedAt: new Date().toISOString() } : x)); notify('The note was removed.') }}>Remove</button></article>)}</div></div>
}

function Settings({ state, onChange, notify, onRunSetup, onAddHomeShortcut, onReset }: { state: AppState; onChange: (s: AppState) => void; notify: (s: string) => void; onRunSetup: () => void; onAddHomeShortcut: () => void; onReset: () => void }) {
  const p = state.preferences; const set = (key: keyof typeof p, value: string | boolean) => onChange({ ...state, chat: key === 'assistantName' ? state.chat.map(message => message.role === 'assistant' ? { ...message, text: personalizeStarterGreeting(message.text, String(value)) } : message) : state.chat, preferences: { ...p, [key]: value } })
  const assistantName = cleanAssistantName(p.assistantName)
  const companionBase = () => p.apiBase.trim().replace(/\/$/, '') || (location.protocol === 'file:' ? 'http://127.0.0.1:8787' : '')
  async function sync(mode: 'save' | 'load') {
    try {
      const headers = { 'Content-Type': 'application/json', 'X-Bigfoot-Token': p.companionToken }
      if (mode === 'save') {
        const r = await fetch(`${companionBase()}/api/sync`, { method: 'PUT', headers, body: JSON.stringify({ tasks: state.tasks, people: state.people, notes: state.notes, chat: state.chat }) })
        if (!r.ok) throw new Error()
        notify('Saved to your companion. Your other device can load it now.')
      } else {
        const r = await fetch(`${companionBase()}/api/sync`, { headers })
        if (!r.ok) throw new Error()
        const data = await r.json() as Partial<AppState> & { empty?: boolean }
        if (data.empty) { notify('Nothing has been saved to the companion yet.'); return }
        onChange({ ...state, tasks: data.tasks || state.tasks, people: data.people || state.people, notes: data.notes || state.notes, chat: data.chat || state.chat })
        notify('This device is up to date.')
      }
    } catch { notify('Could not reach your companion. Check the address and private code.') }
  }
  return <div className="page settings"><div className="page-title"><div><span className="eyebrow">MAKE IT YOURS</span><h1>Settings</h1><p>Big controls. Plain language. Nothing hidden.</p></div></div>
    <section className="panel setup-again"><div><h2>Need help setting things up?</h2><p>We can walk through setup together again, one step at a time. Your saved information will stay here.</p></div><button onClick={onRunSetup}>Run Easy Setup Again</button></section>
    <section className="panel setup-again"><div><h2>Put your app on the Home screen</h2><p>This is optional and no longer interrupts setup. Samsung may show an Add to Home confirmation.</p></div><button onClick={onAddHomeShortcut}>Add Icon to Home</button></section>
    <section className="panel settings-group"><h2>You & {assistantName}</h2><label>Your first name<input value={p.userName} onChange={e => set('userName', e.target.value)} /></label><label>Assistant name<input data-testid="settings-assistant-name" maxLength={24} value={p.assistantName} onChange={e => set('assistantName', e.target.value)} onBlur={() => set('assistantName', assistantName)} placeholder="Assistant name" /></label><p className="hint">Change this name whenever you like. It updates the app, lessons, voice controls, and assistant replies.</p></section>
    <section className="panel settings-group"><h2>Easy to see & hear</h2><Toggle label="Speak answers out loud" value={p.voice} set={v => set('voice', v)} /><Toggle label="Use slower speech" value={p.slowVoice} set={v => set('slowVoice', v)} /><Toggle label="Use larger text" value={p.largeText} set={v => set('largeText', v)} /><Toggle label="Extra-high contrast" value={p.highContrast} set={v => set('highContrast', v)} /><button className="settings-voice-sample" onClick={() => void speak(`Hi ${p.userName || 'there'}. This is ${assistantName} using your chosen speaking pace.`, true, p.slowVoice)}>🔊 Hear {assistantPossessive(assistantName)} voice</button></section>
    <section className="panel settings-group"><h2>Trusted helper</h2><p className="hint">Optional. This person appears on a large button on Today. Every call requires confirmation.</p><label>Helper’s name<input value={p.trustedHelperName} onChange={e => set('trustedHelperName', e.target.value)} placeholder="Name" /></label><label>Helper’s phone number<input type="tel" inputMode="tel" value={p.trustedHelperPhone} onChange={e => set('trustedHelperPhone', e.target.value)} placeholder="Phone number" /></label></section>
    {p.apiBase.trim() && <GoogleConnection assistantName={assistantName} apiBase={p.apiBase} companionToken={p.companionToken} notify={notify} />}
    <details className="panel settings-group advanced-settings"><summary>Settings for a helper</summary><p className="hint">Most people never need to open this section.</p><label>Assistant service address<input value={p.apiBase} onChange={e => set('apiBase', e.target.value)} placeholder="Service address" /></label><label>Private connection code<input type="password" value={p.companionToken} onChange={e => set('companionToken', e.target.value)} placeholder="Private code" autoComplete="off" /></label><Toggle label="Keep devices automatically in sync" value={p.autoSync} set={v => set('autoSync', v)} /><div className="sync-actions"><button onClick={() => void sync('save')}>Save to companion</button><button onClick={() => void sync('load')}>Load from companion</button></div></details>
    <section className="panel danger-zone"><h2>Start over</h2><p>This clears your tasks, contacts, notes and preferences on this device.</p><button onClick={onReset}>Reset this device</button></section>
  </div>
}

function GoogleConnection({ assistantName, apiBase, companionToken, notify }: { assistantName: string; apiBase: string; companionToken: string; notify: (s: string) => void }) {
  const [connected, setConnected] = useState(false)
  const [email, setEmail] = useState('')
  const [checking, setChecking] = useState(true)
  const base = getCompanionBase(apiBase)
  const headers = { 'X-Bigfoot-Token': companionToken }
  async function check() {
    try { const r = await fetch(`${base}/api/google/status`, { headers }); const data = await r.json(); setConnected(Boolean(data.connected)); setEmail(data.email || '') } catch { setConnected(false) } finally { setChecking(false) }
  }
  useEffect(() => { void check() }, [apiBase, companionToken])
  async function connect() {
    try {
      const r = await fetch(`${base}/api/google/auth-url`, { headers })
      if (!r.ok) throw new Error()
      const data = await r.json() as { url: string }
      window.open(data.url, '_blank', 'noopener,noreferrer')
      notify('Finish signing in with Google, then return here.')
      let tries = 0
      const timer = window.setInterval(async () => { tries++; await check(); if (tries >= 20) clearInterval(timer) }, 3000)
    } catch { notify('Google connection is not configured on the companion service yet.') }
  }
  return <section className="panel settings-group google-connect"><h2>Gmail, Google Tasks & Calendar</h2><p className="hint">Optional. Connect once so {assistantName} can show email, use Google Tasks, and help with your Google Calendar. Google shows every permission before approval, and your app never asks for your Google password.</p><div className={`connection-row ${connected ? '' : 'offline'}`}><span className="status-dot" /> {checking ? 'Checking Google…' : connected ? `Connected${email ? ` as ${email}` : ''}` : 'Not connected — phone tasks and calendar still work'}</div><div className="sync-actions">{!connected && <button onClick={() => void connect()}>Connect Google</button>}<button onClick={() => void check()}>Check connection</button></div></section>
}

function Toggle({ label, value, set }: { label: string; value: boolean; set: (v: boolean) => void }) { return <label className="toggle-row"><span>{label}</span><button className={`switch ${value ? 'on' : ''}`} onClick={() => set(!value)} aria-pressed={value}><i /></button></label> }

function normalizePhone(v: string) { return v.replace(/\D/g, '').slice(-10) }
function getCompanionBase(value: string) { return value.trim().replace(/\/$/, '') || (location.protocol === 'file:' ? 'http://127.0.0.1:8787' : '') }
function formatEmailDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) }

export type AssistantAction =
  | { type: 'timer'; seconds: number; label: string }
  | { type: 'alarm'; hour: number; minute: number; label: string }
  | { type: 'map'; query: string }
  | { type: 'camera' }
  | { type: 'video' }
  | { type: 'dialer' }
  | { type: 'text' }
  | { type: 'calendar'; title: string; startTime: number; endTime: number; guests: string[] }
  | { type: 'calendar-open' }
  | { type: 'google-task'; title: string; due: string }
  | { type: 'settings' }
  | { type: 'chatgpt' }
  | { type: 'call'; phone: string }

type LocalAssistantResult = { reply: string; changes?: Partial<AppState>; action?: AssistantAction }

export function localAssistant(text: string, state: AppState): LocalAssistantResult {
  const q = text.toLowerCase().trim()
  const now = new Date()
  const stamp = now.toISOString()
  const today = stamp.slice(0, 10)
  const open = state.tasks.filter(t => !t.deleted && !t.done)
  const assistantName = cleanAssistantName(state.preferences.assistantName)

  const calendarMatch = text.match(/^(?:please\s+)?(?:schedule|add|create)\s+(?:a\s+|an\s+)?(.+?)\s+(today|tomorrow|on\s+\d{4}-\d{2}-\d{2})\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i)
  if (calendarMatch) {
    const day = calendarMatch[2].toLowerCase(); const start = new Date(now)
    if (day === 'tomorrow') start.setDate(start.getDate() + 1)
    if (day.startsWith('on ')) { const parsed = new Date(`${day.slice(3)}T12:00:00`); if (!Number.isNaN(parsed.getTime())) start.setFullYear(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()) }
    let hour = Number(calendarMatch[3]) % 12; if (calendarMatch[5].toLowerCase().startsWith('p')) hour += 12
    const minute = Number(calendarMatch[4] || 0); start.setHours(hour, minute, 0, 0)
    const title = calendarMatch[1].replace(/^(?:calendar\s+)?(?:event|appointment|meeting|invite)\s+(?:called|for)\s+/i, '').replace(/\s+(?:and\s+)?invite\s+.+$/i, '').trim()
    const guests = [...text.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)].map(match => match[0])
    return { reply: `I’m opening your calendar with ${title} filled in. Review the details and guests, then tap Save.`, action: { type: 'calendar', title, startTime: start.getTime(), endTime: start.getTime() + 3600000, guests } }
  }

  const timerMatch = text.match(/\bset\s+(?:a\s+)?timer(?:\s+for)?\s+(\d+)\s*(second|minute|hour)s?\b/i)
  if (timerMatch) {
    const amount = Number(timerMatch[1])
    const multiplier = timerMatch[2].toLowerCase() === 'hour' ? 3600 : timerMatch[2].toLowerCase() === 'minute' ? 60 : 1
    const seconds = Math.min(86399, Math.max(1, amount * multiplier))
    return { reply: `I’m opening Samsung Clock with a ${amount} ${timerMatch[2]} timer. Tap Start if the phone asks.`, action: { type: 'timer', seconds, label: `${assistantName}'s timer` } }
  }

  const alarmMatch = text.match(/\bset\s+(?:an\s+)?alarm(?:\s+(?:for|at))?\s+(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i)
  if (alarmMatch) {
    let hour = Number(alarmMatch[1]) % 12
    const minute = Number(alarmMatch[2] || 0)
    const evening = alarmMatch[3].toLowerCase().startsWith('p')
    if (evening) hour += 12
    if (minute > 59) return { reply: 'That alarm time is not valid. Try saying, set an alarm for 7:30 AM.' }
    const spokenTime = `${Number(alarmMatch[1])}:${String(minute).padStart(2, '0')} ${evening ? 'PM' : 'AM'}`
    return { reply: `I’m opening Samsung Clock with an alarm for ${spokenTime}. Check it, then tap Save.`, action: { type: 'alarm', hour, minute, label: "Bigfoot's Day" } }
  }

  const shoppingMatch = text.match(/^(?:please\s+)?(?:add|put)\s+(.+?)\s+(?:to|on)\s+(?:my\s+)?shopping\s+list[.!?]*$/i)
  if (shoppingMatch?.[1]?.trim()) {
    const item = shoppingMatch[1].trim().replace(/[.!?]+$/, '')
    const task: Task = { id: uid(), text: `Shopping — ${item}`, due: today, done: false, important: false, updatedAt: stamp }
    return { reply: `Done. I added ${item} to your shopping list.`, changes: { tasks: [task, ...state.tasks] } }
  }

  if (/\b(?:what(?:'s| is)|read|show)\s+(?:is\s+)?(?:on\s+)?(?:my\s+)?shopping\s+list\b/i.test(q)) {
    const shopping = open.filter(t => t.text.toLowerCase().startsWith('shopping —')).map(t => t.text.replace(/^Shopping —\s*/i, ''))
    return { reply: shopping.length ? `Your shopping list has ${shopping.length} item${shopping.length === 1 ? '' : 's'}: ${shopping.join(', ')}.` : 'Your shopping list is empty. Say, add milk to my shopping list.' }
  }

  const mapMatch = text.match(/^(?:please\s+)?(?:open\s+maps?|map|directions?|navigate)(?:\s+(?:to|for))?\s*(.*?)[.!?]*$/i)
  if (mapMatch) {
    const query = mapMatch[1].trim()
    return { reply: query ? `I’m opening Maps for ${query}.` : 'I’m opening Maps. Tell Maps where you want to go.', action: { type: 'map', query } }
  }

  if (/^(?:please\s+)?(?:open|start)\s+(?:the\s+)?(?:video camera|camera video|video recorder)[.!?]*$/i.test(text)) return { reply: 'I’m opening the camera in video mode.', action: { type: 'video' } }
  if (/^(?:please\s+)?(?:open|start)\s+(?:the\s+)?(?:photo )?camera[.!?]*$/i.test(text)) return { reply: 'I’m opening the camera for a picture.', action: { type: 'camera' } }
  if (/^(?:please\s+)?(?:open|show)\s+(?:the\s+)?(?:phone|dialer)[.!?]*$/i.test(text)) return { reply: 'I’m opening the phone dialer.', action: { type: 'dialer' } }
  if (/^(?:please\s+)?(?:open|show)\s+(?:the\s+)?(?:text|texts|messages|text messages)[.!?]*$/i.test(text)) return { reply: 'I’m opening your text messages.', action: { type: 'text' } }
  if (/^(?:please\s+)?(?:open|show)\s+(?:my\s+|the\s+)?calendar[.!?]*$/i.test(text)) return { reply: 'I’m opening your phone calendar.', action: { type: 'calendar-open' } }
  if (/^(?:please\s+)?open\s+(?:phone\s+|device\s+)?settings[.!?]*$/i.test(text)) return { reply: 'I’m opening your phone settings.', action: { type: 'settings' } }
  if (/^(?:please\s+)?(?:open|continue (?:in|with)|use)\s+(?:the\s+)?chatgpt[.!?]*$/i.test(text)) return { reply: 'I’m opening ChatGPT for more detailed help.', action: { type: 'chatgpt' } }

  const callMatch = text.match(/^(?:please\s+)?call\s+(.+?)[.!?]*$/i)
  if (callMatch?.[1]) {
    const wanted = callMatch[1].trim().toLowerCase()
    const person = state.people.find(p => !p.deleted && (p.name.toLowerCase().includes(wanted) || wanted.includes(p.name.toLowerCase())))
    return person ? { reply: `I’m opening the phone for ${person.name}. Check the number, then tap Call.`, action: { type: 'call', phone: person.phone } } : { reply: `I could not find ${callMatch[1].trim()} in People. Add them there first so I use the right number.` }
  }

  const addTask = text.match(/^(?:please\s+)?(?:add|put)\s+(.+?)(?:\s+to\s+(?:my\s+)?list)$/i)
    || text.match(/^(?:please\s+)?(?:remind me to|remember to)\s+(.+)$/i)
  if (addTask?.[1]?.trim()) {
    const taskText = addTask[1].trim().replace(/[.!?]+$/, '')
    if (state.preferences.taskSource === 'google' && state.preferences.apiBase.trim()) return { reply: `I’ll add ${taskText} to Google Tasks.`, action: { type: 'google-task', title: taskText, due: today } }
    const task: Task = { id: uid(), text: taskText, due: today, done: false, important: false, updatedAt: stamp }
    return { reply: `Done. I added ${taskText} to today’s list.`, changes: { tasks: [task, ...state.tasks] } }
  }

  const noteMatch = text.match(/^(?:please\s+)?(?:make|save|write)\s+(?:a\s+)?note(?:\s+that|\s+saying|\s+to)?\s+(.+)$/i)
  if (noteMatch?.[1]?.trim()) {
    const noteText = noteMatch[1].trim().replace(/[.!?]+$/, '')
    const note = { id: uid(), text: noteText, createdAt: stamp, updatedAt: stamp }
    return { reply: `I saved your note: ${noteText}.`, changes: { notes: [note, ...state.notes] } }
  }

  const completeMatch = text.match(/^(?:please\s+)?(?:finish|complete|mark)\s+(.+?)(?:\s+(?:as\s+)?done)?$/i)
  if (completeMatch?.[1]?.trim()) {
    const search = completeMatch[1].trim().toLowerCase()
    const found = open.find(t => t.text.toLowerCase().includes(search) || search.includes(t.text.toLowerCase()))
    if (!found) return { reply: `I couldn’t find ${completeMatch[1].trim()} on your open list.` }
    return { reply: `Done. I marked ${found.text} complete.`, changes: { tasks: state.tasks.map(t => t.id === found.id ? { ...t, done: true, updatedAt: stamp } : t) } }
  }

  if (/\b(?:what(?:'s| is) the time|time is it)\b/.test(q)) {
    return { reply: `It is ${now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}.` }
  }
  if (/\b(?:what(?:'s| is) (?:the )?date|what day is it)\b/.test(q)) {
    return { reply: `Today is ${now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}.` }
  }
  if (/help|what can you do/.test(q)) {
    return { reply: 'I can manage your day; read and update your list; keep shopping items and notes; set Samsung timers and alarms; open Maps, the camera, and phone settings; call a saved person; tell the time; announce recognized callers; and open ChatGPT for detailed help. For example, say: set a timer for 10 minutes.' }
  }
  if (/brief|today|focus|list|need to do|manage my day|what.*next/.test(q)) {
    if (!open.length) return { reply: 'Your list is clear right now. You’re all caught up.' }
    const top = [...open].sort((a, b) => Number(b.important) - Number(a.important)).slice(0, 4).map((t, i) => `${i + 1}, ${t.text}`).join('. ')
    const notes = state.notes.filter(n => !n.deleted).length
    return { reply: `Here’s what I’d focus on. ${top}. ${notes ? `You also have ${notes} saved note${notes === 1 ? '' : 's'}.` : ''} Take things one at a time.` }
  }
  if (/who.*call|contact|phone|people/.test(q)) {
    const count = state.people.filter(p => !p.deleted).length
    return { reply: count ? `You have ${count} people saved. Open People to call someone.` : 'You have no people saved yet. Open People and add the people you call most.' }
  }
  return { reply: 'I can help with your list, notes, people and daily plan. For a detailed question, tap More Help.' }
}

export default App
