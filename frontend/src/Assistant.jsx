import React, { useEffect, useRef, useState } from 'react';
import { MessageSquareText, SendHorizontal, Undo2, X } from 'lucide-react';
import { apiFetch } from './api.js';

const STORE = 'studyflow-assistant';
const GREETING = { from: 'bot', text: 'Tell me about your classes, tests and tasks, and I’ll update your plan. Try “test Statistics on Friday 2pm” or “what’s today”.' };
const SUGGESTIONS = ['What’s today', 'What’s next', 'This week', 'Help'];

export default function Assistant({ api, onChanged }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem(STORE)) || [GREETING]; } catch { return [GREETING]; }
  });
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef(null);
  const log = useRef(null);
  const launcher = useRef(null);

  useEffect(() => { try { sessionStorage.setItem(STORE, JSON.stringify(messages.slice(-40))); } catch { /* private mode */ } }, [messages]);
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight, behavior: 'smooth' }); }, [messages, open]);
  useEffect(() => {
    if (!open) return undefined;
    input.current?.focus();
    const onKey = (event) => { if (event.key === 'Escape') { setOpen(false); launcher.current?.focus(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  async function send(text) {
    const message = text.trim();
    if (!message || busy) return;
    setDraft('');
    setMessages((current) => [...current, { from: 'me', text: message }]);
    setBusy(true);
    try {
      const response = await apiFetch(`${api}/assistant`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: message.replace(/’/g, "'") }) });
      if (!response.ok) throw new Error('assistant failed');
      const result = await response.json();
      setMessages((current) => [...current, { from: 'bot', text: result.reply, changed: result.changed, undoable: result.undoable }]);
      if (result.changed) await onChanged();
    } catch {
      setMessages((current) => [...current, { from: 'bot', text: 'I couldn’t reach StudyFlow’s server. Check that it’s running and try again.', error: true }]);
    } finally {
      setBusy(false);
      input.current?.focus();
    }
  }

  // Only the most recent change can be undone, so only its bubble offers the button.
  const lastChange = messages.map((message) => message.changed).lastIndexOf(true);

  return <>
    <button ref={launcher} type="button" className={`assistant-launcher ${open ? 'is-open' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="assistant-panel" aria-label={open ? 'Close assistant' : 'Open assistant'}>
      {open ? <X/> : <MessageSquareText/>}<span>Assistant</span>
    </button>
    {open && <section className="assistant" id="assistant-panel" role="dialog" aria-label="StudyFlow assistant">
      <header className="assistant-head"><div><b>Assistant</b><small>Updates your plan from short messages</small></div><button type="button" className="icon-button" onClick={() => { setOpen(false); launcher.current?.focus(); }} aria-label="Close assistant"><X/></button></header>
      <ol className="assistant-log" ref={log} aria-live="polite">{messages.map((message, index) => <li key={index} className={`bubble from-${message.from} ${message.changed ? 'is-changed' : ''} ${message.error ? 'is-error' : ''}`}>{message.text}{message.changed && <span className="bubble-note"><small>Plan updated</small>{message.undoable && index === lastChange && <button type="button" className="bubble-undo" onClick={() => send('undo')} disabled={busy}><Undo2/> Undo</button>}</span>}</li>)}{busy && <li className="bubble from-bot is-typing" aria-label="Thinking"><span/><span/><span/></li>}</ol>
      <div className="assistant-chips">{SUGGESTIONS.map((chip) => <button key={chip} type="button" onClick={() => send(chip)} disabled={busy}>{chip}</button>)}</div>
      <form className="assistant-input" onSubmit={(event) => { event.preventDefault(); send(draft); }}>
        <input ref={input} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="e.g. class Statistics Mon Wed 9-11" maxLength="500" aria-label="Message the assistant"/>
        <button type="submit" className="icon-button" disabled={busy || !draft.trim()} aria-label="Send"><SendHorizontal/></button>
      </form>
    </section>}
  </>;
}
