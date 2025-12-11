# Slacker

Automatic Slack status synchronizer. Updates your Slack status based on webhook events from GitHub and Linear.

## Why?

When you're reviewing a PR or working on a Linear issue, your Slack status updates automatically. Your team knows when you're in deep work without you having to remember to set it manually.

## Quick Start

```bash
# Install
npm install

# Configure
cp slacker.config.example.yaml slacker.config.yaml
# Edit the config file with your tokens and rules

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
| `SLACK_TOKEN` | Slack bot OAuth token (required) |
| `GITHUB_USERNAME` | Your GitHub username |
| `GITHUB_WEBHOOK_SECRET` | Secret for GitHub webhook validation |
| `LINEAR_USER_EMAIL` | Your Linear account email |
| `LINEAR_WEBHOOK_SECRET` | Secret for Linear webhook validation |
| `CONFIG_PATH` | Config file path (default: `slacker.config.yaml`) |
| `DB_PATH` | SQLite database path (default: `slacker.db`) |
| `PORT` | Server port (default: `3000`) |

### Config File

```yaml
slack:
  token: ${SLACK_TOKEN}

providers:
  github:
    webhookSecret: ${GITHUB_WEBHOOK_SECRET}
  linear:
    webhookSecret: ${LINEAR_WEBHOOK_SECRET}

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
- `pr:authored:open`, `pr:authored:closed`, `pr:authored:changes_requested`, `pr:authored:approved`
- `pr:review_requested`
- `issue:assigned`, `issue:closed`

**Linear:**
- `linear:issue:in_progress`, `linear:issue:in_review`, `linear:issue:done`, etc.

### Template Variables

Use these in your status text:
- `${identifier}` - Issue/PR number (e.g., `#123`, `PROJ-456`)
- `${title}` - Issue/PR title
- `${url}` - Link to the issue/PR

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

## Docker

```bash
docker-compose up -d
```

Or build manually:

```bash
docker build -t slacker .
docker run -p 3000:3000 -v ./slacker.config.yaml:/app/slacker.config.yaml slacker
```

## Endpoints

| Endpoint | Description |
|----------|-------------|
| `POST /webhooks/github` | GitHub webhook receiver |
| `POST /webhooks/linear` | Linear webhook receiver |
| `GET /health` | Health check |
| `GET /status` | Current status and active events (debug) |

## Development

```bash
npm run dev      # Dev server with hot reload
npm test         # Run tests in watch mode
npm run test:run # Run tests once
npm run build    # Compile TypeScript
```

## License

MIT
