import { API_URL } from "./env";
import type { DisplaySummary, OrderWithItems } from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message =
      body && typeof body.error === "string"
        ? body.error
        : `Request to ${path} failed with status ${res.status}`;
    throw new ApiError(message, res.status);
  }

  return res.json() as Promise<T>;
}

export const api = {
  async getActiveOrders(): Promise<OrderWithItems[]> {
    const data = await request<{ orders: OrderWithItems[] }>("/api/orders/active");
    return data.orders;
  },

  async getCompletedOrders(): Promise<OrderWithItems[]> {
    const data = await request<{ orders: OrderWithItems[] }>("/api/orders/completed");
    return data.orders;
  },

  async recallOrder(orderId: number): Promise<OrderWithItems> {
    const data = await request<{ order: OrderWithItems }>(`/api/orders/${orderId}/recall`, {
      method: "POST",
    });
    return data.order;
  },

  async getOrder(id: number): Promise<OrderWithItems> {
    const data = await request<{ order: OrderWithItems }>(`/api/orders/${id}`);
    return data.order;
  },

  async setItemCompletion(
    orderId: number,
    itemId: number,
    completed: boolean,
  ): Promise<OrderWithItems> {
    const data = await request<{ order: OrderWithItems }>(
      `/api/orders/${orderId}/items/${itemId}/complete`,
      {
        method: "PATCH",
        body: JSON.stringify({ completed }),
      },
    );
    return data.order;
  },

  async getDisplaySummary(): Promise<DisplaySummary> {
    return request<DisplaySummary>("/api/display/summary");
  },
};
