# Slacker

Automatic Slack status synchronizer. Updates your Slack status based on webhook events from GitHub and Linear.

## Why?

Your Slack status reflects pending reviews, authored PRs and assigned issues. Rules decide which work takes priority. A pending review represents work to do; it does not detect whether you are actively reviewing or enable Slack Do Not Disturb.

## Quick Start

```bash
# Use the supported Node 22 release and install locked dependencies
nvm use
npm ci

# Configure
cp slacker.config.example.yaml slacker.config.yaml
# Edit the config file and export the environment variables below.
# Remove any provider you do not use from the config.

# Run
npm run dev
```

## Configuration

### Slack Token

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and click **Create New App**
2. Choose **From scratch**, name it (e.g., "Slacker"), and select your workspace
3. Go to **OAuth & Permissions** in the sidebar
4. Under **Scopes → User Token Scopes**, add:
   - `users.profile:write` (to update your status)
5. Click **Install to Workspace** and authorize
6. Copy the **User OAuth Token** (starts with `xoxp-`)

Use this token as `SLACK_TOKEN`.

### Environment Variables

| Variable | Description |
|----------|-------------|
| `SLACK_TOKEN` | Slack user OAuth token with `users.profile:write` (required) |
| `GITHUB_USERNAME` | Your GitHub username (required when GitHub is enabled, or set `username` in YAML) |
| `GITHUB_WEBHOOK_SECRET` | Secret for GitHub webhook validation |
| `LINEAR_USER_EMAIL` | Your Linear account email (required when Linear is enabled, or set `userEmail` in YAML) |
| `LINEAR_WEBHOOK_SECRET` | Secret for Linear webhook validation |
| `STATUS_TOKEN` | Optional bearer token to enable `GET /status`; omit to disable the route |
| `CONFIG_PATH` | Config file path (default: `slacker.config.yaml`) |
| `DB_PATH` | SQLite database path (default: `slacker.db`) |
| `PORT` | Server port (default: `3000`) |
| `HOST` | Bind address (default: `0.0.0.0`) |

The Node process reads exported environment variables; it does not load `.env` automatically. Docker Compose loads `.env`. Empty credentials, missing identities and unknown provider names prevent startup. Environment substitutions are resolved after YAML parsing and only in credentials, identities and `statusToken`; event templates keep their variables.

### Config File

```yaml
slack:
  token: ${SLACK_TOKEN}

providers:
  github:
    webhookSecret: ${GITHUB_WEBHOOK_SECRET}
    username: ${GITHUB_USERNAME}
  linear:
    webhookSecret: ${LINEAR_WEBHOOK_SECRET}
    userEmail: ${LINEAR_USER_EMAIL}

# Optional; STATUS_TOKEN is also read directly from the environment.
# statusToken: ${STATUS_TOKEN}

rules:
  # First matching rule wins
  - event: "pr:review_requested"
    status:
      emoji: ":eyes:"
      text: "Reviewing ${identifier}: ${title}"

  - event: "linear:issue:in_progress"
    status:
      emoji: ":computer:"
      text: "Working on ${identifier}"

defaultStatus:
  emoji: ""
  text: ""
```

### Supported Events

**GitHub:**
- `pr:authored:open`, `pr:authored:changes_requested`, `pr:authored:approved`
- `pr:review_requested`
- `issue:assigned`

PR/issue closure deactivates the snapshot. Reopening reactivates authored or assigned work. Submitting your review or removing your review request deactivates the pending review. Issue unassignment also deactivates the snapshot. Closing events do not produce active `*:closed` statuses.

**Linear:**
- Active types: `linear:issue:in_progress`, `linear:issue:in_review`, `linear:issue:todo`, `linear:issue:backlog`, `linear:issue:other`.
- Completed, canceled, duplicate, archived, removed or reassigned issues are inactive and no longer match rules. Workflow state semantics take precedence over display names; a started state named `In Review` maps to `in_review`.

The first matching rule wins. Within a rule, the newest source update wins; equal timestamps use ascending event ID. Snapshots reject older versions and repeated versions. When active/inactive snapshots have the same timestamp, inactive wins; reactivation requires a newer source timestamp.

Existing databases are migrated automatically without deleting snapshots. Rows with receipt timestamps accept their first source-versioned update; subsequent updates enforce source ordering. Keep the SQLite volume when upgrading.

GitHub review status follows the latest accepted review event rather than aggregating all reviewers. PR edits, pushed commits and dismissed reviews do not recalculate review state or refresh stored titles. Work that predates webhook setup, or deliveries missed while unavailable, requires a later supported webhook; Slacker does not fetch/backfill GitHub or Linear state.

### Template Variables

Use these in your status text:
- `${identifier}` - Issue/PR number (e.g., `#123`, `PROJ-456`)
- `${title}` - Issue/PR title
- `${url}` - Link to the issue/PR

Slack status text is truncated to 100 Unicode characters. Use workspace-installed emoji names in your rules.

## Webhook Setup

### GitHub

1. Go to Repository → Settings → Webhooks → Add webhook
2. Payload URL: `https://your-domain/webhooks/github`
3. Content type: `application/json`
4. Secret: same as `GITHUB_WEBHOOK_SECRET`
5. Events: Pull requests, Pull request reviews, Issues

### Linear

1. Go to Workspace → Settings → API → Webhooks → New webhook
2. URL: `https://your-domain/webhooks/linear`
3. Secret: same as `LINEAR_WEBHOOK_SECRET`
4. Events: Issues

Both endpoints verify the signature against the original request bytes before parsing and validating the payload. Invalid signatures return 401; malformed payloads return 400. Linear also requires a delivery timestamp no more than 24 hours old or 5 minutes in the future; the window allows provider retries.

A 200 response confirms that the normalized event has been persisted locally. Slack delivery happens independently through a single worker. Failures retain the desired state in SQLite; recovery runs every 30 seconds and on startup, and always recalculates the latest desired status. Slack rate-limit cooldowns are respected. On a fresh database, startup applies `defaultStatus`, including clearing Slack if it is empty.

SIGINT/SIGTERM stop recovery and drain the current delivery before closing SQLite. Slack requests have a 5-second absolute deadline and no SDK retries; the recovery worker owns retries so shutdown is bounded. Failed writes invalidate deduplication, since a missing acknowledgement does not prove the remote write was rejected. There should be one Slacker process per database and Slack user.

## Docker

```bash
docker compose up -d
```

Or build manually:

```bash
docker build -t slacker .
docker run --env-file .env -p 127.0.0.1:3000:3000 \
  -v ./slacker.config.yaml:/app/slacker.config.yaml:ro \
  -v slacker-data:/app/data slacker
```

Compose binds the published port to loopback. A tunnel in the same Docker network can still reach `http://slacker:3000`. The image contains production dependencies and compiled application code; tests are excluded. The publish workflow requires type checking, build, tests and a production dependency audit to pass.

## Cloudflare Tunnel

Cloudflare Tunnel exposes your local Slacker instance to the internet securely, without opening ports or configuring firewalls.

### Setup

1. Go to [Cloudflare Zero Trust Dashboard](https://one.dash.cloudflare.com/)
2. Navigate to **Networks → Tunnels**
3. Click **Create a tunnel**
4. Choose **Cloudflared** as the connector
5. Name your tunnel (e.g., "slacker")
6. Copy the **TUNNEL_TOKEN** shown in the installation command:
   ```bash
   cloudflared service install <TUNNEL_TOKEN>  # ← copy this token
   ```
7. Configure the public hostname:
   - Subdomain: `slacker` (or your preference)
   - Domain: select one of your Cloudflare domains
   - Service: `http://slacker:3000`

### Enable in Docker Compose

Uncomment the tunnel service in `docker-compose.yml` and add the token to your `.env`:

```bash
# .env
TUNNEL_TOKEN=eyJhIjoiNzM...  # your token here
```

Then restart:

```bash
docker compose up -d
```

Your webhooks will be available at `https://slacker.your-domain.com/webhooks/github`.

## Endpoints

| Endpoint | Description |
|----------|-------------|
| `POST /webhooks/github` | GitHub webhook receiver |
| `POST /webhooks/linear` | Linear webhook receiver |
| `GET /health` | Process liveness; does not assert Slack delivery succeeded |
| `GET /status` | Authenticated diagnostics, enabled only with `STATUS_TOKEN` or `statusToken` |

When enabled, query diagnostics using an `Authorization: Bearer <status token>` header. `currentStatus` is the desired status computed from SQLite; `lastAppliedStatus` is the last status acknowledged by Slack during this process; `pending` indicates outstanding synchronization and `lastError` exposes a safe failure code. This endpoint does not read the current remote profile. Changing your status manually in Slack is not detected by the cache. Diagnostics include private issue/PR titles and URLs: protect the token and serve the endpoint over HTTPS when exposing it remotely.

## Development

```bash
npm run dev      # Dev server with hot reload
npm test         # Run tests in watch mode
npm run test:run # Run tests once
npm run typecheck # Check application, test and fixture types
npm run build    # Compile TypeScript
npm audit        # Audit all dependencies
```

Tests use real SQLite, Fastify routes and the Slack SDK against a local HTTP contract fixture. They verify durable acceptance, acknowledgements, failed-write recovery, serialization and restart behavior without Slack credentials or external HTTP. They are contract integration tests, not live Slack end-to-end tests. `npm run build` cleans `dist` and excludes test files.

## License

MIT
