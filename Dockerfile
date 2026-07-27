FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

# NEXT_PUBLIC_* vars are inlined into the client bundle at build time, so they must be set
# here (not just at `docker run`) and should point at whatever host a browser can reach —
# e.g. the KDS server's public URL, not a docker-network-internal name.
ARG NEXT_PUBLIC_API_URL=http://localhost:3000
ARG NEXT_PUBLIC_SOCKET_URL=http://localhost:3000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_SOCKET_URL=$NEXT_PUBLIC_SOCKET_URL

RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
ENV HOSTNAME=0.0.0.0

RUN addgroup -S kds && adduser -S kds -G kds

COPY --from=build /app/public ./public
COPY --from=build --chown=kds:kds /app/.next/standalone ./
COPY --from=build --chown=kds:kds /app/.next/static ./.next/static

USER kds

EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3001)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
