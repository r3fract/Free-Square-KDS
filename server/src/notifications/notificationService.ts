export interface NotificationService {
  notifyOrderReady(order: {
    squareOrderId: string;
    displayNumber: string | null;
  }): Promise<void>;
}
