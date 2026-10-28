# Base image, overridable at build time via NODE_IMAGE
# (machine mirrors set it in ~/docker/ai-subscriptions/build.env, see deploy/docker/README.md)
ARG NODE_IMAGE=node:24-alpine

# --- deps: install all dependencies (devDeps needed for next build) ---
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# --- build: produce standalone output ---
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_OUTPUT=standalone
RUN npm run build

# --- runner: minimal production image, non-root ---
FROM ${NODE_IMAGE} AS runner
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
