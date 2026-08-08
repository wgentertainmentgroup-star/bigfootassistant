import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { defaultState, loadState, saveState } from './storage'
import { getLastCaller, requestCallerIdAccess, requestNotificationAccess, scheduleReminder, syncPeopleForCallerId } from './native'
import { listen, speak } from './voice'
import { startRealtimeVoice, type RealtimeController } from './realtime'
import type { AppState, EmailMessage, Person, Section, Task } from './types'

const icon: Record<Section, string> = { home: '⌂', assistant: '✦', email: '✉', tasks: '✓', people: '☎', notes: '▤', settings: '⚙' }
const label: Record<Section, string> = { home: 'Today', assistant: 'Ask Scout', email: 'Email', tasks: 'My List', people: 'People', notes: 'Notes', settings: 'Settings' }

function uid() { return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}` }
function localDate() { return new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) }
function timeGreeting() { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening' }

function App() {
  const [state, setState] = useState<AppState>(() => loadState())
  const [showSetup, setShowSetup] = useState(() => !state.preferences.setupComplete)
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
    if (!state.preferences.autoSync) return
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
      const reply = localAssistant(text, state)
      setState(s => ({ ...s, chat: [...s.chat, { role: 'assistant', text: reply }] }))
      speak(reply, state.preferences.voice)
    } finally { setThinking(false) }
  }

  function startListening() {
    setListening(true)
    const supported = listen(text => askAssistant(text), () => setListening(false))
    if (!supported) notify('Voice input is not available on this device yet.')
  }

  async function toggleLiveVoice() {
    if (realtimeRef.current) {
      realtimeRef.current.stop(); realtimeRef.current = null; setLiveVoice(false); notify('Live conversation ended.'); return
    }
    try {
      setSection('assistant')
      notify('Starting live Scout…')
      realtimeRef.current = await startRealtimeVoice({
        apiBase: state.preferences.apiBase,
        companionToken: state.preferences.companionToken,
        onStatus: () => { setLiveVoice(true); notify('Scout is listening. Just speak naturally.') },
        onAssistantText: text => setState(s => ({ ...s, chat: [...s.chat, { role: 'assistant', text }] })),
      })
      setLiveVoice(true)
    } catch { setLiveVoice(false); notify('Live Scout could not connect. Check Settings and microphone permission.') }
  }

  const rootClass = `${state.preferences.largeText ? 'large-text' : ''} ${state.preferences.highContrast ? 'high-contrast' : ''}`
  if (showSetup) return <SetupWizard state={state} onChange={setState} onFinish={() => { setState(s => ({ ...s, preferences: { ...s.preferences, setupComplete: true } })); setShowSetup(false); setSection('home') }} />
  return <div className={`app ${rootClass}`}>
    <header className="topbar">
      <button className="brand" onClick={() => setSection('home')} aria-label="Bigfoot's Day home">
        <span className="paw">🐾</span><span><b>Bigfoot’s Day</b><small>Your day. Made simple.</small></span>
      </button>
      <div className="date-chip"><span className="status-dot" /> {localDate()}</div>
    </header>

    <div className="layout">
      <nav className="sidebar" aria-label="Main navigation">
        {(Object.keys(label) as Section[]).map(key => <button key={key} className={section === key ? 'active' : ''} onClick={() => setSection(key)}>
          <span className="nav-icon">{icon[key]}</span><span>{label[key]}</span>
        </button>)}
        <div className="help-card"><b>Need help?</b><span>Say “Scout, help me.”</span><button onClick={() => void toggleLiveVoice()}>🎙 {liveVoice ? 'End live talk' : 'Talk to Scout'}</button></div>
      </nav>

      <main>
        {section === 'home' && <Home state={state} todayTasks={todayTasks} lastCaller={lastCaller} go={setSection} ask={askAssistant} toggleTask={id => patch({ tasks: state.tasks.map(t => t.id === id ? { ...t, done: !t.done, updatedAt: new Date().toISOString() } : t) })} />}
        {section === 'assistant' && <Assistant state={state} thinking={thinking} listening={listening} liveVoice={liveVoice} ask={askAssistant} listen={startListening} toggleLiveVoice={toggleLiveVoice} />}
        {section === 'email' && <Email state={state} notify={notify} />}
        {section === 'tasks' && <Tasks tasks={state.tasks} onChange={tasks => patch({ tasks })} notify={notify} />}
        {section === 'people' && <People people={state.people} onChange={people => patch({ people })} onCallerAccess={async () => notify(await requestCallerIdAccess() ? 'Caller identification is turned on.' : 'Caller identification permission was not granted.')} />}
        {section === 'notes' && <Notes notes={state.notes} onChange={notes => patch({ notes })} />}
        {section === 'settings' && <Settings state={state} onChange={setState} notify={notify} onRunSetup={() => setShowSetup(true)} onReset={() => { setState(defaultState); setShowSetup(true); notify('Bigfoot’s Day was reset.') }} />}
      </main>
    </div>

    <button className={`floating-mic ${liveVoice ? 'listening' : ''}`} onClick={() => void toggleLiveVoice()} aria-label="Talk to Scout">🎙<span>{liveVoice ? 'End live talk' : 'Talk to Scout'}</span></button>
    {toast && <div className="toast" role="status">{toast}</div>}
  </div>
}

function SetupWizard({ state, onChange, onFinish }: { state: AppState; onChange: (s: AppState | ((s: AppState) => AppState)) => void; onFinish: () => void }) {
  const [step, setStep] = useState(0)
  const [reminderStatus, setReminderStatus] = useState<'idle' | 'granted' | 'not-granted'>('idle')
  const [callerStatus, setCallerStatus] = useState<'idle' | 'granted' | 'not-granted'>('idle')
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'checking' | 'connected' | 'not-connected'>('idle')
  const [googleStatus, setGoogleStatus] = useState<'idle' | 'connected' | 'not-connected'>('idle')
  const p = state.preferences
  const rootClass = `${p.largeText ? 'large-text' : ''} ${p.highContrast ? 'high-contrast' : ''}`
  const setPref = (key: keyof typeof p, value: string | boolean) => onChange({ ...state, preferences: { ...p, [key]: value } })
  const readCopy = [
    "Welcome to Bigfoot's Day. I will walk you through setup one simple step at a time. You can go back, or do optional steps later.",
    `Let's make this personal. Your name is ${p.userName || 'not entered yet'}, and your assistant is named ${p.assistantName || 'Scout'}.`,
    'Choose what is easiest for you to see and hear. You can use larger text, high contrast, and spoken answers.',
    'Reminders let Bigfoot’s Day tell you when something on your list needs attention. Android will ask for permission before notifications are turned on.',
    'Caller ID lets Bigfoot’s Day announce who is calling when the phone can identify the number. Android will ask you to approve caller identification and contacts access.',
    'This step connects the phone to your private assistant service, Gmail, and Google Calendar. If you do not have the connection information yet, you can do this later.',
    `Setup is finished. ${p.assistantName || 'Scout'} is ready to help. You can run this setup guide again any time from Settings.`,
  ]

  async function enableReminders() {
    const granted = await requestNotificationAccess()
    setReminderStatus(granted ? 'granted' : 'not-granted')
  }

  async function enableCallerId() {
    const granted = await requestCallerIdAccess()
    setCallerStatus(granted ? 'granted' : 'not-granted')
  }

  async function testConnection() {
    const base = p.apiBase.trim().replace(/\/$/, '')
    if (!base) { setConnectionStatus('not-connected'); return }
    setConnectionStatus('checking')
    try {
      const health = await fetch(`${base}/api/health`)
      const sync = await fetch(`${base}/api/sync`, { headers: { 'X-Bigfoot-Token': p.companionToken } })
      setConnectionStatus(health.ok && sync.ok ? 'connected' : 'not-connected')
    } catch { setConnectionStatus('not-connected') }
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
      <div className="setup-progress" aria-label={`Setup step ${step + 1} of 7`}><div className="setup-progress-copy"><b>Step {step + 1} of 7</b><span>{['Welcome', 'About you', 'See & hear', 'Reminders', 'Caller ID', 'Connections', 'Ready'][step]}</span></div><div className="setup-progress-track"><i style={{ width: `${((step + 1) / 7) * 100}%` }} /></div></div>
      <section className="setup-card">
        {step === 0 && <div className="setup-content center"><div className="setup-paw">🐾</div><span className="eyebrow">WELCOME</span><h1>Let’s set up Bigfoot’s Day together.</h1><p className="setup-lead">I’ll walk you through it one simple step at a time. There is no rush.</p><div className="setup-reassurance">✓ You can go back at any time.<br />✓ Optional steps can be done later.<br />✓ Nothing important is sent without your approval.</div></div>}

        {step === 1 && <div className="setup-content"><span className="eyebrow">MAKE IT PERSONAL</span><h1>What should we call you?</h1><p className="setup-lead">This helps your assistant speak to you naturally.</p><label className="setup-label">Your first name<input autoFocus value={p.userName} onChange={e => setPref('userName', e.target.value)} placeholder="Your first name" /></label><label className="setup-label">Your assistant’s name<input value={p.assistantName} onChange={e => setPref('assistantName', e.target.value)} placeholder="Scout" /></label><p className="setup-tip">Tip: “Scout” is the standard name, but you can choose any name you like.</p></div>}

        {step === 2 && <div className="setup-content"><span className="eyebrow">COMFORT</span><h1>Make it easy to see and hear.</h1><p className="setup-lead">Tap the choices that feel best. You can change these later.</p><button className={`setup-choice ${p.largeText ? 'selected' : ''}`} onClick={() => setPref('largeText', !p.largeText)}><span>🔎</span><div><b>Larger text</b><small>{p.largeText ? 'On — keep text larger' : 'Off — use standard text size'}</small></div><em>{p.largeText ? 'ON' : 'OFF'}</em></button><button className={`setup-choice ${p.highContrast ? 'selected' : ''}`} onClick={() => setPref('highContrast', !p.highContrast)}><span>◐</span><div><b>Extra-high contrast</b><small>Makes words and controls stand out more</small></div><em>{p.highContrast ? 'ON' : 'OFF'}</em></button><button className={`setup-choice ${p.voice ? 'selected' : ''}`} onClick={() => setPref('voice', !p.voice)}><span>🔊</span><div><b>Speak answers out loud</b><small>{p.assistantName || 'Scout'} can read answers to you</small></div><em>{p.voice ? 'ON' : 'OFF'}</em></button><button className="setup-test" onClick={() => speak(`Hi ${p.userName || 'there'}. I’m ${p.assistantName || 'Scout'}. This is how I sound.`, true)}>🔊 Hear a voice sample</button></div>}

        {step === 3 && <div className="setup-content"><span className="eyebrow">REMINDERS</span><h1>Would you like helpful reminders?</h1><p className="setup-lead">Bigfoot’s Day can remind you about appointments, calls, medicine, errands, and anything else you put on your list.</p><div className="setup-permission"><span>🔔</span><div><b>Android will ask for permission.</b><p>When the phone asks, tap <strong>Allow</strong> if you want Bigfoot’s Day to show reminders.</p></div></div><button className="setup-action" onClick={() => void enableReminders()}>Turn on reminders</button>{reminderStatus === 'granted' && <div className="setup-success">✓ Reminders are turned on.</div>}{reminderStatus === 'not-granted' && <div className="setup-later">That’s okay. Reminders are not on. You can change this later.</div>}</div>}

        {step === 4 && <div className="setup-content"><span className="eyebrow">CALLER ID</span><h1>Let Bigfoot’s Day tell you who is calling.</h1><p className="setup-lead">When a call comes in, Bigfoot’s Day can announce the person’s name when it recognizes the number.</p><div className="setup-permission"><span>☎</span><div><b>You may see two Android questions.</b><p>Choose Bigfoot’s Day for caller identification, then allow contacts so names can be recognized.</p></div></div><button className="setup-action" onClick={() => void enableCallerId()}>Turn on caller ID</button>{callerStatus === 'granted' && <div className="setup-success">✓ Caller identification is turned on.</div>}{callerStatus === 'not-granted' && <div className="setup-later">Caller ID is not on yet. No problem — you can do this later.</div>}</div>}

        {step === 5 && <div className="setup-content"><span className="eyebrow">OPTIONAL CONNECTIONS</span><h1>Connect your assistant services.</h1><p className="setup-lead">This lets {p.assistantName || 'Scout'} use your private AI service, sync with your companion, and connect Gmail and Google Calendar.</p><div className="setup-permission"><span>🔒</span><div><b>If someone is helping you set this up</b><p>Ask them for the “companion address” and “private code.” If you don’t have them, tap <strong>Do this later</strong>.</p></div></div><label className="setup-label">Companion address<input value={p.apiBase} onChange={e => { setPref('apiBase', e.target.value); setConnectionStatus('idle') }} placeholder="Example: http://192.168.1.25:8787" autoCapitalize="none" /></label><label className="setup-label">Private code<input type="password" value={p.companionToken} onChange={e => { setPref('companionToken', e.target.value); setConnectionStatus('idle') }} placeholder="Private connection code" autoComplete="off" /></label><div className="setup-inline-actions"><button className="setup-action" onClick={() => void testConnection()}>{connectionStatus === 'checking' ? 'Checking…' : 'Check connection'}</button>{connectionStatus === 'connected' && <button className="setup-action secondary-action" onClick={() => void connectGoogle()}>Connect Gmail & Calendar</button>}</div>{connectionStatus === 'connected' && <div className="setup-success">✓ Your assistant service is connected.</div>}{connectionStatus === 'not-connected' && <div className="setup-later">Not connected yet. Check the address and private code, or do this later.</div>}{googleStatus === 'connected' && <div className="setup-success">✓ Google sign-in opened. Finish it, then come back here.</div>}{googleStatus === 'not-connected' && <div className="setup-later">Google is not ready yet. You can connect it later in Settings.</div>}</div>}

        {step === 6 && <div className="setup-content center"><div className="setup-paw ready">✓</div><span className="eyebrow">ALL DONE</span><h1>You’re ready to use Bigfoot’s Day.</h1><p className="setup-lead">Start simple. Tap the microphone and talk to {p.assistantName || 'Scout'} just like you would talk to a person.</p><div className="setup-summary"><div><span>👤</span><b>{p.userName || 'Your name'}</b><small>Your profile</small></div><div><span>🔊</span><b>{p.voice ? 'Voice on' : 'Voice off'}</b><small>Spoken answers</small></div><div><span>🔔</span><b>{reminderStatus === 'granted' ? 'Reminders on' : 'Can do later'}</b><small>Notifications</small></div><div><span>☎</span><b>{callerStatus === 'granted' ? 'Caller ID on' : 'Can do later'}</b><small>Incoming calls</small></div></div><p className="setup-tip">You can run this guided setup again any time from Settings.</p></div>}

        <button className="setup-read" onClick={() => speak(readCopy[step], true)}>🔊 Read this screen to me</button>
      </section>
      <div className="setup-nav">{step > 0 ? <button className="setup-back" onClick={() => setStep(s => Math.max(0, s - 1))}>← Back</button> : <span />}{step < 6 ? <button className="setup-next" onClick={() => setStep(s => Math.min(6, s + 1))}>{step >= 3 && ((step === 3 && reminderStatus !== 'granted') || (step === 4 && callerStatus !== 'granted') || (step === 5 && connectionStatus !== 'connected')) ? 'Do this later →' : 'Continue →'}</button> : <button className="setup-next finish" onClick={onFinish}>Start using Bigfoot’s Day</button>}</div>
      <p className="setup-footer">Take your time. Nothing here has to be perfect.</p>
    </main>
  </div>
}

function Home({ state, todayTasks, lastCaller, go, ask, toggleTask }: { state: AppState; todayTasks: Task[]; lastCaller: string; go: (s: Section) => void; ask: (s: string) => void; toggleTask: (id: string) => void }) {
  const name = state.preferences.userName || 'there'
  return <div className="page home-page">
    <section className="welcome"><div><span className="eyebrow">{timeGreeting()}, {name}</span><h1>Here’s your day.</h1><p>{todayTasks.length ? `You have ${todayTasks.length} thing${todayTasks.length === 1 ? '' : 's'} to take care of.` : 'Your list is clear. Nice work.'}</p></div><div className="bigfoot-mark">🐾</div></section>
    <div className="quick-grid">
      <button className="quick primary" onClick={() => ask('Manage my day. Check today’s Google Calendar, my important recent Gmail, and my open list. Tell me what needs attention first, what is next, and anything I should not forget. Keep it short and easy to follow.')}><span>☀</span><b>Manage my day</b><small>Calendar, email and your list — one simple plan.</small></button>
      <button className="quick" onClick={() => go('tasks')}><span>✓</span><b>What do I need to do?</b><small>{todayTasks.length} open for today</small></button>
      <button className="quick" onClick={() => go('email')}><span>✉</span><b>Important email</b><small>Read messages and see suggested replies.</small></button>
      <button className="quick" onClick={() => go('people')}><span>☎</span><b>Call someone</b><small>{lastCaller || `${state.people.filter(p => !p.deleted).length} people saved`}</small></button>
    </div>
    <section className="panel today-panel"><div className="panel-head"><div><span className="eyebrow">TODAY</span><h2>Your short list</h2></div><button className="text-button" onClick={() => go('tasks')}>See all →</button></div>
      {todayTasks.length === 0 ? <div className="empty">✓ Nothing urgent. You’re caught up.</div> : todayTasks.slice(0, 4).map(t => <label className="task-row" key={t.id}><input type="checkbox" checked={t.done} onChange={() => toggleTask(t.id)} /><span><b>{t.text}</b><small>{t.due ? 'Due today or earlier' : 'No date'}</small></span>{t.important && <em>Important</em>}</label>)}
    </section>
    <p className="reassurance">🔒 Bigfoot’s Day keeps personal actions under your control. It will ask before sending or changing anything important.</p>
  </div>
}

function Assistant({ state, thinking, listening, liveVoice, ask, listen, toggleLiveVoice }: { state: AppState; thinking: boolean; listening: boolean; liveVoice: boolean; ask: (s: string) => void; listen: () => void; toggleLiveVoice: () => Promise<void> }) {
  const [input, setInput] = useState('')
  const bottom = useRef<HTMLDivElement>(null)
  useEffect(() => bottom.current?.scrollIntoView({ behavior: 'smooth' }), [state.chat, thinking])
  function submit(e: FormEvent) { e.preventDefault(); if (input.trim()) { ask(input); setInput('') } }
  return <div className="page assistant-page"><div className="page-title split"><div className="assistant-heading"><span className="assistant-orb">✦</span><div><span className="eyebrow">YOUR PERSONAL ASSISTANT</span><h1>{state.preferences.assistantName || 'Scout'}</h1><p>Ask naturally. You don’t need special commands.</p></div></div><button className={`live-talk ${liveVoice ? 'active' : ''}`} onClick={() => void toggleLiveVoice()}>🎙 {liveVoice ? 'End live conversation' : 'Start live conversation'}</button></div>
    <div className="chat panel">{state.chat.slice(-20).map((m, i) => <div key={i} className={`bubble ${m.role}`}><small>{m.role === 'assistant' ? state.preferences.assistantName : 'You'}</small>{m.text}</div>)}{thinking && <div className="bubble assistant thinking">Scout is thinking <i>•••</i></div>}<div ref={bottom} /></div>
    <div className="suggestions"><button onClick={() => ask('Manage my day: check today’s calendar, important email, and my list, then tell me what to do first.')}>Manage my day</button><button onClick={() => ask('What is next on my Google Calendar today?')}>What’s next?</button><button onClick={() => ask('Summarize my most important recent Gmail messages and tell me which need a reply.')}>Important email</button><button onClick={() => ask('What is still on my list?')}>What’s still on my list?</button></div>
    <form className="ask-box" onSubmit={submit}><button type="button" className={listening ? 'listening' : ''} onClick={listen}>🎙</button><input value={input} onChange={e => setInput(e.target.value)} placeholder="Ask Scout anything…" aria-label="Ask Scout" /><button className="send">Send</button></form>
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
    setDrafts(d => ({ ...d, [message.id]: 'Scout is writing a suggestion…' }))
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
    if (!draft || draft.startsWith('Scout is ') || draft.startsWith('Could not ') || draft === 'No reply appears necessary.') return
    if (!window.confirm(`Send this reply to ${message.from}?\n\nNothing will be sent unless you choose OK.`)) return
    setSending(message.id)
    try {
      const r = await fetch(`${base}/api/mail/send-reply`, { method: 'POST', headers, body: JSON.stringify({ messageId: message.id, text: draft }) })
      if (!r.ok) throw new Error()
      setSent(s => ({ ...s, [message.id]: true })); notify('Your reply was sent.')
    } catch { notify('The reply was not sent. Please try again.') }
    finally { setSending('') }
  }

  return <div className="page email-page"><div className="page-title split"><div><span className="eyebrow">SIMPLE INBOX</span><h1>Important Email</h1><p>Scout reads the newest useful messages and suggests a reply for you.</p></div><button className="email-refresh" onClick={() => void load()}>↻ Refresh email</button></div>
    <div className="email-safety">🔒 <b>You stay in control.</b> Scout can write a suggested reply, but it will never send one until you approve it.</div>
    {loading && <section className="panel email-state">Checking your newest email…</section>}
    {error && <section className="panel email-state email-error"><b>Gmail needs attention.</b><span>{error}</span></section>}
    {!loading && !error && messages.length === 0 && <section className="panel email-state">No recent inbox messages need your attention.</section>}
    <div className="email-list">{messages.map(message => {
      const draft = drafts[message.id] || 'Scout is writing a suggestion…'
      const editable = !draft.startsWith('Scout is ') && !draft.startsWith('Could not ') && draft !== 'No reply appears necessary.'
      return <article className={`panel email-card ${message.unread ? 'unread' : ''}`} key={message.id}>
        <div className="email-meta"><div><span className="eyebrow">{message.unread ? 'NEW MESSAGE' : 'RECENT MESSAGE'}</span><h2>{message.subject}</h2><b>{message.from}</b></div><small>{formatEmailDate(message.date)}</small></div>
        <p className="email-preview">{message.snippet || 'Open this message in Gmail to read the full content.'}</p>
        <button className="read-email" onClick={() => speak(`Email from ${message.from}. Subject: ${message.subject}. ${message.snippet}`, true)}>🔊 Read this email to me</button>
        <div className="reply-box"><div className="reply-title"><span>✦</span><div><b>Scout’s suggested reply</b><small>You can change any words before sending.</small></div></div>
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
  return <div className="page"><div className="page-title"><div><span className="eyebrow">DON’T LOSE THE THOUGHT</span><h1>Notes</h1><p>Quick notes Scout can use when helping you.</p></div></div><form className="note-form panel" onSubmit={add}><textarea value={text} onChange={e => setText(e.target.value)} placeholder="Write a note…" /><button>Save note</button></form><div className="notes-grid">{visible.map(n => <article className="note panel" key={n.id}><p>{n.text}</p><small>{new Date(n.createdAt).toLocaleString()}</small><button className="delete" onClick={() => onChange(notes.map(x => x.id === n.id ? { ...x, deleted: true, updatedAt: new Date().toISOString() } : x))}>Remove</button></article>)}</div></div>
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
    <section className="panel settings-group"><h2>You & Scout</h2><label>Your first name<input value={p.userName} onChange={e => set('userName', e.target.value)} /></label><label>Assistant name<input value={p.assistantName} onChange={e => set('assistantName', e.target.value)} /></label></section>
    <section className="panel settings-group"><h2>Easy to see & hear</h2><Toggle label="Speak answers out loud" value={p.voice} set={v => set('voice', v)} /><Toggle label="Use larger text" value={p.largeText} set={v => set('largeText', v)} /><Toggle label="Extra-high contrast" value={p.highContrast} set={v => set('highContrast', v)} /></section>
    <section className="panel settings-group"><h2>Assistant connection & sync</h2><p className="hint">On Windows, leave the address blank. On Android, enter the address shown by your Bigfoot’s Day companion service.</p><label>Companion service address<input value={p.apiBase} onChange={e => set('apiBase', e.target.value)} placeholder="Example: http://192.168.1.25:8787" /></label><label>Private connection code<input type="password" value={p.companionToken} onChange={e => set('companionToken', e.target.value)} placeholder="Your private code" autoComplete="off" /></label><Toggle label="Keep PC and phone automatically in sync" value={p.autoSync} set={v => set('autoSync', v)} /><div className="connection-row"><span className="status-dot" /> OpenAI-ready companion service</div><div className="sync-actions"><button onClick={() => void sync('save')}>Sync my changes now</button><button onClick={() => void sync('load')}>Get latest now</button></div></section>
    <GoogleConnection apiBase={p.apiBase} companionToken={p.companionToken} notify={notify} />
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
  return <section className="panel settings-group google-connect"><h2>Gmail & Google Calendar</h2><p className="hint">Connect once so Scout can brief you on email and your calendar. Bigfoot’s Day never asks for your Google password.</p><div className={`connection-row ${connected ? '' : 'offline'}`}><span className="status-dot" /> {checking ? 'Checking Google…' : connected ? `Connected${email ? ` as ${email}` : ''}` : 'Not connected'}</div><div className="sync-actions">{!connected && <button onClick={() => void connect()}>Connect Google</button>}<button onClick={() => void check()}>Check connection</button></div></section>
}

function Toggle({ label, value, set }: { label: string; value: boolean; set: (v: boolean) => void }) { return <label className="toggle-row"><span>{label}</span><button className={`switch ${value ? 'on' : ''}`} onClick={() => set(!value)} aria-pressed={value}><i /></button></label> }

function normalizePhone(v: string) { return v.replace(/\D/g, '').slice(-10) }
function getCompanionBase(value: string) { return value.trim().replace(/\/$/, '') || (location.protocol === 'file:' ? 'http://127.0.0.1:8787' : '') }
function formatEmailDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) }

function localAssistant(text: string, state: AppState) {
  const q = text.toLowerCase()
  const open = state.tasks.filter(t => !t.deleted && !t.done)
  if (/brief|today|focus|list|need to do/.test(q)) {
    if (!open.length) return "Your list is clear right now. You’re all caught up."
    const top = open.sort((a, b) => Number(b.important) - Number(a.important)).slice(0, 4).map((t, i) => `${i + 1}, ${t.text}`).join('. ')
    return `Here’s what I’d focus on. ${top}. Take them one at a time.`
  }
  if (/who.*call|contact|phone/.test(q)) { const count = state.people.filter(p => !p.deleted).length; return count ? `You have ${count} people saved. Open People and I’ll keep them easy to reach.` : 'You have no people saved yet. Open People and add the people you call most.' }
  return "I can still help with your list, contacts, notes, and today’s briefing while the AI connection is offline. For a full answer to that question, connect the Bigfoot’s Day companion service in Settings."
}

export default App
