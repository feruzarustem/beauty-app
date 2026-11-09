import type { PaymentMethod } from "@prisma/client";

export const PAYMENT_METHODS: PaymentMethod[] = ["cash", "kaspi", "transfer"];
export const PAYMENT_LABEL: Record<PaymentMethod, string> = { cash: "Наличные", kaspi: "Kaspi/QR", transfer: "Перевод" };

export function parsePayment(v: unknown): PaymentMethod {
  return PAYMENT_METHODS.find((m) => m === v) ?? "cash";
}
