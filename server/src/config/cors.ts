import { config } from "./env";

// "*" (the default) reflects any origin, matching this app's existing trusted-local-network
// stance. Set CORS_ORIGIN to a comma-separated allowlist to lock this down in production.
export const corsOrigin: string | string[] =
  config.CORS_ORIGIN === "*"
    ? "*"
    : config.CORS_ORIGIN.split(",").map((origin) => origin.trim());
