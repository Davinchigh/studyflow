# Deploying StudyFlow for testers

StudyFlow is two parts:

- **API** (`backend/`): FastAPI plus SQLite, packaged by `backend/Dockerfile`.
- **Web app** (`frontend/`): static files built by Vite (`npm run build` produces `frontend/dist`).

Deploy the API first, because the web app needs the API's address when it is built.

## How tester data works

- **Private workspaces:** every browser gets its own private workspace, a random 32-character id kept in that browser. The API stores each workspace as its own SQLite file in `STUDY_DATA_DIR` (`/data` in the container) and fills it with a sample week on first visit. There are no passwords or accounts.
- **Moving devices:** **Profile › Use on another device** copies a link containing the workspace id. Opening it on a phone shows the same plan. Anyone holding that link can see and edit that plan, so testers should keep it private.
- **Lost links:** if a tester clears their browser data and has no copy of their link, their workspace cannot be recovered. That is acceptable for a test, but not for a real launch.
- **Limits:**
  - **`MAX_WORKSPACES`:** caps how many workspaces can be created (default 1000). After that, new visitors see "StudyFlow's test is full right now".
  - **`RATE_LIMIT_PER_MINUTE`:** caps requests per IP address (default 240).
  - **Payload sizes:** the API validates request sizes, and calendar imports are capped at 2 MB.

## Current deployment (free)

- **Web app:** Vercel project `studyflow`, root `frontend`, at https://studyflow-kappa-ashen.vercel.app
- **API:** Vercel project `studyflow-api`, root `backend` (FastAPI preset), at https://studyflow-api-eight.vercel.app
- **Database:** Neon Postgres, free plan, project `studyflow` (aws-us-east-1). The API reads it from `DATABASE_URL`, using the pooled connection string.

Both Vercel projects redeploy on every push to `main`. With `DATABASE_URL` set, each workspace is its own Postgres schema (`ws_<id>`) instead of a SQLite file. Without it, the API falls back to SQLite files, as in local development.

## 1. API

**Free option (current):** deploy `backend/` as a second Vercel project with the FastAPI framework preset. Set `DATABASE_URL` to a free Neon Postgres pooled connection string, and set `ALLOWED_ORIGINS`. No disk is needed.

**Docker option:** use a host that runs a Docker image and offers a **persistent disk or volume**, for example Render, Railway or Fly.io. Persistent storage is usually a paid feature, and without it every redeploy erases all tester data. On Railway, also set `RAILWAY_RUN_UID=0`, because volumes mount as root and the image runs as a non-root user.

1. **Create the service:** create a web service from the `backend/` folder using its `Dockerfile`.
2. **Attach storage:** mount a persistent disk or volume at `/data`.
3. **Set the environment** (see `backend/.env.example`):
   - `ALLOWED_ORIGINS`: the exact address of the web app once it is deployed, for example `https://studyflow-test.netlify.app`, with no trailing slash. To begin with, set it to a placeholder and update it after step 2.
   - `STUDY_DATA_DIR=/data` (already the image default).
   - Optional: `MAX_WORKSPACES`, `RATE_LIMIT_PER_MINUTE`.
4. **Check it:** after deploying, `https://<your-api>/api/health` should return `{"status":"ok"}`.

The image listens on `$PORT` when the host provides one, or on 8000 otherwise.

## 2. Web app

Use any static host, for example Netlify, Vercel or Cloudflare Pages.

- **Base directory:** `frontend`
- **Build command:** `npm ci && npm run build`
- **Publish directory:** `dist`
- **Environment variable:** `VITE_API_URL=https://<your-api>/api`. It is read at build time, so rebuild after changing it.

Then set the API's `ALLOWED_ORIGINS` to the web app's final address and redeploy the API.

## 3. Check before inviting testers

- **Live connection:** open the site; the header pill should say **Synced**, not Offline.
- **Isolation:** open it in a private window too. Each window should have its own sample week, and a task added in one must not appear in the other.
- **Device link:** use **Use on another device** to open the same plan on a phone.
- **Calendar import:** import an `.ics` file and check that its classes appear.
- **Reminders:** reminders only appear while StudyFlow is open in a tab. Tell testers this, because there are no push notifications yet.

## Known limits of the test version

- **No accounts:** a workspace link is the only key to a plan.
- **SQLite on one server:** fine for a test group. Moving to a managed database such as Postgres is the step before a wider launch.
- **Rate limits in memory:** they reset when the API restarts and are counted per server instance.
- **The assistant is rule-based:** it is a command reader, not an AI model, and it says so.
