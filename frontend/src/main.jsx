import React, { Component, Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import {
  CalendarClock, CalendarDays, CalendarRange, History, ChartNoAxesColumn, Check, ChevronDown, ListChecks, Moon, Pause,
  Link2, MapPin, Pencil, Play, Plus, RotateCcw, Search, Sun, Timer, Trash2, X,
} from 'lucide-react';
import '@fontsource-variable/archivo/wdth.css';
import './styles.css';
import Schedule from './Schedule.jsx';
import Assistant from './Assistant.jsx';
import { useReminders } from './reminders.js';
import { API, apiFetch, workspaceLink } from './api.js';

const EMPTY_INSIGHTS = {
  completion_rate: 0,
  completed_tasks: 0,
  total_tasks: 0,
  due_soon: 0,
  overdue: 0,
  estimated_minutes_left: 0,
  subjects: [],
  week: [],
  study_time_week: [],
  focus_minutes_week: 0,
  focus_sessions_week: 0,
  focus_minutes_total: 0,
};
const localDate = (value) => new Date(`${value}T12:00:00`);
const dateKey = (value) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
const isoToday = dateKey(new Date());
const fmtDate = (value) => localDate(value).toLocaleDateString('en', { month: 'short', day: 'numeric' });
const fmtDay = (value) => value ? localDate(value).toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' }) : '';
const fmtMinutes = (total) => {
  const value = Math.max(0, Math.round(total || 0));
  const h = Math.floor(value / 60);
  const m = value % 60;
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
};

function normalizeTask(form) {
  const title = form.title.trim();
  const subject = form.subject.trim();
  if (title.length < 2 || subject.length < 2) return null;
  return { ...form, title, subject, estimated_minutes: Number(form.estimated_minutes) };
}

async function saveTask(task, taskId) {
  const response = await apiFetch(`${API}/tasks${taskId ? `/${taskId}` : ''}`, {
    method: taskId ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(task),
  });
  if (!response.ok) throw new Error('Could not save task');
}

function cycleDialogFocus(event, dialogRef) {
  const controls = [...(dialogRef.current?.querySelectorAll('button:not(:disabled), input:not(:disabled)') || [])];
  if (!controls.length) return;
  const first = controls[0];
  const last = controls[controls.length - 1];
  if (!dialogRef.current?.contains(document.activeElement)) {
    event.preventDefault();
    first.focus();
    return;
  }
  const boundary = event.shiftKey ? first : last;
  if (document.activeElement === boundary) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  }
}

// The 3D layers load after first paint; the page is complete without them.
const Backdrop = lazy(() => import('./three/Backdrop.jsx'));
const FocusRing = lazy(() => import('./three/FocusRing.jsx'));

const hasWebGL = (() => {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(window.WebGLRenderingContext && (canvas.getContext('webgl2') || canvas.getContext('webgl')));
  } catch { return false; }
})();
// SVG-filter refraction behind backdrop-filter only renders in Chromium; elsewhere glass stays frosted.
const canRefract = Boolean(navigator.userAgentData?.brands?.some((entry) => /Chromium/i.test(entry.brand)));

class GLBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback ?? null : this.props.children; }
}

function useMedia(query) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const sync = () => setMatches(list.matches);
    list.addEventListener('change', sync);
    return () => list.removeEventListener('change', sync);
  }, [query]);
  return matches;
}

// Liquid glass, after liquid-glass-js: low-frequency noise displaces the live backdrop before it is
// blurred, so panels bend the moving sky behind them instead of a static page snapshot.
function LiquidGlassFilter() {
  return <svg className="sr-only" aria-hidden="true" focusable="false">
    <filter id="liquid-glass" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.006 0.009" numOctaves="2" seed="11" result="noise"/>
      <feGaussianBlur in="noise" stdDeviation="2" result="soft"/>
      <feDisplacementMap in="SourceGraphic" in2="soft" scale="34" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
  </svg>;
}

function App() {
  const [tasks, setTasks] = useState([]);
  const [insights, setInsights] = useState(EMPTY_INSIGHTS);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [apiOnline, setApiOnline] = useState(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('All');
  const [query, setQuery] = useState('');
  const [currentSection, setCurrentSection] = useState(window.location.hash || '#overview');
  const [theme, setTheme] = useState(() => localStorage.getItem('studyflow-theme') || 'light');
  const [profileName, setProfileName] = useState(() => localStorage.getItem('studyflow-name') || 'Student');
  const [profileDraft, setProfileDraft] = useState(() => localStorage.getItem('studyflow-name') || 'Student');
  const [openMenu, setOpenMenu] = useState(null);
  const [profileSaved, setProfileSaved] = useState(false);
  const profileMenuRef = useRef(null);
  const refreshInFlight = useRef(false);
  const [timer, setTimer] = useState({ running: false, seconds: 0, total: 0, complete: false });
  const timerEnd = useRef(null);
  const activeTaskRef = useRef(null);
  const sessionKeyRef = useRef(null);
  const sessionCompletionSent = useRef(false);
  const [sessionStatus, setSessionStatus] = useState('');
  const [sessionError, setSessionError] = useState(false);
  const pendingSessionRef = useRef(null);
  const [now, setNow] = useState(() => new Date());
  const [modal, setModal] = useState(false);
  const [pickedId, setPickedId] = useState(null);
  const [blockMinutes, setBlockMinutes] = useState(() => [15, 25, 45].find((value) => value === Number(localStorage.getItem('studyflow-block'))) || 25);
  const [showDone, setShowDone] = useState(false);
  const [logoPlaying, setLogoPlaying] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [agenda, setAgenda] = useState([]);
  const [events, setEvents] = useState([]);
  const reminders = useReminders({ agenda, events, tasks });
  const remindersRef = useRef(reminders);
  remindersRef.current = reminders;
  const planSignature = useRef(null);
  const [editingTask, setEditingTask] = useState(null);
  const [saving, setSaving] = useState(false);
  const [dialogError, setDialogError] = useState('');
  const [form, setForm] = useState({ title: '', subject: '', due_date: isoToday, estimated_minutes: 45 });
  const modalRef = useRef(null);
  const openerRef = useRef(null);

  async function refresh() {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    setRefreshing(true);
    try {
      const [taskRes, insightRes, agendaRes, eventRes] = await Promise.all([apiFetch(`${API}/tasks`), apiFetch(`${API}/insights`), apiFetch(`${API}/agenda?days=14`), apiFetch(`${API}/events`)]);
      if (!taskRes.ok || !insightRes.ok) throw new Error('Planner request failed');
      const nextTasks = await taskRes.json();
      const nextInsights = await insightRes.json();
      const nextAgenda = agendaRes.ok ? await agendaRes.json() : [];
      const nextEvents = eventRes.ok ? await eventRes.json() : [];
      const apply = () => { setTasks(nextTasks); setInsights(nextInsights); setAgenda(nextAgenda); setEvents(nextEvents); };
      // Rows glide to their new place when the plan changes; a poll that changes nothing just applies.
      const signature = nextTasks.map((task) => `${task.id}:${task.completed}:${task.due_date}`).join('|');
      const changed = planSignature.current !== null && planSignature.current !== signature;
      planSignature.current = signature;
      if (changed && document.visibilityState === 'visible' && document.startViewTransition && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        // The update itself always lands; only the animation can be skipped (e.g. the tab gets hidden).
        const transition = document.startViewTransition(() => flushSync(apply));
        transition.ready.catch(() => {});
        transition.finished.catch(() => {});
      } else apply();
      setApiOnline(true);
      setError('');
    } catch {
      setApiOnline(false);
      setError('StudyFlow could not reach its API. Start the backend, then retry.');
    } finally {
      refreshInFlight.current = false;
      setRefreshing(false);
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  useEffect(() => {
    const tick = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(tick);
  }, []);

  useEffect(() => {
    const syncWhenVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    const interval = window.setInterval(syncWhenVisible, 30_000);
    window.addEventListener('focus', syncWhenVisible);
    document.addEventListener('visibilitychange', syncWhenVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', syncWhenVisible);
      document.removeEventListener('visibilitychange', syncWhenVisible);
    };
  }, []);

  const themeApplied = useRef(false);
  useEffect(() => {
    const root = document.documentElement;
    // Ease only a user's switch; the first application on load should not animate.
    if (themeApplied.current) {
      root.classList.add('theme-switching');
      const timeout = setTimeout(() => root.classList.remove('theme-switching'), 300);
      root.dataset.theme = theme;
      localStorage.setItem('studyflow-theme', theme);
      return () => clearTimeout(timeout);
    }
    themeApplied.current = true;
    root.dataset.theme = theme;
    localStorage.setItem('studyflow-theme', theme);
  }, [theme]);

  useEffect(() => {
    if (!openMenu) return undefined;
    function closeMenu(event) {
      if (event.type === 'keydown' && event.key === 'Escape') {
        setOpenMenu(null);
        return;
      }
      if (event.type === 'pointerdown' && !profileMenuRef.current?.contains(event.target) && !event.target.closest?.('.profile-trigger')) setOpenMenu(null);
    }
    document.addEventListener('pointerdown', closeMenu);
    document.addEventListener('keydown', closeMenu);
    return () => {
      document.removeEventListener('pointerdown', closeMenu);
      document.removeEventListener('keydown', closeMenu);
    };
  }, [openMenu]);

  useEffect(() => {
    if (!timer.running) return undefined;
    const tick = () => {
      const seconds = Math.max(0, Math.ceil((timerEnd.current - Date.now()) / 1000));
      setTimer((current) => ({ ...current, seconds, running: seconds > 0, complete: seconds === 0 }));
      if (seconds === 0 && !sessionCompletionSent.current) {
        sessionCompletionSent.current = true;
        remindersRef.current.noteFocusComplete(Math.max(1, Math.round(timer.total / 60)));
        setSessionStatus('Saving your completed focus session…');
        const task = activeTaskRef.current;
        const payload = {
          session_key: sessionKeyRef.current,
          task_title: task?.title || 'Independent study',
          subject: task?.subject || 'General',
          duration_minutes: Math.max(1, Math.round(timer.total / 60)),
        };
        pendingSessionRef.current = payload;
        apiFetch(`${API}/sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }).then((response) => {
          if (!response.ok) throw new Error('Could not save focus session');
          pendingSessionRef.current = null;
          setSessionError(false);
          setSessionStatus('Focus session saved to your progress.');
          return refresh();
        }).catch(() => {
          setSessionError(true);
          setSessionStatus('Session finished, but could not be saved.');
        });
      }
    };
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [timer.running]);

  useEffect(() => {
    // Keep the header nav on the section being read, not only the last link clicked.
    const sections = ['overview', 'schedule', 'tasks', 'week', 'insights'].map((id) => document.getElementById(id)).filter(Boolean);
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (visible) setCurrentSection(`#${visible.target.id}`);
    }, { rootMargin: '-80px 0px -55% 0px' });
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [loading]);

  useEffect(() => {
    const syncSection = () => setCurrentSection(window.location.hash || '#overview');
    window.addEventListener('hashchange', syncSection);
    return () => window.removeEventListener('hashchange', syncSection);
  }, []);

  useEffect(() => {
    if (!modal) {
      const opener = openerRef.current;
      if (opener) {
        openerRef.current = null;
        requestAnimationFrame(() => opener.focus());
      }
      return undefined;
    }
    function handleDialogKeys(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeModal();
        return;
      }
      if (event.key === 'Tab') cycleDialogFocus(event, modalRef);
    }
    document.addEventListener('keydown', handleDialogKeys);
    return () => document.removeEventListener('keydown', handleDialogKeys);
  }, [modal]);

  function openModal(event) {
    const task = event?.task || null;
    openerRef.current = event.currentTarget;
    setEditingTask(task);
    setForm(task ? { title: task.title, subject: task.subject, due_date: task.due_date, estimated_minutes: task.estimated_minutes } : { title: '', subject: '', due_date: isoToday, estimated_minutes: 45 });
    setDialogError('');
    setModal(true);
  }

  function closeModal() {
    setModal(false);
    setEditingTask(null);
  }

  function saveProfile(event) {
    event.preventDefault();
    const nextName = profileDraft.trim().slice(0, 40);
    if (!nextName) return;
    localStorage.setItem('studyflow-name', nextName);
    setProfileName(nextName);
    setProfileDraft(nextName);
    setProfileSaved(true);
  }

  async function resetDemo() {
    if (!window.confirm('Replace all tasks and focus sessions with a fresh sample week?')) return;
    try {
      const response = await apiFetch(`${API}/demo/reset`, { method: 'POST' });
      if (!response.ok) throw new Error('Could not reset the demo');
      setFilter('All');
      setOpenMenu(null);
      await refresh();
    } catch {
      setError('Could not load the sample week. Please try again.');
    }
  }

  function showTasks(nextFilter = 'All') {
    setFilter(nextFilter);
    setQuery('');
    setOpenMenu(null);
    if (window.location.hash !== '#tasks') window.location.hash = '#tasks';
    requestAnimationFrame(() => document.getElementById('tasks')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  const visibleTasks = useMemo(() => tasks.filter((task) => {
    const matches = `${task.title} ${task.subject}`.toLowerCase().includes(query.toLowerCase());
    const due = new Date(`${task.due_date}T12:00:00`);
    const endOfWeek = new Date(); endOfWeek.setHours(12, 0, 0, 0); endOfWeek.setDate(endOfWeek.getDate() + 6);
    const soon = new Date(); soon.setHours(12, 0, 0, 0); soon.setDate(soon.getDate() + 3);
    return matches && (filter === 'All' || (filter === 'Due today' && !task.completed && task.due_date === isoToday) || (filter === 'This week' && !task.completed && task.due_date >= isoToday && due <= endOfWeek) || (filter === 'Due soon' && !task.completed && task.due_date >= isoToday && due <= soon) || (filter.startsWith('date:') && !task.completed && task.due_date === filter.slice(5)) || (filter === 'Overdue' && !task.completed && task.due_date < isoToday) || (filter === 'Done' && task.completed) || task.subject === filter);
  }), [tasks, filter, query]);

  async function toggleTask(id) {
    try {
      const response = await apiFetch(`${API}/tasks/${id}/complete`, { method: 'PATCH' });
      if (!response.ok) throw new Error('Could not update the task');
      await refresh();
    } catch {
      setError('Could not update this task. Please try again.');
    }
  }

  async function deleteTask(id) {
    const task = tasks.find((item) => item.id === id);
    if (!task || !window.confirm(`Delete “${task.title}”? This cannot be undone.`)) return;
    try {
      const response = await apiFetch(`${API}/tasks/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Could not delete the task');
      await refresh();
    } catch {
      setError('Could not delete this task. Please try again.');
    }
  }

  async function submitTask(event) {
    event.preventDefault();
    const task = normalizeTask(form);
    if (!task) {
      setDialogError('Add a task name and subject with at least two characters.');
      return;
    }
    setSaving(true);
    try {
      await saveTask(task, editingTask?.id);
      setForm({ title: '', subject: '', due_date: isoToday, estimated_minutes: 45 });
      setEditingTask(null);
      closeModal();
      await refresh();
    } catch {
      setDialogError('Could not save the task. Check that the API is running and try again.');
    } finally {
      setSaving(false);
    }
  }
  function startTimer() {
    const seconds = timer.seconds || blockMinutes * 60;
    if (timer.seconds === 0) {
      sessionKeyRef.current = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      sessionCompletionSent.current = false;
      activeTaskRef.current = focusTask;
      setSessionError(false);
      setSessionStatus('');
    }
    timerEnd.current = Date.now() + seconds * 1000;
    setTimer({ running: true, seconds, total: timer.seconds ? timer.total : seconds, complete: false });
  }
  function pauseTimer() {
    const seconds = Math.max(0, Math.ceil((timerEnd.current - Date.now()) / 1000));
    setTimer((current) => ({ ...current, running: false, seconds, complete: false }));
  }
  function resetTimer() {
    if ((timer.running || timer.seconds > 0 || pendingSessionRef.current) && !window.confirm('Reset this focus block? An unfinished or unsaved session will not be recorded.')) return;
    sessionKeyRef.current = null;
    sessionCompletionSent.current = false;
    activeTaskRef.current = null;
    pendingSessionRef.current = null;
    setSessionError(false);
    setSessionStatus('');
    setTimer({ running: false, seconds: 0, total: 0, complete: false });
  }
  async function retrySessionSave() {
    const payload = pendingSessionRef.current;
    if (!payload) return;
    setSessionError(false);
    setSessionStatus('Retrying session save…');
    try {
      const response = await apiFetch(`${API}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error('Could not save focus session');
      pendingSessionRef.current = null;
      setSessionStatus('Focus session saved to your progress.');
      await refresh();
    } catch {
      setSessionError(true);
      setSessionStatus('Session still could not be saved.');
    }
  }
  function pickTask(task) {
    if (timerActive) return;
    setPickedId(task.id);
    document.getElementById('overview')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function chooseBlock(minutes) {
    setBlockMinutes(minutes);
    localStorage.setItem('studyflow-block', String(minutes));
  }
  // Giving a late task a new date is a decision, not a failure: one tap, no dialog.
  async function reschedule(list, offsetDays) {
    const target = new Date();
    target.setDate(target.getDate() + offsetDays);
    try {
      await Promise.all(list.map((task) => saveTask({ title: task.title, subject: task.subject, due_date: dateKey(target), estimated_minutes: task.estimated_minutes }, task.id)));
      await refresh();
    } catch {
      setError('Could not move the task. Please try again.');
    }
  }
  useEffect(() => {
    function onKey(event) {
      if (modal || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.target.closest?.('input, select, textarea, [contenteditable]')) return;
      if (event.key === 'n' || event.key === 'N') { event.preventDefault(); openModal({ currentTarget: document.activeElement }); }
      if (event.key === '/') { event.preventDefault(); document.querySelector('.search input')?.focus(); }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [modal]);
  // The class or test happening now, or the next one coming up, from the 14-day agenda.
  const nowKey = `${dateKey(now)} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const timedAgenda = agenda.filter((item) => item.start_time);
  const currentClass = timedAgenda.find((item) => `${item.date} ${item.start_time}` <= nowKey && item.end_time && `${item.date} ${item.end_time}` > nowKey);
  const nextClass = currentClass || timedAgenda.find((item) => `${item.date} ${item.start_time}` > nowKey);
  const minutesUntil = (item) => Math.round((new Date(`${item.date}T${item.start_time}:00`) - now) / 60_000);
  const tomorrowKey = dateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  // Soon reads as a countdown; later reads as a day and a time.
  const whenText = (item) => {
    const minutes = minutesUntil(item);
    if (minutes < 60) return `in ${minutes} min · ${item.start_time}`;
    if (item.date === dateKey(now)) return `today at ${item.start_time}`;
    if (item.date === tomorrowKey) return `tomorrow at ${item.start_time}`;
    return `${fmtDay(item.date)} at ${item.start_time}`;
  };
  const clockText = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const openTasks = tasks.filter((task) => !task.completed);
  const dueToday = openTasks.filter((task) => task.due_date === isoToday).length;
  const overdueCount = openTasks.filter((task) => task.due_date < isoToday).length;
  const openCount = openTasks.length;
  const nextOpenTask = [...openTasks].sort((a, b) => a.due_date.localeCompare(b.due_date) || a.id - b.id)[0];
  const pickedTask = openTasks.find((task) => task.id === pickedId);
  const focusTask = (timer.running || timer.seconds > 0 || timer.complete) && activeTaskRef.current ? activeTaskRef.current : pickedTask || nextOpenTask;
  const timerActive = timer.running || timer.seconds > 0 || timer.complete || Boolean(pendingSessionRef.current);
  const studyTimeWeek = insights.study_time_week || [];
  const focusMinutesWeek = insights.focus_minutes_week || 0;
  const focusSessionsWeek = insights.focus_sessions_week || 0;
  const blockSeconds = blockMinutes * 60;
  const displayTime = timer.complete ? 0 : timer.running || timer.seconds > 0 ? timer.seconds : blockSeconds;
  const displayTimeText = `${String(Math.floor(displayTime / 60)).padStart(2, '0')}:${String(displayTime % 60).padStart(2, '0')}`;
  const timerTotal = timer.total || blockSeconds;
  const timerProgress = timer.complete ? 100 : Math.round((timerTotal - displayTime) / timerTotal * 100);
  const selectedDate = filter.startsWith('date:') ? filter.slice(5) : '';
  const filterOptions = [
    { label: 'All', value: 'All' },
    { label: 'Today', value: 'Due today' },
    { label: 'Next 3 days', value: 'Due soon' },
    { label: 'This week', value: 'This week' },
    ...(selectedDate ? [{ label: fmtDay(selectedDate), value: filter }] : []),
    { label: 'Done', value: 'Done' },
  ];
  // A subject keeps one route colour everywhere it appears.
  // Colour comes from the name itself, so adding a subject never repaints the others.
  const subjectTone = (name = '') => [...name.toLowerCase()].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 7) % 4;
  const subjectFilterActive = insights.subjects.some((subject) => subject.subject === filter);
  const insightLine = insights.overdue > 0
    ? `${insights.overdue} overdue and ${insights.due_soon} due in the next 3 days. Start with the oldest deadline; ${fmtMinutes(insights.estimated_minutes_left)} of planned work is still open.`
    : insights.due_soon > 0
      ? `${insights.due_soon} due in the next 3 days, with ${fmtMinutes(insights.estimated_minutes_left)} of planned work still open.`
      : 'Nothing is due in the next 3 days. A good moment to get ahead.';
  const focusStatus = !focusTask ? '' : focusTask.due_date < isoToday ? 'late' : focusTask.due_date === isoToday ? 'today' : 'scheduled';
  const focusStatusText = { late: `Overdue since ${fmtDay(focusTask?.due_date)}`, today: 'Due today', scheduled: `Due ${fmtDay(focusTask?.due_date)}` }[focusStatus];
  // Overdue work lives in its own catch-up area above the board, so the board stays a forward plan.
  const overdueTasks = openTasks.filter((task) => task.due_date < isoToday).sort((a, b) => a.due_date.localeCompare(b.due_date) || a.id - b.id);
  const daysLate = (task) => Math.max(1, Math.round((localDate(isoToday) - localDate(task.due_date)) / 86_400_000));
  const finished = tasks.filter((task) => task.completed && task.studied_minutes > 0);
  const estimateRatio = finished.length ? finished.reduce((sum, task) => sum + task.studied_minutes, 0) / finished.reduce((sum, task) => sum + task.estimated_minutes, 0) : 0;
  const estimateNote = !finished.length ? '' : estimateRatio > 1.15
    ? `Finished tasks took ${estimateRatio.toFixed(1)}× their planned time. Try adding about ${Math.round((estimateRatio - 1) * 100 / 5) * 5}% to new estimates.`
    : estimateRatio < 0.85 ? `Finished tasks took ${estimateRatio.toFixed(1)}× their planned time. Your estimates have room to shrink.`
      : `Your estimates are close: finished tasks took ${estimateRatio.toFixed(1)}× their planned time.`;
  const groups = [
    { key: 'today', label: `Today · ${fmtDay(isoToday)}`, tasks: visibleTasks.filter((task) => !task.completed && task.due_date === isoToday) },
    { key: 'next', label: 'Coming up', tasks: visibleTasks.filter((task) => !task.completed && task.due_date > isoToday) },
    { key: 'done', label: 'Done', tasks: visibleTasks.filter((task) => task.completed), collapsed: !showDone && filter !== 'Done' },
  ].filter((group) => group.tasks.length);
  const weekPeak = Math.max(1, ...insights.week.map((day) => day.estimated_minutes));
  const focusPeak = Math.max(1, ...studyTimeWeek.map((day) => day.minutes));
  const sectionName = { '#schedule': 'Schedule', '#tasks': 'Board', '#week': 'Week', '#insights': 'Progress' }[currentSection] || 'Now';
  const navItems = [
    { href: '#overview', label: 'Now', icon: <Timer/> },
    { href: '#schedule', label: 'Schedule', icon: <CalendarDays/> },
    { href: '#tasks', label: 'Board', icon: <ListChecks/>, count: openCount },
    { href: '#week', label: 'Week', icon: <CalendarRange/> },
    { href: '#insights', label: 'Progress', icon: <ChartNoAxesColumn/> },
  ];
  const reducedMotion = useMedia('(prefers-reduced-motion: reduce)');
  const reducedTransparency = useMedia('(prefers-reduced-transparency: reduce)');
  const show3D = hasWebGL && !reducedTransparency;
  useEffect(() => { document.documentElement.classList.toggle('can-refract', canRefract && !reducedTransparency); }, [reducedTransparency]);
  useEffect(() => {
    document.title = timer.running || (timer.seconds > 0 && !timer.complete) ? `${displayTimeText} · ${focusTask?.title || 'Focus'} · StudyFlow` : 'StudyFlow';
  }, [displayTimeText, timer.running, timer.seconds, timer.complete, focusTask?.title]);
  useEffect(() => {
    if (reducedMotion) return undefined;
    const idle = window.setInterval(() => { if (document.visibilityState === 'visible') setLogoPlaying(true); }, 24_000);
    return () => window.clearInterval(idle);
  }, [reducedMotion]);
  const toggleProfile = () => { setProfileDraft(profileName); setProfileSaved(false); setOpenMenu(openMenu === 'profile' ? null : 'profile'); };

  return <div className="app">
    <a className="skip-link" href="#main-content">Skip to main content</a>
    <LiquidGlassFilter/>
    <div className="backdrop" aria-hidden="true">
      <div className="backdrop-fallback"/>
      {show3D && <GLBoundary><Suspense fallback={null}><Backdrop key={theme} theme={theme} still={reducedMotion} focus={timer.running}/></Suspense></GLBoundary>}
    </div>
    <header className="board-header">
      <div className="header-inner">
        <a className={`brand ${logoPlaying ? 'is-playing' : ''}`} href="#overview" aria-label="StudyFlow, go to Now" onClick={() => setLogoPlaying(true)}><svg className="brand-mark" viewBox="0 0 20 20" aria-hidden="true" onAnimationEnd={(event) => { if (event.target === event.currentTarget) setLogoPlaying(false); }}><rect x="6" y="6" width="13" height="13" rx="3.5" className="brand-mark-back"/><rect x="1" y="1" width="13" height="13" rx="3.5" className="brand-mark-front"/></svg>StudyFlow</a>
        <nav className="primary-nav" aria-label="Primary">
          {navItems.map((item) => <a key={item.href} className={`nav-link ${currentSection === item.href || (item.href === '#overview' && !navItems.some((nav) => nav.href === currentSection)) ? 'is-current' : ''}`} href={item.href} aria-current={sectionName === item.label ? 'location' : undefined}>{item.icon}<span>{item.label}</span>{item.count > 0 && <span className="nav-count">{item.count}</span>}</a>)}
        </nav>
        <div className="header-end">
          <button type="button" className={`sync-chip ${refreshing ? 'is-syncing' : apiOnline === true ? 'is-live' : apiOnline === false ? 'is-offline' : ''}`} onClick={refresh} disabled={refreshing} aria-label={apiOnline === false ? 'Offline. Try to reconnect' : 'Up to date. Sync now'} title="Sync now"><span className="sync-dot" aria-hidden="true"/><span className="sync-label" role="status" aria-live="polite">{refreshing ? 'Syncing' : apiOnline === null ? 'Connecting' : apiOnline ? 'Synced' : 'Offline'}</span></button>
          <time className="clock" dateTime={now.toISOString()} aria-label={`Current time ${clockText}`}>{clockText}<span>{now.toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' })}</span></time>
          
          <button className="theme-switch" type="button" role="switch" aria-checked={theme === 'dark'} aria-label="Dark mode" title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}><span className="theme-knob" aria-hidden="true">{theme === 'dark' ? <Moon/> : <Sun/>}</span></button>
          <div className="profile-dropdown" ref={profileMenuRef}>
            <button className="avatar profile-trigger" type="button" aria-haspopup="dialog" aria-expanded={openMenu === 'profile'} aria-label={`Profile settings for ${profileName}`} onClick={toggleProfile}>{profileName.slice(0, 1).toUpperCase()}</button>
            {openMenu === 'profile' && <form className="profile-menu" role="dialog" aria-label="Profile settings" onSubmit={saveProfile}>
              <b>Profile</b>
              <label htmlFor="profile-name">Display name<input id="profile-name" value={profileDraft} maxLength="40" required onChange={(event) => { setProfileDraft(event.target.value); setProfileSaved(false); }}/></label>
              <button className="button button-primary" type="submit">Save name</button>
              {profileSaved && <span className="profile-saved" role="status">Name saved on this device.</span>}
              <hr/>
              <button className="menu-item" type="button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun/> : <Moon/>} {theme === 'dark' ? 'Light' : 'Dark'} mode</button>
              <button className="menu-item" type="button" onClick={async () => { try { await navigator.clipboard.writeText(workspaceLink()); setLinkCopied(true); } catch { window.prompt('Open this link on your other device:', workspaceLink()); } }}><Link2/> {linkCopied ? 'Link copied' : 'Use on another device'}</button>
              {linkCopied && <span className="profile-saved" role="status">Open the link on your phone or laptop to see this same plan. Keep it private: anyone with it can see and edit your plan.</span>}
              <button className="menu-item" type="button" onClick={resetDemo}><RotateCcw/> Load a sample week</button>
            </form>}
          </div>
        </div>
      </div>
    </header>

    <main className="main" id="main-content" tabIndex="-1">
      <h1 className="sr-only">StudyFlow, {sectionName}. Signed in as {profileName}</h1>
      {error && <div className="banner banner-error" role="alert" aria-live="assertive" aria-atomic="true"><span>{error}</span><button className="button button-quiet" type="button" onClick={refresh} disabled={refreshing}>{refreshing ? 'Retrying…' : 'Retry'}</button></div>}

      {nextClass && <a className={`next-up ${currentClass ? 'is-live' : ''} kind-${nextClass.kind}`} href="#schedule">
        <span className="next-up-dot" aria-hidden="true"/>
        <span className="next-up-label">{currentClass ? 'In progress' : nextClass.kind === 'test' ? 'Next test' : 'Next class'}</span>
        <b>{nextClass.title}</b>
        <span className="next-up-when">{currentClass ? `until ${currentClass.end_time}` : whenText(nextClass)}</span>
        {nextClass.location && <span className="next-up-place"><MapPin aria-hidden="true"/>{nextClass.location}</span>}
      </a>}

      <section className={`now is-${timer.running ? "running" : focusStatus || "clear"}`} id="overview" aria-labelledby="now-heading">
        <span className="now-aura" aria-hidden="true"/>
        <div className="now-main">
          {focusTask ? <>
            <div className="now-meta"><span className={`status-chip is-${focusStatus}`}>{focusStatusText}</span><span className={`route route-${subjectTone(focusTask.subject)}`}>{focusTask.subject}</span></div>
            <h2 id="now-heading" className="now-title">{focusTask.title}</h2>
            <dl className="now-facts">
              <div><dt>Planned</dt><dd>{fmtMinutes(focusTask.estimated_minutes)}</dd></div>
              <div><dt>Studied</dt><dd>{fmtMinutes(focusTask.studied_minutes || 0)}</dd></div>
            </dl>
            <div className="now-actions">
              <button className="button button-signal" type="button" onClick={timer.running ? pauseTimer : startTimer}>{timer.running ? <><Pause/> Pause</> : <><Play/> {timer.seconds && timer.seconds < timer.total ? 'Resume' : 'Start focus'}</>}</button>
              {timerActive ? <button className="button button-quiet" type="button" onClick={resetTimer}><RotateCcw/> Reset</button> : <button className="button button-quiet" type="button" onClick={() => toggleTask(focusTask.id)}><Check/> Mark done</button>}
            </div>
          </> : <>
            <h2 id="now-heading" className="now-title">{loading ? 'Loading your plan…' : tasks.length ? 'Every task is done.' : 'Start with one task.'}</h2>
            <p className="now-empty">{tasks.length ? 'Nothing is waiting. Add the next thing you want to get ahead on.' : 'Add a deadline and StudyFlow will tell you what to work on next.'}</p>
            <div className="now-actions"><button className="button button-signal" type="button" onClick={openModal}><Plus/> Add a task</button></div>
          </>}
        </div>
        {focusTask && <div className={`now-timer ${timer.running ? 'is-running' : ''}`} role="timer" aria-label={`${displayTimeText} ${timer.complete ? 'elapsed' : 'remaining'}`}>
          <div className="ring-stage">
            {show3D
              ? <GLBoundary fallback={<span className="ring-fallback" style={{ '--p': timerProgress }} aria-hidden="true"/>}><Suspense fallback={<span className="ring-fallback" style={{ '--p': timerProgress }} aria-hidden="true"/>}><FocusRing progress={timerProgress / 100} running={timer.running} still={reducedMotion} theme={theme}/></Suspense></GLBoundary>
              : <span className="ring-fallback" style={{ '--p': timerProgress }} aria-hidden="true"/>}
            <div className="ring-center">
              <strong className="timer-digits">{displayTimeText}</strong>
              <span className="timer-state">{timer.running ? 'In focus' : timer.complete ? 'Session complete' : timer.seconds ? 'Paused' : 'Ready'}</span>
            </div>
          </div>
          {timerActive
            ? <small>Only a completed block counts as studied time.</small>
            : <div className="block-picker" role="group" aria-label="Focus block length">{[15, 25, 45].map((minutes) => <button key={minutes} type="button" className={blockMinutes === minutes ? 'is-on' : ''} aria-pressed={blockMinutes === minutes} onClick={() => chooseBlock(minutes)}>{minutes}<span> min</span></button>)}</div>}
        </div>}
      </section>

      {sessionStatus && <div className={`banner ${sessionError ? 'banner-error' : 'banner-ok'}`} role="status" aria-live="polite"><span>{sessionStatus}</span>{sessionError && <button type="button" className="button button-quiet" onClick={retrySessionSave}>Retry save</button>}</div>}

      <nav className="statusline" aria-label="Plan summary">
        <button type="button" className={`figure ${overdueCount ? 'is-late' : ''}`} onClick={() => document.getElementById(overdueCount ? 'catchup' : 'tasks')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}><b>{overdueCount}</b><span>overdue</span></button>
        <button type="button" className={`figure ${dueToday ? 'is-today' : ''}`} onClick={() => showTasks('Due today')}><b>{dueToday}</b><span>due today</span></button>
        <button type="button" className="figure" onClick={() => showTasks('Due soon')}><b>{insights.due_soon}</b><span>next 3 days</span></button>
        <button type="button" className="figure" onClick={() => showTasks('All')}><b>{fmtMinutes(insights.estimated_minutes_left)}</b><span>planned, open</span></button>
        <a className="figure is-studied" href="#insights"><b>{fmtMinutes(focusMinutesWeek)}</b><span>studied this week</span></a>
      </nav>

      {overdueTasks.length > 0 && <section className="catchup" id="catchup" aria-labelledby="catchup-heading">
        <div className="catchup-head">
          <span className="catchup-icon" aria-hidden="true"><History/></span>
          <div><h2 id="catchup-heading">Catch up</h2><p>{overdueTasks.length === 1 ? 'One task slipped past its date.' : `${overdueTasks.length} tasks slipped past their dates.`} Work on it now, or give it a new date.</p></div>
          {overdueTasks.length > 1 && <button className="button button-quiet" type="button" onClick={() => reschedule(overdueTasks, 0)}>Move all to today</button>}
        </div>
        <ul className="catchup-list">{overdueTasks.map((task) => <li key={task.id} className="catchup-item" style={{ viewTransitionName: `task-${task.id}` }}>
          <button type="button" className="check" onClick={() => toggleTask(task.id)} aria-label={`Mark ${task.title} done`}/>
          <div className="catchup-main">
            <span className="task-title">{task.title}</span>
            <span className="catchup-meta"><span className={`route route-${subjectTone(task.subject)}`}>{task.subject}</span><span>Was due {fmtDay(task.due_date)}, {daysLate(task)} {daysLate(task) === 1 ? 'day' : 'days'} ago</span><span>{fmtMinutes(task.estimated_minutes)} planned{task.studied_minutes ? <> · <b>{fmtMinutes(task.studied_minutes)} studied</b></> : ''}</span></span>
          </div>
          <div className="catchup-actions">
            <button className="button button-ink button-sm" type="button" onClick={() => pickTask(task)} disabled={timerActive}><Play/> Focus</button>
            <button className="button button-quiet button-sm" type="button" onClick={() => reschedule([task], 0)}>Today</button>
            <button className="button button-quiet button-sm" type="button" onClick={() => reschedule([task], 1)}>Tomorrow</button>
            <button type="button" className="icon-button" onClick={(event) => openModal({ currentTarget: event.currentTarget, task })} aria-label={`Edit ${task.title}`}><Pencil/></button>
          </div>
        </li>)}</ul>
      </section>}

      <Schedule api={API} agenda={agenda} events={events} tasks={tasks} subjects={insights.subjects.map((subject) => subject.subject)} todayIso={isoToday} subjectTone={subjectTone} reminders={reminders} onChanged={refresh} onError={setError}/>

      <section className="board" id="tasks" aria-labelledby="board-heading">
        <div className="section-head">
          <div><h2 id="board-heading">Board</h2><p>{openCount} open · {insights.completed_tasks} done · planned against studied time</p></div>
          <button className="button button-ink" type="button" onClick={openModal}><Plus/> Add task</button>
        </div>
        <div className="board-tools">
          <div className="segmented" role="group" aria-label="Filter tasks">{filterOptions.map((option) => <button key={option.value} type="button" className={filter === option.value ? 'is-on' : ''} aria-pressed={filter === option.value} onClick={() => setFilter(option.value)}>{option.label}</button>)}</div>
          <div className="board-tools-end">
            <select className={`select ${subjectFilterActive ? 'is-on' : ''}`} aria-label="Filter by subject" value={subjectFilterActive ? filter : ''} onChange={(event) => setFilter(event.target.value || 'All')}><option value="">All subjects</option>{insights.subjects.map((subject) => <option key={subject.subject} value={subject.subject}>{subject.subject}</option>)}</select>
            <label className="search"><Search aria-hidden="true"/><input type="search" aria-label="Search tasks" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search"/></label>
          </div>
        </div>
        <div className="table-wrap">
          <table className="departures">
            <thead><tr><th scope="col" className="col-check"><span className="sr-only">Done</span></th><th scope="col" className="col-due">Due</th><th scope="col">Task</th><th scope="col" className="col-subject">Subject</th><th scope="col" className="num">Planned</th><th scope="col" className="num col-studied">Studied</th><th scope="col" className="col-actions"><span className="sr-only">Actions</span></th></tr></thead>
            {loading ? <tbody><tr><td colSpan="7" className="table-empty" role="status">Loading your study plan…</td></tr></tbody>
              : groups.length === 0 ? <tbody><tr><td colSpan="7" className="table-empty"><b>{tasks.length ? 'No tasks match this view.' : 'No tasks yet.'}</b><span>{tasks.length ? 'Try another filter, or clear the search.' : 'Add a deadline to start your board.'}</span>{tasks.length ? <button className="button button-quiet" type="button" onClick={() => { setFilter('All'); setQuery(''); }}>Show all tasks</button> : <button className="button button-ink" type="button" onClick={openModal}><Plus/> Add your first task</button>}</td></tr></tbody>
              : groups.map((group) => <tbody key={group.key} className={`group group-${group.key}`}>
                <tr className="group-row"><th colSpan="7" scope="rowgroup">{group.key === "done" ? <button type="button" className="group-toggle" aria-expanded={!group.collapsed} onClick={() => setShowDone(!showDone)} disabled={filter === "Done"}><ChevronDown/>{group.label}<span>{group.tasks.length}</span></button> : <>{group.label}<span>{group.tasks.length}</span></>}</th></tr>
                {!group.collapsed && group.tasks.map((task) => { const studied = task.studied_minutes || 0; const share = Math.min(100, Math.round(studied / task.estimated_minutes * 100)); const status = task.completed ? 'done' : task.due_date < isoToday ? 'late' : task.due_date === isoToday ? 'today' : 'scheduled'; return <tr key={task.id} style={{ viewTransitionName: `task-${task.id}` }} className={`task is-${status} ${focusTask?.id === task.id ? 'is-next' : ''}`}>
                  <td className="col-check"><button type="button" className={`check ${task.completed ? 'is-checked' : ''}`} onClick={() => toggleTask(task.id)} aria-label={task.completed ? `Mark ${task.title} not done` : `Mark ${task.title} done`}>{task.completed && <Check/>}</button></td>
                  <td className="col-due">{task.due_date === isoToday ? 'Today' : fmtDay(task.due_date)}</td>
                  <td className="col-task"><span className="task-title">{task.title}</span><span className="task-sub"><span>{task.due_date === isoToday ? 'Today' : fmtDay(task.due_date)} · {task.subject}</span><span>{fmtMinutes(task.estimated_minutes)} planned{studied ? <> · <b>{fmtMinutes(studied)} studied</b></> : ''}</span></span></td>
                  <td className="col-subject"><span className={`route route-${subjectTone(task.subject)}`}>{task.subject}</span></td>
                  <td className="num col-planned" data-label="Planned">{fmtMinutes(task.estimated_minutes)}</td>
                  <td className="num col-studied" data-label="Studied"><span className="studied-figure">{studied ? fmtMinutes(studied) : '—'}</span>{studied > 0 && <span className="studied-track" aria-hidden="true"><span style={{ width: `${share}%` }}/></span>}</td>
                  <td className="col-actions">{!task.completed && <button type="button" className="icon-button" onClick={() => pickTask(task)} disabled={timerActive} aria-label={`Focus on ${task.title}`} title="Focus on this task"><Play/></button>}<button type="button" className="icon-button" onClick={(event) => openModal({ currentTarget: event.currentTarget, task })} aria-label={`Edit ${task.title}`}><Pencil/></button><button type="button" className="icon-button is-danger" onClick={() => deleteTask(task.id)} aria-label={`Delete ${task.title}`}><Trash2/></button></td>
                </tr>; })}
              </tbody>)}
          </table>
        </div>
        <p className="table-foot">Studied time comes only from completed focus sessions.</p>
      </section>

      <section className="week" id="week" aria-labelledby="week-heading">
        <div className="section-head"><div><h2 id="week-heading">Next 7 days</h2><p>Planned work by due date. Choose a day to see its tasks.</p></div></div>
        <ol className="week-strip">{insights.week.map((day) => <li key={day.date}><button type="button" className={`day ${day.date === isoToday ? 'is-today' : ''} ${selectedDate === day.date ? 'is-on' : ''}`} onClick={() => showTasks(`date:${day.date}`)} aria-label={`${day.day} ${day.day_number}: ${day.tasks} open ${day.tasks === 1 ? 'task' : 'tasks'}, ${fmtMinutes(day.estimated_minutes)} planned`}>
          <span className="day-name">{day.date === isoToday ? 'Today' : day.day}</span><span className="day-number">{day.day_number}</span>
          <span className="day-bar" aria-hidden="true"><span style={{ '--load': (day.estimated_minutes / weekPeak).toFixed(3) }}/></span>
          <span className="day-load">{day.tasks ? fmtMinutes(day.estimated_minutes) : 'Free'}</span><span className="day-count">{day.tasks ? `${day.tasks} ${day.tasks === 1 ? 'task' : 'tasks'}` : '—'}</span>
        </button></li>)}</ol>
        <p className="week-note">{loading ? 'Putting your plan together…' : insightLine}</p>
      </section>

      <section className="progress" id="insights" aria-labelledby="progress-heading">
        <div className="section-head"><div><h2 id="progress-heading">Progress</h2><p>Planned time comes from your estimates. Studied time comes only from completed focus sessions.</p></div></div>
        <div className="progress-grid">
          <div className="panel">
            <h3>Studied against planned, by subject</h3>
            {insights.subjects.length ? <ul className="subject-lines">{insights.subjects.map((subject) => { const planned = subject.planned_minutes || 0; const studied = subject.studied_minutes || 0; const share = planned ? Math.min(100, Math.round(studied / planned * 100)) : 0; return <li key={subject.subject}><button type="button" className="subject-line" onClick={() => showTasks(subject.subject)} aria-label={`${subject.subject}: ${fmtMinutes(studied)} studied of ${fmtMinutes(planned)} planned, ${subject.completed} of ${subject.total} tasks done. Show these tasks.`}>
              <span className={`route route-${subjectTone(subject.subject)}`}>{subject.subject}</span>
              <span className="subject-figures"><b>{fmtMinutes(studied)}</b> of {fmtMinutes(planned)}</span>
              <span className={`line-track route-${subjectTone(subject.subject)}`} aria-hidden="true"><span style={{ width: `${share}%` }}/></span>
              <span className="subject-done">{subject.completed} of {subject.total} done</span>
            </button></li>; })}</ul> : <p className="panel-empty">Subjects appear here once you add tasks.</p>}
            {estimateNote && <p className="estimate-note">{estimateNote}</p>}
          </div>
          <div className="panel">
            <h3>Focus, last 7 days</h3>
            <p className="focus-total"><b>{fmtMinutes(focusMinutesWeek)}</b> across {focusSessionsWeek} {focusSessionsWeek === 1 ? 'session' : 'sessions'}</p>
            <ol className="focus-bars">{studyTimeWeek.map((day) => <li key={day.date} className={day.date === isoToday ? 'is-today' : ''} aria-label={`${day.day}: ${day.minutes} minutes in ${day.sessions} ${day.sessions === 1 ? 'session' : 'sessions'}`}>
              <span className="bar" aria-hidden="true"><span style={{ height: `${day.minutes / focusPeak * 100}%` }}/></span>
              <b>{day.minutes ? `${day.minutes}m` : '—'}</b><small>{day.date === isoToday ? 'Today' : day.day}</small>
            </li>)}</ol>
            {!focusSessionsWeek && <p className="panel-empty">Finish a focus block and it will show up here.</p>}
          </div>
        </div>
      </section>
      <footer className="footer"><span>© {now.getFullYear()} StudyFlow · Built by Benedict Frimpong Boateng</span><span className="test-note">Test version. Your plan is private to this browser; please don’t add sensitive personal information.</span><span className="shortcuts">Press <kbd>N</kbd> for a new task, <kbd>/</kbd> to search</span></footer>
    </main>

    {modal && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && closeModal()}><form className="modal" ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="dialog-heading" onSubmit={submitTask}>
      <div className="modal-head"><h2 id="dialog-heading">{editingTask ? 'Edit task' : 'New task'}</h2><button type="button" className="icon-button" aria-label="Close" onClick={closeModal}><X/></button></div>
      <label htmlFor="task-title">Task<input id="task-title" autoFocus required minLength="2" maxLength="120" placeholder="Review lecture notes" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })}/></label>
      <label htmlFor="task-subject">Subject<input id="task-subject" list="subject-options" required minLength="2" maxLength="60" placeholder="Statistics" value={form.subject} onChange={(event) => setForm({ ...form, subject: event.target.value })}/></label>
      <datalist id="subject-options">{insights.subjects.map((subject) => <option key={subject.subject} value={subject.subject}/>)}</datalist>
      <div className="form-row">
        <label htmlFor="task-due-date">Due<input id="task-due-date" required type="date" value={form.due_date} onChange={(event) => setForm({ ...form, due_date: event.target.value })}/></label>
        <label htmlFor="task-estimated-minutes">Planned minutes<input id="task-estimated-minutes" required type="number" min="5" max="600" step="5" value={form.estimated_minutes} onChange={(event) => setForm({ ...form, estimated_minutes: event.target.value })}/></label>
      </div>
      {dialogError && <div className="banner banner-error" role="alert" aria-live="assertive" aria-atomic="true">{dialogError}</div>}
      <div className="modal-actions">{editingTask && <button type="button" className="button button-quiet button-delete" onClick={() => { const id = editingTask.id; closeModal(); deleteTask(id); }}><Trash2/> Delete</button>}<button type="button" className="button button-quiet" onClick={closeModal}>Cancel</button><button className="button button-ink" disabled={saving}>{saving ? 'Saving…' : editingTask ? 'Save changes' : 'Add task'}</button></div>
    </form></div>}
    <Assistant api={API} onChanged={refresh}/>
    {reminders.toasts.length > 0 && <div className="toasts" role="region" aria-label="Reminders">{reminders.toasts.map((toast) => <div key={toast.key} className={`toast kind-${toast.kind}`} role="status">
      <span className="toast-dot" aria-hidden="true"/>
      <div><b>{toast.title}</b><span>{toast.body}</span></div>
      <button type="button" className="icon-button" onClick={() => reminders.dismiss(toast.key)} aria-label="Dismiss reminder"><X/></button>
    </div>)}</div>}
  </div>;
}

createRoot(document.getElementById('root')).render(<App/>);

