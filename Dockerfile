# ABOUTME: Multi-stage Dockerfile for Slacker
# ABOUTME: Builds TypeScript and creates minimal production image

# --- Build stage ---
FROM node:22-alpine AS builder

WORKDIR /app

# Install build dependencies for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++

# Copy package files first for better caching
COPY package.json package-lock.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source and build
COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# --- Production stage ---
FROM node:22-alpine

WORKDIR /app

# Install runtime dependencies for better-sqlite3
RUN apk add --no-cache libstdc++

# Create non-root user
RUN addgroup -g 1001 -S slacker && \
    adduser -S slacker -u 1001 -G slacker

# Copy package files
COPY package.json package-lock.json ./

# Install production dependencies only
RUN npm ci --omit=dev && npm cache clean --force

# Copy built files from builder
COPY --from=builder /app/dist ./dist

# Copy example config (user should mount their own)
COPY slacker.config.example.yaml ./slacker.config.example.yaml

# Create data directory for SQLite
RUN mkdir -p /app/data && chown slacker:slacker /app/data

# Switch to non-root user
USER slacker

# Environment defaults
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV DB_PATH=/app/data/slacker.db
ENV CONFIG_PATH=/app/slacker.config.yaml

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "dist/index.js"]
