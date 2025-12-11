# Slacker - Slack Status Synchronizer

## Overview

Slacker es un servidor que sincroniza tu estado de Slack basándose en eventos de GitHub y Linear (y otros providers futuros). Combina dos casos de uso:

1. **Focus mode automático** - Tu estado cambia a "En revisión de código" o "Deep work" para minimizar interrupciones
2. **Visibilidad de actividad** - Compañeros pueden ver en qué estás trabajando

## Arquitectura

```
┌──────────────────────────────────────────────────┐
│                   Providers                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐   │
│  │  GitHub  │  │  Linear  │  │  Future...   │   │
│  │ Provider │  │ Provider │  │  (Calendar,  │   │
│  │          │  │          │  │   Jira, etc) │   │
│  └────┬─────┘  └────┬─────┘  └──────┬───────┘   │
│       │             │               │            │
│       └─────────────┴───────────────┘            │
│                     │                            │
│                     ▼                            │
│         ┌─────────────────────┐                  │
│         │   StatusEvent       │                  │
│         │   (formato común)   │                  │
│         └─────────────────────┘                  │
└──────────────────────────────────────────────────┘
                      │
                      ▼
              ┌───────────────┐
              │  Rule Engine  │
              └───────┬───────┘
                      │
                      ▼
              ┌───────────────┐
              │   Slack API   │
              └───────────────┘
```

### Componentes Principales

- **Providers** - Reciben webhooks y los normalizan a `StatusEvent`
- **State Store** - Persiste eventos activos en SQLite
- **Rule Engine** - Evalúa prioridades según configuración
- **Slack Client** - Actualiza estado cuando el evento prioritario cambia

### Flujo

1. Llega webhook (ej: PR asignada para review)
2. Provider lo normaliza a `StatusEvent`
3. Se guarda en el State Store
4. Rule Engine re-evalúa qué evento tiene prioridad
5. Si cambió el evento prioritario, actualiza Slack

## Provider Interface

```typescript
interface Provider {
  name: string;

  // Registra rutas de webhook en el servidor
  registerRoutes(router: Router): void;

  // Parsea webhook crudo a eventos de estado
  parseWebhook(payload: unknown): StatusEvent[];

  // Tipos de eventos que este provider puede generar
  eventTypes: EventType[];
}
```

Cada provider es responsable de:
- Validar la firma/autenticidad de sus webhooks
- Transformar el payload específico al formato común `StatusEvent`
- Declarar qué tipos de eventos puede producir

**Agregar un nuevo provider = un archivo** que implemente la interfaz.

## Modelo de Datos

### StatusEvent

```typescript
interface StatusEvent {
  // Identificador único (ej: "github:pr:123", "linear:issue:ABC-456")
  id: string;

  // Qué provider lo generó
  provider: string;

  // Tipo de evento para el rule engine
  type: EventType;

  // ¿Está activo? (PR abierta = true, PR mergeada = false)
  active: boolean;

  // Datos para renderizar el template del estado
  context: {
    title: string;
    url: string;
    identifier: string;  // "#123" o "PROJ-456"
    [key: string]: unknown;
  };

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

type EventType =
  // GitHub
  | "pr:authored:open"
  | "pr:authored:changes_requested"
  | "pr:authored:approved"
  | "pr:review_requested"
  | "issue:assigned"
  // Linear
  | "linear:issue:in_progress"
  | "linear:issue:in_review"
  // Genérico para futuros providers
  | `${string}:${string}`;
```

### Eventos Soportados

**GitHub:**
- PRs que creaste (open, changes_requested, approved)
- PRs donde eres reviewer
- Issues asignados

**Linear:**
- Issues asignados a ti (cambios de estado: In Progress, In Review, etc.)

## Configuración

```yaml
# slacker.config.yaml

slack:
  token: ${SLACK_TOKEN}

providers:
  github:
    webhook_secret: ${GITHUB_WEBHOOK_SECRET}
  linear:
    webhook_secret: ${LINEAR_WEBHOOK_SECRET}

# Prioridad: el primero que matchee gana
rules:
  - event: "pr:authored:changes_requested"
    status:
      emoji: ":warning:"
      text: "Atendiendo cambios en PR ${identifier}"

  - event: "pr:review_requested"
    status:
      emoji: ":eyes:"
      text: "Revisando ${identifier}: ${title}"

  - event: "linear:issue:in_progress"
    status:
      emoji: ":computer:"
      text: "Trabajando en ${identifier}"

  - event: "pr:authored:open"
    status:
      emoji: ":git-pr:"
      text: "PR abierta: ${identifier}"

  - event: "issue:assigned"
    status:
      emoji: ":github:"
      text: "Issue ${identifier}"

# Estado cuando no hay eventos activos
default_status:
  emoji: ""
  text: ""
```

### Rule Engine

1. Filtra eventos donde `active === true`
2. Recorre las reglas en orden (primera = mayor prioridad)
3. La primera regla cuyo `event` matchee un evento activo, gana
4. Renderiza el template con el `context` del evento
5. Si no hay match, usa `default_status`

## State Store

SQLite para persistencia simple y robusta:

```typescript
interface StateStore {
  upsert(event: StatusEvent): Promise<void>;
  getActive(): Promise<StatusEvent[]>;
  get(id: string): Promise<StatusEvent | null>;
  deactivate(id: string): Promise<void>;
  prune(olderThan: Date): Promise<number>;
}
```

```sql
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  type TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  context TEXT NOT NULL,  -- JSON
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_active ON events(active);
CREATE INDEX idx_provider ON events(provider);
```

## Estructura del Proyecto

```
slacker/
├── src/
│   ├── index.ts              # Entry point
│   ├── server.ts             # HTTP server
│   ├── config.ts             # Carga configuración
│   │
│   ├── providers/
│   │   ├── provider.ts       # Interfaz Provider
│   │   ├── github.ts         # GitHub provider
│   │   └── linear.ts         # Linear provider
│   │
│   ├── engine/
│   │   ├── rules.ts          # Rule engine
│   │   └── template.ts       # Renderiza templates
│   │
│   ├── store/
│   │   └── sqlite.ts         # StateStore SQLite
│   │
│   └── slack/
│       └── client.ts         # Cliente Slack
│
├── slacker.config.yaml
├── package.json
└── tsconfig.json
```

## Endpoints

```
POST /webhooks/github    # Webhooks de GitHub
POST /webhooks/linear    # Webhooks de Linear
GET  /health             # Health check
GET  /status             # Debug: estado actual
```

## Dependencias

- `fastify` - servidor HTTP
- `better-sqlite3` - SQLite
- `@slack/web-api` - cliente Slack
- `yaml` - parsear configuración
- `zod` - validación

## Ejecución Local

Requiere túnel para recibir webhooks:

```bash
# Cloudflare Tunnel
cloudflared tunnel --url http://localhost:3000

# ngrok
ngrok http 3000
```

### Setup GitHub Webhooks

1. Repo → Settings → Webhooks → Add webhook
2. URL: `https://<tunel>/webhooks/github`
3. Content type: `application/json`
4. Secret: mismo que en config
5. Eventos: Pull requests, Pull request reviews, Issues

### Setup Linear Webhooks

1. Settings → API → Webhooks → New webhook
2. URL: `https://<tunel>/webhooks/linear`
3. Eventos: Issues

## Stack

- TypeScript / Node.js
- Webhooks (no polling)
- SQLite para persistencia
- Configuración YAML con templates
