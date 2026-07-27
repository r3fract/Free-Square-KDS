import { WebhooksHelper } from "square";
import { config } from "../config/env";

export async function verifySquareSignature(
  rawBody: string,
  signatureHeader: string | undefined
): Promise<boolean> {
  if (!signatureHeader) return false;

  return WebhooksHelper.verifySignature({
    requestBody: rawBody,
    signatureHeader,
    signatureKey: config.SQUARE_WEBHOOK_SIGNATURE_KEY,
    notificationUrl: config.SQUARE_WEBHOOK_NOTIFICATION_URL,
  });
}
