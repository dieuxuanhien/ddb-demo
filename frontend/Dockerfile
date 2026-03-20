# ── Stage 1: build ───────────────────────────────────────────────────────────
FROM docker.io/library/node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ── Stage 2: serve with nginx ─────────────────────────────────────────────────
FROM docker.io/library/nginx:1.25-alpine

COPY --from=builder /app/dist /usr/share/nginx/html

# A tiny nginx config that handles SPA routing
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
