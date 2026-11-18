import { useCallback, useEffect, useRef, useState } from 'react';

// Reminders run in the open tab: there is no push server, so nothing fires once StudyFlow is closed.
const SETTINGS_KEY = 'studyflow-reminders';
const FIRED_KEY = 'studyflow-reminders-fired';
const REST_KEY = 'studyflow-rest';
const OPEN_KEY = 'studyflow-reminders-open';
const DEFAULTS = { classes: true, lead: 10, tests: true, rest: true, sleep: true, bedtime: '23:00', morning: true, morningAt: '07:30' };
const LONG_REST_AFTER = 90; // minutes of focus without a long break

const pad = (value) => String(value).padStart(2, '0');
const isoOf = (day) => `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
const minutesOf = (time) => { const [h, m] = time.split(':').map(Number); return h * 60 + m; };

function read(key, fallback) {
  try { return { ...fallback, ...JSON.parse(localStorage.getItem(key) || '{}') }; } catch { return { ...fallback }; }
}

export function useReminders({ agenda, events, tasks }) {
  const [settings, setSettings] = useState(() => read(SETTINGS_KEY, DEFAULTS));
  // Open reminders survive a reload until dismissed; a reminder is never lost unseen.
  const [toasts, setToasts] = useState(() => {
    try { return (JSON.parse(localStorage.getItem(OPEN_KEY)) || []).filter((toast) => Date.now() - (toast.at || 0) < 12 * 3_600_000); } catch { return []; }
  });
  useEffect(() => { try { localStorage.setItem(OPEN_KEY, JSON.stringify(toasts)); } catch { /* storage full or blocked */ } }, [toasts]);
  const [permission, setPermission] = useState(() => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission));
  const data = useRef({ agenda, events, tasks, settings });
  data.current = { agenda, events, tasks, settings };

  const fire = useCallback((key, toast) => {
    const fired = read(FIRED_KEY, {});
    if (fired[key]) return;
    const today = isoOf(new Date());
    // Keep only today's and later keys so the store never grows.
    const kept = Object.fromEntries(Object.entries(fired).filter(([, day]) => day >= today));
    localStorage.setItem(FIRED_KEY, JSON.stringify({ ...kept, [key]: today }));
    setToasts((current) => [...current.filter((item) => item.key !== key), { key, at: Date.now(), ...toast }].slice(-3));
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
      try { new Notification(toast.title, { body: toast.body, tag: key }); } catch { /* some browsers only allow this from a service worker */ }
    }
  }, []);

  const check = useCallback(() => {
    const { agenda: items, events: all, tasks: list, settings: prefs } = data.current;
    const now = new Date();
    const today = isoOf(now);
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    if (prefs.classes) {
      for (const item of items) {
        if (item.date !== today || !item.start_time) continue;
        const start = minutesOf(item.start_time);
        if (nowMinutes >= start - prefs.lead && nowMinutes < start) {
          fire(`start:${item.id}:${item.date}`, { kind: item.kind, title: `${item.title} starts at ${item.start_time}`, body: item.location ? `In ${item.location}. ${start - nowMinutes} minutes to go.` : `${start - nowMinutes} minutes to go.` });
        }
      }
    }

    if (prefs.tests) {
      const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
      for (const test of all.filter((event) => event.kind === 'test' && event.date)) {
        const open = list.filter((task) => !task.completed && task.title.startsWith(`Study for ${test.title} (`)).length;
        const plan = open ? ` You still have ${open} study session${open === 1 ? '' : 's'} planned.` : '';
        if (test.date === isoOf(tomorrow) && now.getHours() >= 18) {
          fire(`test-eve:${test.id}`, { kind: 'test', title: `${test.title} is tomorrow${test.start_time ? ` at ${test.start_time}` : ''}`, body: `A short review tonight, then a full night's sleep.${plan}` });
        }
        if (test.date === today && now.getHours() >= 7 && (!test.start_time || nowMinutes < minutesOf(test.start_time))) {
          fire(`test-day:${test.id}`, { kind: 'test', title: `${test.title} today${test.start_time ? ` at ${test.start_time}` : ''}`, body: 'Eat something, check the room and bring what you need. Good luck.' });
        }
      }
    }

    // Morning summary: once a day, from the chosen time until noon.
    if (prefs.morning && prefs.morningAt && nowMinutes >= minutesOf(prefs.morningAt) && nowMinutes < 12 * 60) {
      const todays = items.filter((item) => item.date === today);
      const classes = todays.filter((item) => item.kind === 'class');
      const testsToday = todays.filter((item) => item.kind === 'test');
      const due = list.filter((task) => !task.completed && task.due_date <= today);
      const parts = [];
      if (classes.length) parts.push(`${classes.length} class${classes.length === 1 ? '' : 'es'}, first at ${classes[0].start_time || 'all day'} (${classes[0].title})`);
      if (testsToday.length) parts.push(`${testsToday.length === 1 ? 'a test' : `${testsToday.length} tests`}: ${testsToday.map((item) => item.title).join(', ')}`);
      if (due.length) parts.push(`${due.length} task${due.length === 1 ? '' : 's'} due or overdue`);
      fire(`morning:${today}`, { kind: 'morning', title: 'Good morning. Here’s today', body: parts.length ? `${parts.join('; ')}.` : 'Nothing scheduled and nothing due. A good day to get ahead.' });
    }

    if (prefs.sleep && prefs.bedtime) {
      const bed = minutesOf(prefs.bedtime);
      const since = (nowMinutes - bed + 1440) % 1440;
      if (since < 60) {
        const night = bed > nowMinutes ? isoOf(new Date(now.getTime() - 86_400_000)) : today;
        fire(`sleep:${night}`, { kind: 'sleep', title: `It's ${prefs.bedtime}. Time to wind down`, body: 'Sleep is when the day’s studying settles in. Put the screen away for tonight.' });
      }
    }
  }, [fire]);

  useEffect(() => {
    check();
    const timer = window.setInterval(check, 30_000);
    return () => window.clearInterval(timer);
  }, [check]);
  // Check again as soon as schedule data arrives, not 30 seconds later.
  useEffect(() => { check(); }, [agenda, events, check]);

  // Called when a focus block completes: suggest a short break, and a long one after 90 minutes.
  const noteFocusComplete = useCallback((minutes) => {
    if (!data.current.settings.rest) return;
    const today = isoOf(new Date());
    const rest = read(REST_KEY, { day: today, minutes: 0 });
    const total = (rest.day === today ? rest.minutes : 0) + minutes;
    if (total >= LONG_REST_AFTER) {
      localStorage.setItem(REST_KEY, JSON.stringify({ day: today, minutes: 0 }));
      fire(`rest-long:${Date.now()}`, { kind: 'rest', title: `${total} minutes of focus. Take a proper break`, body: 'Step away for 15 to 20 minutes: stand up, drink some water, get some daylight.' });
    } else {
      localStorage.setItem(REST_KEY, JSON.stringify({ day: today, minutes: total }));
      fire(`rest-short:${Date.now()}`, { kind: 'rest', title: 'Block done. Take a short break', body: 'Five minutes away from the screen before the next one.' });
    }
  }, [fire]);

  const update = useCallback((patch) => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const requestPermission = useCallback(async () => {
    if (typeof Notification === 'undefined') return;
    setPermission(await Notification.requestPermission());
  }, []);

  const dismiss = useCallback((key) => setToasts((current) => current.filter((item) => item.key !== key)), []);

  return { settings, update, toasts, dismiss, permission, requestPermission, noteFocusComplete };
}
