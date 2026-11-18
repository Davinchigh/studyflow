# StudyFlow design, accessibility, and security review

## Scope and evidence

Reviewed the React interface and FastAPI service, compared the feature scope with public student-planner examples, captured the overview and add-task dialog in the in-app browser at a 446 × 462 viewport, and checked the live local API. The React accessibility tree was used to inspect the page and keyboard flow. This is a focused portfolio-project review, not a full WCAG certification or external penetration test.

## What works well

- The page has one clear primary action, task status is visible, and the responsive layout remains usable at the captured narrow viewport.
- Tasks connect a subject, due date, and time estimate. Completion and subject progress give the user useful feedback.
- The API validates field lengths and numeric ranges and uses parameterized SQLite queries.

## Changes made during the review

- Added a seven-day due-date view calculated from open tasks and separated overdue work from upcoming deadlines. The chart is based on saved task data, not invented activity.
- Added overdue-aware workload copy and changed the time metric to say it is an estimate for open tasks.
- Added a skip link, named navigation, labelled search and form fields, announced errors and loading state, and semantic progress bars.
- Made the task form a labelled dialog with initial focus, Escape dismissal, Tab containment, and focus return to its opener.
- Increased contrast for the small labels and status badges. Removed the remote Google Fonts import so the app does not need to contact a third party just to render text.
- Closed SQLite connections after each operation, trim and validate text before saving it, and restricted CORS to the local app origins and methods it uses.
- Bound Compose ports to localhost, run the API container as a non-root user, and made Compose wait for the API health check before starting the web service.

## Product comparison

MyStudyLife presents a wider student workflow: timetable and calendar views, homework and exam planning, reminders, and partial task progress. StudyFlow now borrows the useful planning pattern of making near-term workload visible, while keeping its current scope to tasks, subject progress, and due dates. Calendar sync, reminders, and exam planning would be sensible next additions if there is time; they are not implemented here. [MyStudyLife feature tour](https://mystudylife.com/tour/)

## Security boundary

The app has no sign-in or per-user authorization. Keep it on localhost and use sample data; do not deploy it as a public service or enter private academic records. A public version needs authentication and per-user access checks, HTTPS, request limits, and production security headers. The OWASP REST guidance calls for per-endpoint access control on non-public services and strict input validation. [OWASP REST Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html)

## Verification and limits

- The React production build completed successfully.
- The backend source parsed, and the local API returned its health response and a seven-day insight payload.
- A whitespace-only task name was rejected with HTTP 422, and a request from an unapproved origin received no CORS allow-origin header.
- The local API source scan found no matching vulnerability patterns. The scanner produced a checklist; it is not proof that every item passed.
- Ten reviewed foreground/background pairs meet WCAG AA text contrast, including the primary button at 4.66:1. The included contrast tool does not automatically evaluate every runtime combination.
- The accessibility scanner reports missing landmarks in the standalone HTML/CSS files, but the running React page exposes a skip link, main content, and navigation. The scanner does not merge the dynamically rendered component tree with those files. Manual keyboard review covered the add-task dialog; a screen reader and a wider desktop viewport were not tested.
- The local dependency checker reported no known package findings. `npm audit` could not reach npm’s advisory endpoint during the review, so the dependency list has not received a live registry vulnerability check.

## Research sources

- [MyStudyLife feature tour](https://mystudylife.com/tour/)
- [OWASP REST Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html)
- [Docker Compose startup order and health checks](https://docs.docker.com/compose/how-tos/startup-order)

## Iteration follow-up — task maintenance

- Added an edit flow for task title, subject, due date, and estimated minutes through a validated `PUT /api/tasks/{id}` endpoint.
- Added a confirmation before permanent task deletion to reduce accidental loss.
- Updated the API reference and task-view controls to expose these actions.
- Verified the frontend production build and parsed the backend module for syntax. No live endpoint interaction was performed in this iteration.

The API remains a local, unauthenticated, single-user demo; the confirmation protects against misclicks but does not add a recovery path after deletion.

## Iteration follow-up — interactive controls

- Connected the overview summary cards to the relevant task filters, the seven-day cards to date filters, and subject progress cards to subject filters.
- Made today's plan rows toggle task completion, exposed task search on mobile, and added profile settings for the locally saved display name and theme.
- Added a live API connection indicator, a manual refresh control, retry feedback when the API is unavailable, and refresh-on-focus/visibility plus a 30-second visible-tab refresh.
- The timer reset control appears only while a focus block needs action and confirms before discarding an unfinished or unsaved session.
- The frontend production build completed. Manual browser checks covered the mobile search and due-soon filter, task dialog open/cancel, summary-card navigation/filtering, profile menu, theme toggle, and live API refresh. No task data was changed during these checks. A full timer-duration session was not rerun.

## Iteration follow-up — recorded focus sessions

- Added a SQLite-backed `focus_sessions` table and `POST /api/sessions` endpoint. A unique session key makes repeat submissions idempotent.
- Completed timers save the focus block and task/subject snapshot; paused or reset blocks do not count as completed study time.
- The progress view now reports recorded focus minutes and completed sessions for each of the last seven days, separately from estimates for unfinished tasks.
- Added a retry action when saving a completed session fails, and documented the endpoint and metric distinction in the README.
- Frontend build and backend syntax were checked. A full timer-length session and live database persistence were not exercised in this iteration.
