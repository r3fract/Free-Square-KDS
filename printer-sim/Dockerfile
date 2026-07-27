# This service impersonates a real Star Micronics LAN printer (FreeKDS) — UDP:22222 discovery,
# TCP:9101 status polling, TCP:9100 raster print data (+ HTTP:8008 ePOS-Print and mDNS as
# hedges) — so Square's POS can find and "print" to it. That only works if the container is
# reachable on the actual restaurant LAN — run it with `network_mode: host` (Linux hosts only;
# Docker Desktop on Windows/Mac does not pass through mDNS/UDP broadcast to the host network,
# so discovery and raw TCP printing will not work there). See README.md for details.
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Real tickets arrive as rasterized bitmaps, not text — tesseract-ocr is required to decode them.
RUN apk add --no-cache tesseract-ocr
ENV TESSERACT_PATH=/usr/bin/tesseract
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist

RUN addgroup -S kds && adduser -S kds -G kds
USER kds

CMD ["node", "dist/index.js"]
