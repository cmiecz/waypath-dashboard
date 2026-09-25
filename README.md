# WayPath Pipeline Dashboard

Private, live web dashboard for the WayPath Academics AI development pipeline. Cass ([`cmiecz`](https://github.com/cmiecz)) and Matt ([`mwaldau71`](https://github.com/mwaldau71)) can see open requests by stage, who is working, recent activity, and what shipped — without digging through GitHub comments.

This service is **read-only** toward `cmiecz/waypathacademics`. It never posts comments, changes labels, or opens PRs.

## Features

- **Pipeline board** — open request issues in columns by `status:*` stage
- **Working now** — bots with an open `started` event (no matching `finished`)
- **Activity feed** — GitHub issue/PR activity merged with bot events
- **Shipped** — issues closed as completed in the last 14 days
- **Summary counts** — per stage + “needs Cass”
- **Live updates** — server polls GitHub every ~45s (ETags/caching) and pushes via SSE; optional GitHub webhook for immediate refresh
- **Bot events API** — bots report `started` / `finished` / `note` directly
- **Cursor cloud agents** (optional) — when `CURSOR_API_KEY` is set, shows agents for the product repo via the [official Cloud Agents API](https://cursor.com/docs/cloud-agent/api/endpoints)
- **Demo mode** — `DEMO_MODE=true` renders clearly marked sample data

### Display rules

- Each request is identified **only** as `#<issue> <short title>` (never a PR number as a second ID)
- PR link label: **Review the fix**
- Preview link label: **Test it here** (latest `*.onrender.com` URL from issue/PR comments)
- Times are **America/New_York** with an **ET** label, plus relative times

## Stack

Node 20+, TypeScript, Express, vanilla HTML/CSS/JS frontend. Optional Postgres for durable bot events.

## Quick start (demo)

```bash
cp .env.example .env
# DEMO_MODE=true is already set in .env.example
npm install
npm test
npm run build
npm start   # loads .env via dotenv
```

Open http://localhost:10000 — you should see a **Sample data** banner.

## Environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `PORT` | No | Listen port (Render sets this; default `10000`) |
| `BASE_URL` | Yes (prod) | Public origin, e.g. `https://waypath-dashboard.onrender.com` |
| `DEMO_MODE` | No | `true` = sample data, no live GitHub (default `false`) |
| `SESSION_SECRET` | Yes | Signs session cookies |
| `GITHUB_CLIENT_ID` | Yes\* | OAuth App client ID |
| `GITHUB_CLIENT_SECRET` | Yes\* | OAuth App client secret |
| `ALLOWED_GITHUB_USERS` | No | Comma-separated logins (default `cmiecz,mwaldau71`) |
| `GITHUB_TOKEN` | Yes\* | Fine-grained PAT for reading `waypathacademics` |
| `GITHUB_OWNER` | No | Default `cmiecz` |
| `GITHUB_REPO` | No | Default `waypathacademics` |
| `GITHUB_WEBHOOK_SECRET` | No | Enables verified webhook → immediate refresh |
| `BOT_EVENTS_TOKEN` | Yes | Bearer token for `POST /api/events` |
| `DATABASE_URL` | No | Postgres URL; without it, bot events are **in-memory** (lost on restart) |
| `GITHUB_POLL_INTERVAL_MS` | No | Default `45000` |
| `CURSOR_API_KEY` | No | Cursor user/service API key for cloud agents panel |
| `NODE_ENV` | No | `production` on Render |

\* Not required when `DEMO_MODE=true`.

### Bot events storage tradeoff

- **No `DATABASE_URL`**: last ~400 events in process memory. Fine for a single instance; **cleared on every deploy/restart** (Render’s filesystem is ephemeral anyway).
- **With `DATABASE_URL`**: events persist across restarts. Uncomment the database block in `render.yaml` and wire `DATABASE_URL`.

## GitHub OAuth App

1. GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App**
2. Homepage URL: your `BASE_URL`
3. **Authorization callback URL**: `{BASE_URL}/auth/github/callback`  
   Example: `https://waypath-dashboard.onrender.com/auth/github/callback`
4. Copy Client ID / Secret into `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`
5. Only users in `ALLOWED_GITHUB_USERS` can complete sign-in (`read:user` scope)

## Fine-grained PAT (`GITHUB_TOKEN`)

Create a fine-grained personal access token with access to **`cmiecz/waypathacademics`** only.

**Repository permissions (read-only):**

| Permission | Access |
|------------|--------|
| **Metadata** | Read-only (required) |
| **Issues** | Read-only |
| **Pull requests** | Read-only |
| **Contents** | Read-only (commits / branch context on PRs) |
| **Commit statuses** | Read-only (optional; only if you later surface checks) |

Do **not** grant Issues/PR write. The dashboard never writes to GitHub.

## Bot events API

`POST /api/events` with `Authorization: Bearer <BOT_EVENTS_TOKEN>`.

Body:

```json
{
  "bot": "QA Engineer",
  "issue": 30,
  "action": "started",
  "message": "Testing preview walkthrough",
  "url": "https://waypath-pr-91.onrender.com"
}
```

`action` must be `started`, `finished`, or `note`. Requests **without** a valid bearer token are rejected (`401`).

### Curl example (copy-paste)

```bash
curl -X POST "$BASE_URL/api/events" \
  -H "Authorization: Bearer $BOT_EVENTS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "bot": "QA Engineer",
    "issue": 30,
    "action": "started",
    "message": "Testing preview walkthrough",
    "url": "https://waypath-pr-91.onrender.com"
  }'
```

Finish work:

```bash
curl -X POST "$BASE_URL/api/events" \
  -H "Authorization: Bearer $BOT_EVENTS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "bot": "QA Engineer",
    "issue": 30,
    "action": "finished",
    "message": "QA PASS on preview"
  }'
```

## Optional GitHub webhook

1. In `cmiecz/waypathacademics` → **Settings → Webhooks → Add webhook**
2. Payload URL: `{BASE_URL}/api/github/webhook`
3. Content type: `application/json`
4. Secret: same value as `GITHUB_WEBHOOK_SECRET`
5. Events: Issues, Issue comments, Pull requests, Pushes (or “Send me everything”)
6. The endpoint verifies `X-Hub-Signature-256` and triggers an immediate snapshot refresh. Without a configured secret, the endpoint returns `503`.

## Deploy on Render

1. Push this repo to GitHub
2. Render → **New → Blueprint** and select the repo (`render.yaml` is included). Build command is `npm ci --include=dev && npm run build` so TypeScript is available during compile (Render’s default install omits devDependencies).
3. Fill sync:false env vars: `BASE_URL`, OAuth credentials, `GITHUB_TOKEN`, optional webhook secret / Cursor key
4. Set the OAuth callback to `{BASE_URL}/auth/github/callback`
5. Health check path: `/healthz` (already in the Blueprint)
6. After deploy, optionally add the GitHub webhook

The web service binds to `0.0.0.0:$PORT` as required by Render.

## Cursor cloud agents panel

Included when `CURSOR_API_KEY` is set. Uses the official API:

- `GET https://api.cursor.com/v1/agents` (Basic auth with API key)
- `GET https://api.cursor.com/v1/agents/{id}` for repo/branch/PR details
- Docs: https://cursor.com/docs/cloud-agent/api/endpoints

Agents are filtered to `cmiecz/waypathacademics` when repo metadata is present. If the key is unset, the panel is hidden (demo mode shows sample agents).

## Demo screenshots

Captured with `DEMO_MODE=true`:

- [`docs/screenshots/dashboard-demo-desktop.png`](docs/screenshots/dashboard-demo-desktop.png)
- [`docs/screenshots/dashboard-demo-mobile.png`](docs/screenshots/dashboard-demo-mobile.png)

## Stage labels

Open issues use exactly one of:

- `status: reported` → Product Architect
- `status: waiting on input` → waiting on Matt / Cass / whoever `waiting on: *` names (or “Waiting on input” if unnamed)
- `status: being built` → Product Architect
- `status: ready to test` → QA Engineer
- `status: needs fix` → Product Architect
- `status: qa passed` → Release Engineer
- `status: ready to merge` → Cass

Optional assignment labels (do not change stage): `waiting on: matt`, `waiting on: cass`, or any `waiting on: <name>`.

Missing status labels are treated as **Reported**. `product-intake` is ignored. Closed as **completed** → Shipped; **not planned** are omitted from Shipped.
