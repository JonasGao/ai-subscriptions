# --- deps: install all dependencies (devDeps needed for next build) ---
# z.my = local docker.io mirror (direct registry access is not available)
FROM z.my/node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# --- build: produce standalone output ---
FROM z.my/node:24-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_OUTPUT=standalone
RUN npm run build

# --- runner: minimal production image, non-root ---
FROM z.my/node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV DATA_DIR=/data

# Official node image ships user "node" (uid 1000); matches host user for volume writes
RUN mkdir -p /data && chown node:node /data
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]
