import type { NotificationService } from "./notificationService";

export class ConsoleNotificationService implements NotificationService {
  async notifyOrderReady(order: { squareOrderId: string; displayNumber: string | null }): Promise<void> {
    const label = order.displayNumber ?? order.squareOrderId;
    console.log(`[notify] Order ${label} is ready for pickup.`);
  }
}

export const notificationService: NotificationService = new ConsoleNotificationService();
