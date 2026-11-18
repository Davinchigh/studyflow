import React, { useMemo, useRef, useState } from 'react';
import { Bell, BellOff, CalendarPlus, GraduationCap, MapPin, Trash2, Upload, X } from 'lucide-react';
import { apiFetch } from './api.js';

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const KIND_LABEL = { class: 'Class', test: 'Test', event: 'Event' };
const localDate = (value) => new Date(`${value}T12:00:00`);
const daysBetween = (from, to) => Math.round((localDate(to) - localDate(from)) / 86_400_000);
const fmtDay = (value) => localDate(value).toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' });

function dayLabel(iso, todayIso) {
  const gap = daysBetween(todayIso, iso);
  if (gap === 0) return 'Today';
  if (gap === 1) return 'Tomorrow';
  return fmtDay(iso);
}

function countdown(iso, todayIso) {
  const gap = daysBetween(todayIso, iso);
  return gap === 0 ? 'today' : gap === 1 ? 'tomorrow' : `in ${gap} days`;
}

const EMPTY_FORM = (todayIso) => ({ kind: 'class', title: '', subject: '', weekday: (localDate(todayIso).getDay() + 6) % 7, date: todayIso, start_time: '09:00', end_time: '10:00', location: '' });

export default function Schedule({ api, agenda, events, tasks, subjects, todayIso, subjectTone, reminders, onChanged, onError }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(() => EMPTY_FORM(todayIso));
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [note, setNote] = useState('');
  const fileRef = useRef(null);

  const week = useMemo(() => {
    const days = [];
    for (let offset = 0; offset < 7; offset += 1) {
      const day = localDate(todayIso);
      day.setDate(day.getDate() + offset);
      const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
      days.push({ iso, items: agenda.filter((item) => item.date === iso) });
    }
    return days.filter((day) => day.items.length || day.iso === todayIso);
  }, [agenda, todayIso]);

  const tests = useMemo(() => events
    .filter((event) => event.kind === 'test' && event.date >= todayIso)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.start_time || '').localeCompare(b.start_time || ''))
    .slice(0, 3)
    .map((event) => {
      const sessions = tasks.filter((task) => task.title.startsWith(`Study for ${event.title} (`));
      return { ...event, sessions: sessions.length, sessionsDone: sessions.filter((task) => task.completed).length };
    }), [events, tasks, todayIso]);

  async function submit(event) {
    event.preventDefault();
    if (form.title.trim().length < 2) { setNote('Give it a name with at least two characters.'); return; }
    setSaving(true);
    try {
      const body = { kind: form.kind, title: form.title.trim(), subject: form.subject.trim(), location: form.location.trim(),
        start_time: form.start_time || null, end_time: form.end_time || null,
        ...(form.kind === 'class' ? { weekday: Number(form.weekday) } : { date: form.date }) };
      const response = await apiFetch(`${api}/events${editingId ? `/${editingId}` : ''}`, { method: editingId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error('save failed');
      const created = await response.json();
      const planned = created.planned_sessions?.length || 0;
      const verb = editingId ? 'Saved' : 'Added';
      setNote(planned ? `${verb}. ${planned} study session${planned === 1 ? '' : 's'} planned before the test.` : `${verb} ${body.title}.`);
      setForm(EMPTY_FORM(todayIso));
      setAdding(false);
      setEditingId(null);
      await onChanged();
    } catch {
      setNote('Could not add that. Check the details and try again.');
    } finally {
      setSaving(false);
    }
  }

  async function importFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 2_000_000) { setNote('That file is too large. Export a single calendar, under 2 MB.'); return; }
    try {
      const response = await apiFetch(`${api}/events/import`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: await file.text() }) });
      const result = await response.json();
      if (!response.ok) { setNote(result.detail || 'Could not read that calendar file.'); return; }
      const parts = [`${result.class} class${result.class === 1 ? '' : 'es'}`, `${result.test} test${result.test === 1 ? '' : 's'}`, `${result.event} event${result.event === 1 ? '' : 's'}`];
      setNote(`Imported ${parts.join(', ')}.${result.study_sessions ? ` Planned ${result.study_sessions} study sessions before tests.` : ''}${result.skipped ? ` Skipped ${result.skipped} past or already added.` : ''}`);
      await onChanged();
    } catch {
      onError('Could not import that calendar. Please try again.');
    }
  }

  async function remove(item) {
    if (!window.confirm(item.recurring ? `Remove “${item.title}” on ${WEEKDAYS[(localDate(item.date).getDay() + 6) % 7]}s from your timetable?` : `Remove “${item.title}”?`)) return;
    try {
      const response = await apiFetch(`${api}/events/${item.id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('delete failed');
      await onChanged();
    } catch {
      onError('Could not remove that. Please try again.');
    }
  }

  const set = (key) => (event) => setForm({ ...form, [key]: event.target.value });

  function startEdit(item) {
    const event = events.find((entry) => entry.id === item.id);
    if (!event) return;
    setForm({ kind: event.kind, title: event.title, subject: event.subject || '', weekday: event.weekday ?? 0, date: event.date || todayIso,
      start_time: event.start_time || '', end_time: event.end_time || '', location: event.location || '' });
    setEditingId(event.id);
    setAdding(true);
    setNote('');
    requestAnimationFrame(() => document.querySelector('.event-form input')?.focus());
  }
  function closeForm() {
    setAdding(false);
    setEditingId(null);
    setForm(EMPTY_FORM(todayIso));
    setNote('');
  }

  return <section className="schedule" id="schedule" aria-labelledby="schedule-heading">
    <div className="section-head">
      <div><h2 id="schedule-heading">Schedule</h2><p>Classes, tests and academic dates. Tests get study sessions planned before them.</p></div>
      <div className="schedule-actions">
        <input ref={fileRef} type="file" accept=".ics,text/calendar" className="sr-only" tabIndex={-1} onChange={importFile} aria-hidden="true"/>
        <button className="button button-quiet" type="button" onClick={() => fileRef.current?.click()}><Upload/> Import calendar</button>
        <button className="button button-ink" type="button" onClick={() => (adding ? closeForm() : (setAdding(true), setNote('')))} aria-expanded={adding}>{adding ? <><X/> Close</> : <><CalendarPlus/> Add</>}</button>
      </div>
    </div>
    {note && <p className="schedule-note" role="status">{note}</p>}

    {adding && <form className="panel event-form" onSubmit={submit}>
      {editingId && <p className="event-form-title">{form.kind === 'class' ? `Editing this class on ${WEEKDAYS[form.weekday]}s` : `Editing ${form.title}`}</p>}
      <div className="segmented" role="group" aria-label="What are you adding?">{['class', 'test', 'event'].map((kind) => <button key={kind} type="button" className={form.kind === kind ? 'is-on' : ''} aria-pressed={form.kind === kind} onClick={() => setForm({ ...form, kind })}>{KIND_LABEL[kind]}</button>)}</div>
      <div className="form-grid">
        <label>Name<input required minLength="2" maxLength="120" value={form.title} onChange={set('title')} placeholder={form.kind === 'class' ? 'Statistics lecture' : form.kind === 'test' ? 'Statistics test' : 'Mid-semester break'}/></label>
        {form.kind !== 'event' && <label>Subject<input list="schedule-subjects" maxLength="60" value={form.subject} onChange={set('subject')} placeholder="Statistics"/></label>}
        {form.kind === 'class'
          ? <label>Day<select className="select" value={form.weekday} onChange={set('weekday')}>{WEEKDAYS.map((day, index) => <option key={day} value={index}>{day}</option>)}</select></label>
          : <label>Date<input type="date" required value={form.date} min={todayIso} onChange={set('date')}/></label>}
        <label>Starts<input type="time" value={form.start_time} onChange={set('start_time')} required={form.kind === 'class'}/></label>
        <label>Ends<input type="time" value={form.end_time} onChange={set('end_time')}/></label>
        {form.kind !== 'event' && <label>Room<input maxLength="120" value={form.location} onChange={set('location')} placeholder="Room B2"/></label>}
      </div>
      <datalist id="schedule-subjects">{subjects.map((subject) => <option key={subject} value={subject}/>)}</datalist>
      <div className="modal-actions"><button className="button button-ink" disabled={saving}>{saving ? 'Saving…' : editingId ? 'Save changes' : form.kind === 'test' ? 'Add test and plan study' : `Add ${form.kind}`}</button></div>
    </form>}

    <div className="schedule-grid">
      <div className="panel agenda">
        <h3>Next 7 days</h3>
        {agenda.length === 0
          ? <div className="agenda-empty"><b>No classes or tests yet.</b><span>Add them one by one, import your timetable as an .ics file (Google Calendar: Settings › Import & export › Export; Outlook: Save calendar), or tell the assistant: “class Statistics Mon Wed 9-11”.</span></div>
          : <ol className="agenda-days">{week.map((day) => <li key={day.iso} className={day.iso === todayIso ? 'is-today' : ''}>
            <h4>{dayLabel(day.iso, todayIso)}{day.iso === todayIso && <span>{fmtDay(day.iso)}</span>}</h4>
            {day.items.length === 0 ? <p className="agenda-free">No classes today.</p> : <ul>{day.items.map((item) => <li key={`${item.id}-${item.date}`} className={`agenda-item kind-${item.kind}`}>
              <span className="agenda-time">{item.start_time || 'All day'}{item.end_time && <small>{item.end_time}</small>}</span>
              <span className={`agenda-bar ${item.subject ? `route-${subjectTone(item.subject)}` : ''}`} aria-hidden="true"/>
              <button type="button" className="agenda-main" onClick={() => startEdit(item)} aria-label={`Edit ${item.title}`}><b>{item.title}</b><span>{item.kind !== 'class' && <em className={`tag tag-${item.kind === 'test' ? 'today' : 'scheduled'}`}>{KIND_LABEL[item.kind]}</em>}{item.location && <><MapPin aria-hidden="true"/>{item.location}</>}</span></button>
              <button type="button" className="icon-button" onClick={() => remove(item)} aria-label={`Remove ${item.title}`}><Trash2/></button>
            </li>)}</ul>}
          </li>)}</ol>}
      </div>

      <div className="schedule-side">
        <div className="panel">
          <h3>Coming tests</h3>
          {tests.length === 0 ? <p className="panel-empty">No tests scheduled. Add one and StudyFlow plans study sessions before it.</p>
            : <ul className="test-list">{tests.map((test) => <li key={test.id}>
              <span className="test-icon" aria-hidden="true"><GraduationCap/></span>
              <div><b>{test.title}</b><span>{fmtDay(test.date)}{test.start_time ? ` · ${test.start_time}` : ''} · <strong>{countdown(test.date, todayIso)}</strong></span>
                {test.sessions > 0 && <span className="test-progress"><span className="line-track" aria-hidden="true"><span style={{ width: `${Math.round(test.sessionsDone / test.sessions * 100)}%` }}/></span>{test.sessionsDone} of {test.sessions} study sessions done</span>}</div>
            </li>)}</ul>}
        </div>
        <div className="panel reminders">
          <h3>Reminders</h3>
          <label className="toggle-row"><span>Morning summary<small>Today’s classes, tests and what’s due</small></span><span className="toggle-pair"><input type="time" aria-label="Morning summary time" value={reminders.settings.morningAt} onChange={(event) => reminders.update({ morningAt: event.target.value })} disabled={!reminders.settings.morning}/><input type="checkbox" role="switch" aria-label="Morning summary" checked={reminders.settings.morning} onChange={(event) => reminders.update({ morning: event.target.checked })}/></span></label>
          <label className="toggle-row"><span>Classes and events<small>{reminders.settings.lead} minutes before they start</small></span><input type="checkbox" role="switch" checked={reminders.settings.classes} onChange={(event) => reminders.update({ classes: event.target.checked })}/></label>
          <label className="toggle-row"><span>Tests<small>The evening before and that morning</small></span><input type="checkbox" role="switch" checked={reminders.settings.tests} onChange={(event) => reminders.update({ tests: event.target.checked })}/></label>
          <label className="toggle-row"><span>Breaks<small>After each focus block, and a longer rest after 90 minutes</small></span><input type="checkbox" role="switch" checked={reminders.settings.rest} onChange={(event) => reminders.update({ rest: event.target.checked })}/></label>
          <label className="toggle-row"><span>Bedtime<small>A nudge to stop and sleep</small></span><span className="toggle-pair"><input type="time" aria-label="Bedtime" value={reminders.settings.bedtime} onChange={(event) => reminders.update({ bedtime: event.target.value })} disabled={!reminders.settings.sleep}/><input type="checkbox" role="switch" aria-label="Bedtime reminder" checked={reminders.settings.sleep} onChange={(event) => reminders.update({ sleep: event.target.checked })}/></span></label>
          <div className="notify-row">
            {reminders.permission === 'granted' ? <span className="notify-on"><Bell aria-hidden="true"/> Desktop notifications on</span>
              : reminders.permission === 'denied' ? <span className="notify-off"><BellOff aria-hidden="true"/> Notifications are blocked in your browser settings</span>
                : reminders.permission === 'unsupported' ? <span className="notify-off"><BellOff aria-hidden="true"/> This browser can't show notifications</span>
                  : <button className="button button-quiet button-sm" type="button" onClick={reminders.requestPermission}><Bell/> Turn on desktop notifications</button>}
            <small>Reminders appear while StudyFlow is open in a tab.</small>
          </div>
        </div>
      </div>
    </div>
  </section>;
}
