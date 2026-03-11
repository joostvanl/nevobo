# Build stage: install only production dependencies
FROM node:20-alpine AS deps

WORKDIR /app

COPY package*.json ./

# better-sqlite3 needs native compilation — install build tools temporarily
RUN apk add --no-cache python3 make g++ \
 && npm ci --omit=dev \
 && apk del python3 make g++

# ─────────────────────────────────────────────────────────────────────────────
# Runtime stage
FROM node:20-alpine

WORKDIR /app

# Copy production node_modules from build stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application code
COPY server ./server
COPY public ./public
COPY package.json ./

# Data directory (SQLite DB + uploads) is mounted as a volume at runtime
RUN mkdir -p /app/data /app/public/uploads

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "server/index.js"]
