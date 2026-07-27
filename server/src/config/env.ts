import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  SQUARE_ACCESS_TOKEN: z.string().min(1, "SQUARE_ACCESS_TOKEN is required"),
  SQUARE_ENVIRONMENT: z.enum(["sandbox", "production"]).default("sandbox"),
  SQUARE_LOCATION_ID: z.string().min(1, "SQUARE_LOCATION_ID is required"),
  SQUARE_WEBHOOK_SIGNATURE_KEY: z.string().min(1, "SQUARE_WEBHOOK_SIGNATURE_KEY is required"),
  SQUARE_WEBHOOK_NOTIFICATION_URL: z.string().url("SQUARE_WEBHOOK_NOTIFICATION_URL must be a valid URL"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  PORT: z.coerce.number().int().positive().default(3000),
  // Comma-separated list of allowed browser origins (e.g. "https://kds.example.com,https://display.example.com").
  // Defaults to "*" (reflect any origin) so local/dev setups keep working without extra config.
  CORS_ORIGIN: z.string().default("*"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
