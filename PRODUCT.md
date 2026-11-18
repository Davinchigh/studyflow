# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two audiences, served equally:

- **Students** planning real coursework across several subjects. They open StudyFlow to decide what to work on now, start a focus session, and check that the week is manageable.
- **Technical reviewers** (an IBM Software hiring team) evaluating the project as a portfolio piece, usually in a two-minute look. A believable daily tool is what convinces them.

## Product Purpose

StudyFlow turns upcoming deadlines into a realistic plan: what is due, how much estimated work remains, and which task to start next. Success is a student who knows what to do the moment the app opens, and who can see the difference between work planned and time actually studied.

## Positioning

StudyFlow keeps **estimated effort** and **recorded focus time** as separate measures. Planned minutes come from task estimates; studied minutes come only from completed focus sessions. Insights never treat an estimate as work done.

## Operating Context

- Used on a laptop at a desk and on a phone between classes.
- A single-user, local demo: React + Vite frontend, FastAPI + SQLite backend.
- "Load a sample week" in the profile menu reseeds realistic demo data relative to today, so reviewers always see current dates.

## Capabilities and Constraints

- Tasks: add, edit, complete, delete, filter (due today, due soon, this week, done, by subject, by day), search.
- Focus timer per task (up to 45 minutes); a session is recorded only when it completes, idempotently.
- Insights: overdue and due-soon counts, estimated work left, 7-day workload, focus time over the last 7 days, progress by subject.
- Light and dark themes; responsive desktop and mobile.
- Schedule: weekly classes, tests and academic-calendar events; `.ics` import; study sessions auto-planned before tests.
- Reminders run in the open tab only (no push server): classes/events, tests, breaks after focus (long break after 90 minutes), bedtime.
- Assistant: a rule-based command parser, deliberately not an AI model. Answering uploaded test questions is out of scope: general AI chat products already do it better, it would need a paid model, and it invites academic-integrity problems. StudyFlow stays a planner.
- Tester deployment: each browser gets a private workspace (its own SQLite file), moved between devices by a private link. No accounts; a lost link means a lost plan. Workspace cap and per-IP rate limit. See DEPLOY.md.

## Brand Commitments

- Name: StudyFlow.
- No visual carry-over is required: the user chose to replace the previous palette, typography and layout entirely.

## Evidence on Hand

- Demo data only (synthetic sample week). No real users, testimonials or metrics exist; none may be invented.

## Product Principles

1. The first screen answers "what should I do now?" and lets the student start immediately.
2. Planned effort and actual effort are never blurred together.
3. Every number shown is computed from the student's own tasks and sessions.
4. Calm under pressure: a heavy or overdue week is stated plainly, with one clear next step, never alarmist.
