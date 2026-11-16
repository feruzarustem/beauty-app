import type { PaymentMethod } from "@prisma/client";

export const PAYMENT_METHODS: PaymentMethod[] = ["cash", "kaspi", "kaspi_red", "halyk", "transfer"];
export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  cash: "Наличные",
  kaspi: "Kaspi QR",
  kaspi_red: "Kaspi Red",
  halyk: "Halyk Bank",
  transfer: "Перевод",
};
/** Предоплата принимается только безналичной (переводом и т. п.), наличными нельзя. */
export const PREPAY_METHODS: PaymentMethod[] = PAYMENT_METHODS.filter((m) => m !== "cash");

export function parsePayment(v: unknown): PaymentMethod {
  return PAYMENT_METHODS.find((m) => m === v) ?? "cash";
}
export function parsePrepayMethod(v: unknown): PaymentMethod {
  return PREPAY_METHODS.find((m) => m === v) ?? "transfer";
}
