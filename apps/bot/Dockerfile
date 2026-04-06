# syntax=docker/dockerfile:1
FROM oven/bun:1.3.4-alpine AS base
WORKDIR /app

# Install dependencies (cached layer)
FROM base AS deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Runtime image
FROM base AS runner
WORKDIR /app

# Copy deps and source
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Create writable directories for SQLite persistence and config access
RUN mkdir -p /app/data /app/config \
  && chown -R bun:bun /app

# Run as non-root user for safety
USER bun

EXPOSE 0

CMD ["bun", "run", "src/main.ts"]
