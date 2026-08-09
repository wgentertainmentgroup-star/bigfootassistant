import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { defaultState, loadState, saveState } from './storage'
import { getLastCaller, isAndroid, openChatGPT, requestCallerIdAccess, requestHomeShortcut, requestNotificationAccess, requestVoiceInput, scheduleReminder, syncPeopleForCallerId } from './native'
import { listen, speak } from './voice'
import { startRealtimeVoice, type RealtimeController } from './realtime'
import type { AppState, EmailMessage, Person, Section, Task } from './types'

const icon: Record<Section, string> = { home: '⌂', assistant: '✦', email: '✉', tasks: '✓', people: '☎', notes: '▤', settings: '⚙' }
const label: Record<Section, string> = { home: 'Today', assistant: 'Ask Bubba', email: 'Email', tasks: 'My List', people: 'People', notes: 'Notes', settings: 'Settings' }
const setupMarker = 'bigfoots-day-easy-setup-v6'

function uid() { return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}` }
function localDate() { return new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) }
function timeGreeting() { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening' }

async function captureVoiceOnce(): Promise<{ text: string; error: string }> {
  if (isAndroid()) return requestVoiceInput()
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
  const stateRef = useRef(state)
  const realtimeRef = useRef<RealtimeController | null>(null)
  stateRef.current = state

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

  const todayTasks = useMemo(() => state.tasks.filter(t => !t.deleted && !t.done && (!t.due || t.due <= new Date().toISOString().slice(0, 10))), [state.tasks])

  function patch(next: Partial<AppState>) { setState(s => ({ ...s, ...next })) }
  function notify(message: string) { setToast(message); window.setTimeout(() => setToast(''), 2600) }

  async function askAssistant(message: string) {
    const text = message.trim()
    if (!text) return
    const userMessage = { role: 'user' as const, text }
    setState(s => ({ ...s, chat: [...s.chat, userMessage] }))
    setSection('assistant')
    setThinking(true)
    try {
      const configuredBase = state.preferences.apiBase.trim().replace(/\/$/, '')
      if (!configuredBase) throw new Error('Using local Bubba')
      const base = configuredBase || (location.protocol === 'file:' ? 'http://127.0.0.1:8787' : '')
      const response = await fetch(`${base}/api/assistant`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bigfoot-Token': state.preferences.companionToken },
        body: JSON.stringify({ message: text, history: state.chat.slice(-10), context: { tasks: state.tasks, people: state.people, notes: state.notes.slice(-10), userName: state.preferences.userName } }),
      })
      if (!response.ok) throw new Error('Assistant is offline')
      const data = await response.json() as { text: string; action?: { type: string; text?: string } }
      setState(s => ({ ...s, chat: [...s.chat, { role: 'assistant', text: data.text }] }))
      speak(data.text, state.preferences.voice)
    } catch {
      const result = localAssistant(text, stateRef.current)
      setState(s => ({ ...s, ...result.changes, chat: [...s.chat, { role: 'assistant', text: result.reply }] }))
      speak(result.reply, state.preferences.voice)
    } finally { setThinking(false) }
  }

  async function startListening() {
    setListening(true)
    const result = await captureVoiceOnce()
    setListening(false)
    if (result.text) await askAssistant(result.text)
    else notify(result.error || 'I didn’t hear anything. Tap the microphone and try again.')
  }

  async function toggleLiveVoice() {
    if (realtimeRef.current) {
      realtimeRef.current.stop(); realtimeRef.current = null; setLiveVoice(false); notify('Live conversation ended.'); return
    }
    if (!state.preferences.apiBase.trim()) {
      setSection('assistant')
      await startListening()
      return
    }
    try {
      setSection('assistant')
      notify('Starting live Bubba…')
      realtimeRef.current = await startRealtimeVoice({
        apiBase: state.preferences.apiBase,
        companionToken: state.preferences.companionToken,
        onStatus: () => { setLiveVoice(true); notify('Bubba is listening. Just speak naturally.') },
        onAssistantText: text => setState(s => ({ ...s, chat: [...s.chat, { role: 'assistant', text }] })),
      })
      setLiveVoice(true)
    } catch { setLiveVoice(false); notify('Live Bubba could not connect. Check Settings and microphone permission.') }
  }

  async function launchChatGPT() {
    const opened = await openChatGPT()
    if (!opened) notify('ChatGPT could not open. Install the official ChatGPT app and try again.')
  }

  const rootClass = `${state.preferences.largeText ? 'large-text' : ''} ${state.preferences.highContrast ? 'high-contrast' : ''}`
  if (showSetup) return <SetupWizard state={state} onChange={setState} onFinish={() => { setState(s => ({ ...s, preferences: { ...s.preferences, setupComplete: true } })); localStorage.setItem(setupMarker, 'done'); void requestHomeShortcut(); setShowSetup(false); setSection('home') }} />
  return <div className={`app ${rootClass}`}>
    <header className="topbar">
      <button className="brand" onClick={() => setSection('home')} aria-label="Bigfoot's Day home">
        <span className="paw">🐾</span><span><b>Bigfoot’s Day</b><small>Your day. Made simple.</small></span>
      </button>
      <div className="date-chip"><span className="status-dot" /> {localDate()}</div>
    </header>

    <div className="layout">
      <nav className="sidebar" aria-label="Main navigation">
        {(Object.keys(label) as Section[]).filter(key => key !== 'email' || Boolean(state.preferences.apiBase.trim())).map(key => <button key={key} className={section === key ? 'active' : ''} onClick={() => setSection(key)}>
          <span className="nav-icon">{icon[key]}</span><span>{label[key]}</span>
        </button>)}
        <div className="help-card"><b>Need help?</b><span>Say “Bubba, help me.”</span><button onClick={() => void toggleLiveVoice()}>🎙 {liveVoice ? 'End live talk' : 'Talk to Bubba'}</button></div>
      </nav>

      <main>
        {section === 'home' && <Home state={state} todayTasks={todayTasks} lastCaller={lastCaller} go={setSection} ask={askAssistant} talk={toggleLiveVoice} openChatGPT={launchChatGPT} advanceLearning={() => setState(s => ({ ...s, preferences: { ...s.preferences, learningStep: Math.min(4, s.preferences.learningStep + 1) } }))} toggleTask={id => patch({ tasks: state.tasks.map(t => t.id === id ? { ...t, done: !t.done, updatedAt: new Date().toISOString() } : t) })} />}
        {section === 'assistant' && <Assistant state={state} thinking={thinking} listening={listening} liveVoice={liveVoice} ask={askAssistant} listen={startListening} toggleLiveVoice={toggleLiveVoice} openChatGPT={launchChatGPT} />}
        {section === 'email' && <Email state={state} notify={notify} />}
        {section === 'tasks' && <Tasks tasks={state.tasks} onChange={tasks => patch({ tasks })} notify={notify} />}
        {section === 'people' && <People people={state.people} onChange={people => patch({ people })} onCallerAccess={async () => notify(await requestCallerIdAccess() ? 'Caller identification is turned on.' : 'Caller identification permission was not granted.')} />}
        {section === 'notes' && <Notes notes={state.notes} onChange={notes => patch({ notes })} />}
        {section === 'settings' && <Settings state={state} onChange={setState} notify={notify} onRunSetup={() => setShowSetup(true)} onReset={() => { setState(defaultState); setShowSetup(true); notify('Bigfoot’s Day was reset.') }} />}
      </main>
    </div>

    <button className={`floating-mic ${liveVoice ? 'listening' : ''}`} onClick={() => void toggleLiveVoice()} aria-label="Talk to Bubba">🎙<span>{liveVoice ? 'End live talk' : 'Talk to Bubba'}</span></button>
    {toast && <div className="toast" role="status">{toast}</div>}
  </div>
}

function SetupWizard({ state, onChange, onFinish }: { state: AppState; onChange: (s: AppState | ((s: AppState) => AppState)) => void; onFinish: () => void }) {
  const [step, setStep] = useState(0)
  const [voiceTest, setVoiceTest] = useState<{ status: 'idle' | 'listening' | 'passed' | 'failed'; text: string }>({ status: 'idle', text: '' })
  const [reminderStatus, setReminderStatus] = useState<'idle' | 'granted' | 'not-granted'>('idle')
  const [callerStatus, setCallerStatus] = useState<'idle' | 'granted' | 'not-granted'>('idle')
  const [googleStatus, setGoogleStatus] = useState<'idle' | 'connected' | 'not-connected'>('idle')
  const p = state.preferences
  const rootClass = `${p.largeText ? 'large-text' : ''} ${p.highContrast ? 'high-contrast' : ''}`
  const setPref = (key: keyof typeof p, value: string | boolean) => onChange({ ...state, preferences: { ...p, [key]: value } })
  const readCopy = [
    "Welcome to Bigfoot's Day. I will walk you through setup one simple step at a time. You can go back, or do optional steps later.",
    `Let's make this personal. Your name is ${p.userName || 'not entered yet'}, and your assistant is named ${p.assistantName || 'Bubba'}.`,
    'Choose what is easiest for you to see and hear. You can use larger text, high contrast, and spoken answers.',
    `Now we will test the microphone and speaker. Tap Test my voice, say hello ${p.assistantName || 'Bubba'}, and listen for the reply.`,
    'Reminders let Bigfoot’s Day tell you when something on your list needs attention. Android will ask for permission before notifications are turned on.',
    'Caller ID lets Bigfoot’s Day announce who is calling when the phone can identify the number. Android will ask you to approve caller identification and contacts access.',
    p.apiBase.trim() ? `Connect Google with one button so ${p.assistantName || 'Bubba'} can help with Gmail and your calendar. Bigfoot’s Day will never ask you to type your Google password into the app.` : 'Bubba is ready for everyday help. If you need a more detailed answer, tap More Help and continue speaking.',
    'You will learn one skill at a time: talking to Bubba, managing your list, saving notes, using reminders and caller identification, and opening ChatGPT for more detailed help.',
    `Setup is finished. ${p.assistantName || 'Bubba'} is ready to help. You can run this setup guide again any time from Settings.`,
  ]

  async function testVoice() {
    setVoiceTest({ status: 'listening', text: '' })
    const result = await captureVoiceOnce()
    if (!result.text) {
      setVoiceTest({ status: 'failed', text: result.error || 'Nothing was heard.' })
      return
    }
    const reply = `I heard you say, ${result.text}. Your microphone and my voice are working.`
    const spoken = await speak(reply, true)
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

  return <div className={`setup-shell ${rootClass}`}>
    <header className="setup-header"><div className="setup-brand"><span>🐾</span><b>Bigfoot’s Day</b></div><span>Easy Setup</span></header>
    <main className="setup-main">
      <div className="setup-progress" aria-label={`Setup step ${step + 1} of 9`}><div className="setup-progress-copy"><b>Step {step + 1} of 9</b><span>{['Welcome', 'About you', 'See & hear', 'Voice test', 'Reminders', 'Caller ID', 'Connections', 'Learning', 'Ready'][step]}</span></div><div className="setup-progress-track"><i style={{ width: `${((step + 1) / 9) * 100}%` }} /></div></div>
      <section className="setup-card">
        {step === 0 && <div className="setup-content center"><div className="setup-paw">🐾</div><span className="eyebrow">WELCOME</span><h1>Let’s set up Bigfoot’s Day together.</h1><p className="setup-lead">I’ll walk you through it one simple step at a time. There is no rush.</p><div className="setup-reassurance">✓ You can go back at any time.<br />✓ Optional steps can be done later.<br />✓ Nothing important is sent without your approval.</div></div>}

        {step === 1 && <div className="setup-content"><span className="eyebrow">MAKE IT PERSONAL</span><h1>What should we call you?</h1><p className="setup-lead">This helps your assistant speak to you naturally.</p><label className="setup-label">Your first name<input autoFocus value={p.userName} onChange={e => setPref('userName', e.target.value)} placeholder="Your first name" /></label><label className="setup-label">Your assistant’s name<input value={p.assistantName} onChange={e => setPref('assistantName', e.target.value)} placeholder="Bubba" /></label><p className="setup-tip">Tip: “Bubba” is the standard name, but you can choose any name you like.</p></div>}

        {step === 2 && <div className="setup-content"><span className="eyebrow">COMFORT</span><h1>Make it easy to see and hear.</h1><p className="setup-lead">Tap the choices that feel best. You can change these later.</p><button className={`setup-choice ${p.largeText ? 'selected' : ''}`} onClick={() => setPref('largeText', !p.largeText)}><span>🔎</span><div><b>Larger text</b><small>{p.largeText ? 'On — keep text larger' : 'Off — use standard text size'}</small></div><em>{p.largeText ? 'ON' : 'OFF'}</em></button><button className={`setup-choice ${p.highContrast ? 'selected' : ''}`} onClick={() => setPref('highContrast', !p.highContrast)}><span>◐</span><div><b>Extra-high contrast</b><small>Makes words and controls stand out more</small></div><em>{p.highContrast ? 'ON' : 'OFF'}</em></button><button className={`setup-choice ${p.voice ? 'selected' : ''}`} onClick={() => setPref('voice', !p.voice)}><span>🔊</span><div><b>Speak answers out loud</b><small>{p.assistantName || 'Bubba'} can read answers to you</small></div><em>{p.voice ? 'ON' : 'OFF'}</em></button><button className="setup-test" onClick={() => speak(`Hi ${p.userName || 'there'}. I’m ${p.assistantName || 'Bubba'}. This is how I sound.`, true)}>🔊 Hear a voice sample</button></div>}

        {step === 3 && <div className="setup-content"><span className="eyebrow">VOICE CHECK</span><h1>Let’s make sure voice really works.</h1><p className="setup-lead">Tap the button, allow the microphone when Samsung asks, then say <strong>“Hello Bubba.”</strong> Bubba will repeat what was heard.</p><button className="setup-action voice-check" disabled={voiceTest.status === 'listening'} onClick={() => void testVoice()}>🎙 {voiceTest.status === 'listening' ? 'Listening…' : voiceTest.status === 'passed' ? 'Test voice again' : 'Test my voice'}</button>{voiceTest.status === 'passed' && <div className="setup-success">✓ Voice passed. Bubba heard: “{voiceTest.text}” and played a spoken reply.</div>}{voiceTest.status === 'failed' && <div className="setup-later"><b>Voice is not ready yet.</b><br />{voiceTest.text}<br /><br />Check that media volume is turned up, then tap <strong>Test my voice</strong> again.</div>}</div>}

        {step === 4 && <div className="setup-content"><span className="eyebrow">REMINDERS</span><h1>Would you like helpful reminders?</h1><p className="setup-lead">Bigfoot’s Day can remind you about appointments, calls, medicine, errands, and anything else you put on your list.</p><div className="setup-permission"><span>🔔</span><div><b>Android will ask for permission.</b><p>When the phone asks, tap <strong>Allow</strong> if you want Bigfoot’s Day to show reminders.</p></div></div><button className="setup-action" onClick={() => void enableReminders()}>Turn on reminders</button>{reminderStatus === 'granted' && <div className="setup-success">✓ Reminders are turned on.</div>}{reminderStatus === 'not-granted' && <div className="setup-later">That’s okay. Reminders are not on. You can change this later.</div>}</div>}

        {step === 5 && <div className="setup-content"><span className="eyebrow">CALLER ID</span><h1>Let Bigfoot’s Day tell you who is calling.</h1><p className="setup-lead">When a call comes in, Bigfoot’s Day can announce the person’s name when it recognizes the number.</p><div className="setup-permission"><span>☎</span><div><b>You may see two Android questions.</b><p>Choose Bigfoot’s Day for caller identification, then allow contacts so names can be recognized.</p></div></div><button className="setup-action" onClick={() => void enableCallerId()}>Turn on caller ID</button>{callerStatus === 'granted' && <div className="setup-success">✓ Caller identification is turned on.</div>}{callerStatus === 'not-granted' && <div className="setup-later">Caller ID is not on yet. No problem — you can do this later.</div>}</div>}

        {step === 6 && (p.apiBase.trim() ? <div className="setup-content"><span className="eyebrow">GOOGLE</span><h1>Would you like Bubba to help with email and your calendar?</h1><p className="setup-lead">One Google connection lets {p.assistantName || 'Bubba'} show important email, suggest replies, and help plan your day around appointments.</p><div className="setup-permission"><span>G</span><div><b>You’ll choose your Google account.</b><p>Google handles the sign-in. Bigfoot’s Day will never ask you to type your Google password here.</p></div></div><button className="setup-action google-button" onClick={() => void connectGoogle()}>Connect Google</button>{googleStatus === 'connected' && <div className="setup-success">✓ Google opened. Finish the Google steps, then return to Bigfoot’s Day.</div>}{googleStatus === 'not-connected' && <div className="setup-later"><b>Google isn’t available yet.</b><br />You can keep setting up Bigfoot’s Day and connect Google later.</div>}<p className="setup-tip">You can skip this and still use your list, reminders, people, notes, and caller ID.</p></div> : <div className="setup-content"><span className="eyebrow">MORE HELP</span><h1>Bubba can help with everyday needs and bigger questions.</h1><p className="setup-lead">Use Bubba for your list, reminders, people and notes. When you need a more detailed answer, tap <strong>More Help</strong> and keep talking.</p><div className="setup-permission"><span>✦</span><div><b>We’ve kept this simple.</b><p>You will not need to enter technical settings or connection codes.</p></div></div><div className="setup-success">✓ Your assistant is ready.</div></div>)}

        {step === 7 && <div className="setup-content"><span className="eyebrow">LEARN A LITTLE AT A TIME</span><h1>Bubba will teach you inside the app.</h1><p className="setup-lead">You will see one short lesson at a time. Finish it when you are ready, then the next ability appears.</p><div className="capability-roadmap"><div><b>1. Talk & listen</b><small>Ask a question and hear Bubba answer.</small></div><div><b>2. Manage your list</b><small>Add tasks and hear what to do next.</small></div><div><b>3. Notes, reminders & people</b><small>Save information and get helpful alerts.</small></div><div><b>4. More Help</b><small>Open ChatGPT for detailed questions.</small></div></div></div>}

        {step === 8 && <div className="setup-content center"><div className="setup-paw ready">✓</div><span className="eyebrow">READY TO BEGIN</span><h1>Your first lesson is waiting.</h1><p className="setup-lead">Start simple. Bigfoot’s Day will show only one new lesson at a time.</p><div className="setup-summary"><div><span>👤</span><b>{p.userName || 'Your name'}</b><small>Your profile</small></div><div><span>🎙</span><b>{voiceTest.status === 'passed' ? 'Voice tested' : 'Voice needs testing'}</b><small>Microphone and speaker</small></div><div><span>🔔</span><b>{reminderStatus === 'granted' ? 'Reminders on' : 'Can do later'}</b><small>Notifications</small></div><div><span>⌂</span><b>Home screen icon</b><small>Samsung will be asked to add it next</small></div></div><p className="setup-tip">You can run this setup and the voice test again from Settings.</p></div>}

        <button className="setup-read" onClick={() => speak(readCopy[step], true)}>🔊 Read this screen to me</button>
      </section>
      <div className="setup-nav">{step > 0 ? <button className="setup-back" onClick={() => setStep(s => Math.max(0, s - 1))}>← Back</button> : <span />}{step < 8 ? <button className="setup-next" onClick={() => setStep(s => Math.min(8, s + 1))}>{step === 3 && voiceTest.status !== 'passed' ? 'Test later →' : step >= 4 && ((step === 4 && reminderStatus !== 'granted') || (step === 5 && callerStatus !== 'granted') || (step === 6 && p.apiBase.trim() && googleStatus !== 'connected')) ? 'Do this later →' : 'Continue →'}</button> : <button className="setup-next finish" onClick={onFinish}>Begin my first lesson</button>}</div>
      <p className="setup-footer">Take your time. Nothing here has to be perfect.</p>
    </main>
  </div>
}

function Home({ state, todayTasks, lastCaller, go, ask, talk, openChatGPT, advanceLearning, toggleTask }: { state: AppState; todayTasks: Task[]; lastCaller: string; go: (s: Section) => void; ask: (s: string) => void; talk: () => Promise<void>; openChatGPT: () => Promise<void>; advanceLearning: () => void; toggleTask: (id: string) => void }) {
  const name = state.preferences.userName || 'there'
  const lesson = [
    { title: 'Lesson 1: Talk to Bubba', copy: 'Tap below, say “What can you do?”, then listen to Bubba’s answer.', action: '🎙 Practice talking', run: async () => { await talk(); advanceLearning() } },
    { title: 'Lesson 2: Use your list', copy: 'See how Bubba adds something to your list for you.', action: '✓ Practice adding a task', run: async () => { await ask('Add drink a glass of water to my list'); advanceLearning() } },
    { title: 'Lesson 3: Save a note', copy: 'Bubba can remember a short note so you do not have to.', action: '▤ Practice saving a note', run: async () => { await ask('Save a note that I am learning to use Bigfoot’s Day'); advanceLearning() } },
    { title: 'Lesson 4: Get detailed help', copy: 'For detailed questions, Bigfoot’s Day opens the ChatGPT app you already use.', action: '✦ Open More Help', run: async () => { await openChatGPT(); advanceLearning() } },
  ][Math.min(3, state.preferences.learningStep)]
  return <div className="page home-page">
    <section className="welcome jarvis-welcome"><div className="welcome-copy"><span className="eyebrow">BUBBA // PERSONAL ASSISTANT</span><h1>{timeGreeting()}, {name}.</h1><p>{todayTasks.length ? `You have ${todayTasks.length} thing${todayTasks.length === 1 ? '' : 's'} to take care of. I’ll help you handle them one at a time.` : 'Your list is clear. I’m ready whenever you are.'}</p><div className="system-ready"><i /> BUBBA IS READY</div></div><button className="scout-core" onClick={() => void talk()} aria-label="Start a conversation with Bubba"><span className="orbit orbit-one" /><span className="orbit orbit-two" /><span className="core-center"><em>✦</em><b>BUBBA</b><small>TAP TO TALK</small></span></button></section>
    {state.preferences.learningStep < 4 ? <section className="panel learning-card"><div className="learning-number">{state.preferences.learningStep + 1}</div><div><span className="eyebrow">LEARN ONE THING AT A TIME</span><h2>{lesson.title}</h2><p>{lesson.copy}</p><small>Lesson {state.preferences.learningStep + 1} of 4</small></div><button onClick={() => void lesson.run()}>{lesson.action}</button></section> : <section className="panel learning-complete"><span>✓</span><div><b>You completed the starter lessons.</b><small>Use “Run Easy Setup Again” in Settings whenever you want a refresher.</small></div></section>}
    <div className="quick-grid">
      <button className="quick primary" onClick={() => ask('Manage my day. Review my open list and notes. Tell me what needs attention first and keep it short.')}><span>☀</span><b>Manage my day</b><small>Your list and notes — one simple plan.</small></button>
      <button className="quick" onClick={() => go('tasks')}><span>✓</span><b>What do I need to do?</b><small>{todayTasks.length} open for today</small></button>
      <button className="quick chatgpt-quick" onClick={() => void openChatGPT()}><span>✦</span><b>More Help</b><small>Get help with a detailed question.</small></button>
      <button className="quick" onClick={() => go('people')}><span>☎</span><b>Call someone</b><small>{lastCaller || `${state.people.filter(p => !p.deleted).length} people saved`}</small></button>
    </div>
    <section className="panel today-panel"><div className="panel-head"><div><span className="eyebrow">TODAY</span><h2>Your short list</h2></div><button className="text-button" onClick={() => go('tasks')}>See all →</button></div>
      {todayTasks.length === 0 ? <div className="empty">✓ Nothing urgent. You’re caught up.</div> : todayTasks.slice(0, 4).map(t => <label className="task-row" key={t.id}><input type="checkbox" checked={t.done} onChange={() => toggleTask(t.id)} /><span><b>{t.text}</b><small>{t.due ? 'Due today or earlier' : 'No date'}</small></span>{t.important && <em>Important</em>}</label>)}
    </section>
    <p className="reassurance">🔒 Bigfoot’s Day keeps personal actions under your control. It will ask before sending or changing anything important.</p>
  </div>
}

function Assistant({ state, thinking, listening, liveVoice, ask, listen, toggleLiveVoice, openChatGPT }: { state: AppState; thinking: boolean; listening: boolean; liveVoice: boolean; ask: (s: string) => void; listen: () => void; toggleLiveVoice: () => Promise<void>; openChatGPT: () => Promise<void> }) {
  const [input, setInput] = useState('')
  const bottom = useRef<HTMLDivElement>(null)
  useEffect(() => bottom.current?.scrollIntoView({ behavior: 'smooth' }), [state.chat, thinking])
  function submit(e: FormEvent) { e.preventDefault(); if (input.trim()) { ask(input); setInput('') } }
  const localMode = !state.preferences.apiBase.trim()
  return <div className="page assistant-page"><div className="page-title split"><div className="assistant-heading"><span className="assistant-orb">✦</span><div><span className="eyebrow">YOUR PERSONAL ASSISTANT</span><h1>{state.preferences.assistantName || 'Bubba'}</h1><p>Ask naturally about your list, notes, people and day.</p></div></div><button className={`live-talk ${liveVoice ? 'active' : ''}`} onClick={() => void toggleLiveVoice()}>🎙 {liveVoice ? 'End live conversation' : localMode ? 'Talk to Bubba' : 'Start live conversation'}</button></div>
    {localMode && <section className="panel chatgpt-bridge"><div><span className="eyebrow">MORE HELP</span><h2>Need a more detailed answer?</h2><p>Tap the button and continue speaking.</p></div><button onClick={() => void openChatGPT()}>✦ Continue</button></section>}
    <div className="chat panel">{state.chat.slice(-20).map((m, i) => <div key={i} className={`bubble ${m.role}`}><small>{m.role === 'assistant' ? state.preferences.assistantName : 'You'}</small>{m.text}</div>)}{thinking && <div className="bubble assistant thinking">Bubba is thinking <i>•••</i></div>}<div ref={bottom} /></div>
    <div className="suggestions"><button onClick={() => ask('Manage my day using my open list and notes. Tell me what to do first.')}>Manage my day</button><button onClick={() => ask('Add call the doctor to my list')}>Add to my list</button><button onClick={() => ask('What can you help me with?')}>What can Bubba do?</button><button onClick={() => ask('What is still on my list?')}>What’s still on my list?</button></div>
    <form className="ask-box" onSubmit={submit}><button type="button" className={listening ? 'listening' : ''} onClick={listen}>🎙</button><input value={input} onChange={e => setInput(e.target.value)} placeholder="Ask Bubba anything…" aria-label="Ask Bubba" /><button className="send">Send</button></form>
  </div>
}

function Email({ state, notify }: { state: AppState; notify: (s: string) => void }) {
  const [messages, setMessages] = useState<EmailMessage[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [sending, setSending] = useState('')
  const [sent, setSent] = useState<Record<string, boolean>>({})
  const base = getCompanionBase(state.preferences.apiBase)
  const headers = { 'Content-Type': 'application/json', 'X-Bigfoot-Token': state.preferences.companionToken }

  async function suggest(message: EmailMessage) {
    setDrafts(d => ({ ...d, [message.id]: 'Bubba is writing a suggestion…' }))
    try {
      const r = await fetch(`${base}/api/mail/suggest-reply`, { method: 'POST', headers, body: JSON.stringify({ email: message, userName: state.preferences.userName }) })
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
    if (!draft || draft.startsWith('Bubba is ') || draft.startsWith('Could not ') || draft === 'No reply appears necessary.') return
    if (!window.confirm(`Send this reply to ${message.from}?\n\nNothing will be sent unless you choose OK.`)) return
    setSending(message.id)
    try {
      const r = await fetch(`${base}/api/mail/send-reply`, { method: 'POST', headers, body: JSON.stringify({ messageId: message.id, text: draft }) })
      if (!r.ok) throw new Error()
      setSent(s => ({ ...s, [message.id]: true })); notify('Your reply was sent.')
    } catch { notify('The reply was not sent. Please try again.') }
    finally { setSending('') }
  }

  return <div className="page email-page"><div className="page-title split"><div><span className="eyebrow">SIMPLE INBOX</span><h1>Important Email</h1><p>Bubba reads the newest useful messages and suggests a reply for you.</p></div><button className="email-refresh" onClick={() => void load()}>↻ Refresh email</button></div>
    <div className="email-safety">🔒 <b>You stay in control.</b> Bubba can write a suggested reply, but it will never send one until you approve it.</div>
    {loading && <section className="panel email-state">Checking your newest email…</section>}
    {error && <section className="panel email-state email-error"><b>Gmail needs attention.</b><span>{error}</span></section>}
    {!loading && !error && messages.length === 0 && <section className="panel email-state">No recent inbox messages need your attention.</section>}
    <div className="email-list">{messages.map(message => {
      const draft = drafts[message.id] || 'Bubba is writing a suggestion…'
      const editable = !draft.startsWith('Bubba is ') && !draft.startsWith('Could not ') && draft !== 'No reply appears necessary.'
      return <article className={`panel email-card ${message.unread ? 'unread' : ''}`} key={message.id}>
        <div className="email-meta"><div><span className="eyebrow">{message.unread ? 'NEW MESSAGE' : 'RECENT MESSAGE'}</span><h2>{message.subject}</h2><b>{message.from}</b></div><small>{formatEmailDate(message.date)}</small></div>
        <p className="email-preview">{message.snippet || 'Open this message in Gmail to read the full content.'}</p>
        <button className="read-email" onClick={() => speak(`Email from ${message.from}. Subject: ${message.subject}. ${message.snippet}`, true)}>🔊 Read this email to me</button>
        <div className="reply-box"><div className="reply-title"><span>✦</span><div><b>Bubba’s suggested reply</b><small>You can change any words before sending.</small></div></div>
          {editable ? <textarea value={draft} onChange={e => setDrafts(d => ({ ...d, [message.id]: e.target.value }))} aria-label={`Suggested reply to ${message.from}`} /> : <p className="draft-status">{draft}</p>}
          <div className="reply-actions"><button onClick={() => speak(draft, true)} disabled={!editable}>🔊 Read reply</button>{draft.startsWith('Could not ') && <button onClick={() => void suggest(message)}>Try suggestion again</button>}<button className="send-reply" onClick={() => void sendReply(message)} disabled={!editable || sending === message.id || sent[message.id]}>{sent[message.id] ? '✓ Sent' : sending === message.id ? 'Sending…' : 'Approve & send reply'}</button></div>
        </div>
      </article>
    })}</div>
  </div>
}

function Tasks({ tasks, onChange, notify }: { tasks: Task[]; onChange: (t: Task[]) => void; notify: (s: string) => void }) {
  const [text, setText] = useState(''); const [due, setDue] = useState(new Date().toISOString().slice(0, 10))
  const visible = tasks.filter(t => !t.deleted)
  async function add(e: FormEvent) { e.preventDefault(); if (!text.trim()) return; const task: Task = { id: uid(), text: text.trim(), due, done: false, important: false, updatedAt: new Date().toISOString() }; onChange([task, ...tasks]); setText(''); if (due) { const when = new Date(`${due}T09:00:00`); if (when > new Date()) await scheduleReminder(Number(Date.now().toString().slice(-8)), "Bigfoot's Day", task.text, when) } notify('Added to your list.') }
  return <div className="page"><div className="page-title"><div><span className="eyebrow">KEEP IT SIMPLE</span><h1>My List</h1><p>One place for the things you don’t want to forget.</p></div></div>
    <form className="add-form panel" onSubmit={add}><label>What do you need to remember?<input value={text} onChange={e => setText(e.target.value)} placeholder="Example: Call the doctor" /></label><label>When?<input type="date" value={due} onChange={e => setDue(e.target.value)} /></label><button>Add to my list</button></form>
    <section className="panel list-panel">{visible.length === 0 ? <div className="empty">Your list is empty.</div> : visible.map(t => <div className={`task-row ${t.done ? 'done' : ''}`} key={t.id}><input type="checkbox" checked={t.done} onChange={() => onChange(tasks.map(x => x.id === t.id ? { ...x, done: !x.done, updatedAt: new Date().toISOString() } : x))} /><span><b>{t.text}</b><small>{t.due || 'Any time'}</small></span><button className="star" onClick={() => onChange(tasks.map(x => x.id === t.id ? { ...x, important: !x.important, updatedAt: new Date().toISOString() } : x))}>{t.important ? '★' : '☆'}</button><button className="delete" onClick={() => onChange(tasks.map(x => x.id === t.id ? { ...x, deleted: true, updatedAt: new Date().toISOString() } : x))}>Remove</button></div>)}</section>
  </div>
}

function People({ people, onChange, onCallerAccess }: { people: Person[]; onChange: (p: Person[]) => void; onCallerAccess: () => void }) {
  const [name, setName] = useState(''); const [phone, setPhone] = useState(''); const [relationship, setRelationship] = useState('')
  const visible = people.filter(p => !p.deleted)
  function add(e: FormEvent) { e.preventDefault(); if (!name.trim() || !phone.trim()) return; onChange([{ id: uid(), name: name.trim(), phone: phone.trim(), relationship: relationship.trim(), favorite: false, updatedAt: new Date().toISOString() }, ...people]); setName(''); setPhone(''); setRelationship('') }
  return <div className="page"><div className="page-title split"><div><span className="eyebrow">YOUR PEOPLE</span><h1>People</h1><p>Keep important people easy to reach.</p></div><button className="secondary" onClick={onCallerAccess}>Turn on caller ID</button></div>
    <form className="add-form panel" onSubmit={add}><label>Name<input value={name} onChange={e => setName(e.target.value)} placeholder="Jane Smith" /></label><label>Phone<input value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" placeholder="(555) 123-4567" /></label><label>Who are they?<input value={relationship} onChange={e => setRelationship(e.target.value)} placeholder="Daughter, doctor…" /></label><button>Save person</button></form>
    <div className="people-grid">{visible.length === 0 ? <div className="panel empty">No people saved yet. Add someone above.</div> : visible.map(p => <div className="person-card panel" key={p.id}><div className="avatar">{p.name.slice(0, 1).toUpperCase()}</div><div><h3>{p.name}</h3><p>{p.relationship || 'Contact'}</p><a href={`tel:${p.phone}`}>{p.phone}</a></div><button className="call" onClick={() => location.href = `tel:${p.phone}`}>☎ Call</button><button className="delete" onClick={() => onChange(people.map(x => x.id === p.id ? { ...x, deleted: true, updatedAt: new Date().toISOString() } : x))}>Remove</button></div>)}</div>
  </div>
}

function Notes({ notes, onChange }: { notes: AppState['notes']; onChange: (n: AppState['notes']) => void }) {
  const [text, setText] = useState('')
  const visible = notes.filter(n => !n.deleted)
  function add(e: FormEvent) { e.preventDefault(); if (!text.trim()) return; const now = new Date().toISOString(); onChange([{ id: uid(), text: text.trim(), createdAt: now, updatedAt: now }, ...notes]); setText('') }
  return <div className="page"><div className="page-title"><div><span className="eyebrow">DON’T LOSE THE THOUGHT</span><h1>Notes</h1><p>Quick notes Bubba can use when helping you.</p></div></div><form className="note-form panel" onSubmit={add}><textarea value={text} onChange={e => setText(e.target.value)} placeholder="Write a note…" /><button>Save note</button></form><div className="notes-grid">{visible.map(n => <article className="note panel" key={n.id}><p>{n.text}</p><small>{new Date(n.createdAt).toLocaleString()}</small><button className="delete" onClick={() => onChange(notes.map(x => x.id === n.id ? { ...x, deleted: true, updatedAt: new Date().toISOString() } : x))}>Remove</button></article>)}</div></div>
}

function Settings({ state, onChange, notify, onRunSetup, onReset }: { state: AppState; onChange: (s: AppState) => void; notify: (s: string) => void; onRunSetup: () => void; onReset: () => void }) {
  const p = state.preferences; const set = (key: keyof typeof p, value: string | boolean) => onChange({ ...state, preferences: { ...p, [key]: value } })
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
    <section className="panel settings-group"><h2>You & Bubba</h2><label>Your first name<input value={p.userName} onChange={e => set('userName', e.target.value)} /></label><label>Assistant name<input value={p.assistantName} onChange={e => set('assistantName', e.target.value)} /></label></section>
    <section className="panel settings-group"><h2>Easy to see & hear</h2><Toggle label="Speak answers out loud" value={p.voice} set={v => set('voice', v)} /><Toggle label="Use larger text" value={p.largeText} set={v => set('largeText', v)} /><Toggle label="Extra-high contrast" value={p.highContrast} set={v => set('highContrast', v)} /></section>
    {p.apiBase.trim() && <GoogleConnection apiBase={p.apiBase} companionToken={p.companionToken} notify={notify} />}
    <details className="panel settings-group advanced-settings"><summary>Settings for a helper</summary><p className="hint">Most people never need to open this section.</p><label>Assistant service address<input value={p.apiBase} onChange={e => set('apiBase', e.target.value)} placeholder="Service address" /></label><label>Private connection code<input type="password" value={p.companionToken} onChange={e => set('companionToken', e.target.value)} placeholder="Private code" autoComplete="off" /></label><Toggle label="Keep devices automatically in sync" value={p.autoSync} set={v => set('autoSync', v)} /><div className="sync-actions"><button onClick={() => void sync('save')}>Save to companion</button><button onClick={() => void sync('load')}>Load from companion</button></div></details>
    <section className="panel danger-zone"><h2>Start over</h2><p>This clears your tasks, contacts, notes and preferences on this device.</p><button onClick={onReset}>Reset this device</button></section>
  </div>
}

function GoogleConnection({ apiBase, companionToken, notify }: { apiBase: string; companionToken: string; notify: (s: string) => void }) {
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
  return <section className="panel settings-group google-connect"><h2>Gmail & Google Calendar</h2><p className="hint">Connect once so Bubba can brief you on email and your calendar. Bigfoot’s Day never asks for your Google password.</p><div className={`connection-row ${connected ? '' : 'offline'}`}><span className="status-dot" /> {checking ? 'Checking Google…' : connected ? `Connected${email ? ` as ${email}` : ''}` : 'Not connected'}</div><div className="sync-actions">{!connected && <button onClick={() => void connect()}>Connect Google</button>}<button onClick={() => void check()}>Check connection</button></div></section>
}

function Toggle({ label, value, set }: { label: string; value: boolean; set: (v: boolean) => void }) { return <label className="toggle-row"><span>{label}</span><button className={`switch ${value ? 'on' : ''}`} onClick={() => set(!value)} aria-pressed={value}><i /></button></label> }

function normalizePhone(v: string) { return v.replace(/\D/g, '').slice(-10) }
function getCompanionBase(value: string) { return value.trim().replace(/\/$/, '') || (location.protocol === 'file:' ? 'http://127.0.0.1:8787' : '') }
function formatEmailDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) }

type LocalAssistantResult = { reply: string; changes?: Partial<AppState> }

function localAssistant(text: string, state: AppState): LocalAssistantResult {
  const q = text.toLowerCase().trim()
  const now = new Date()
  const stamp = now.toISOString()
  const today = stamp.slice(0, 10)
  const open = state.tasks.filter(t => !t.deleted && !t.done)

  const addTask = text.match(/^(?:please\s+)?(?:add|put)\s+(.+?)(?:\s+to\s+(?:my\s+)?list)$/i)
    || text.match(/^(?:please\s+)?(?:remind me to|remember to)\s+(.+)$/i)
  if (addTask?.[1]?.trim()) {
    const taskText = addTask[1].trim().replace(/[.!?]+$/, '')
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
    return { reply: 'I can manage your day, read your list, add a task, complete a task, save a note, tell the time, and help you find your saved people. For example, say: add call the doctor to my list.' }
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
