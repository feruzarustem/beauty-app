import type { PaymentMethod } from "@prisma/client";
import { ValidationError } from "@/lib/errors";

/** Фиксированная предоплата за запись (тенге). Входит в стоимость услуги, отдельной выручкой не считается. */
export const PREPAY_AMOUNT = 2000;

export type DiscountBearer = "master" | "salon" | "shared";

export type SplitInput = {
  /** P — полная стоимость услуг. */
  listAmount: number;
  /** Процент скидки, целое 0–100. */
  discountPercent: number;
  bearer: DiscountBearer | null;
  /** «Блогер / Реклама»: мастер получает 100% оплаты, доход салона 0. Со скидкой не сочетается. */
  blogger: boolean;
  /** A — предоплата: 0 или PREPAY_AMOUNT. */
  prepaid: number;
  /** Процент мастера по специализации. */
  masterPercent: number;
};

export type SplitResult = {
  discountAmount: number;
  /** F = P − D: сколько клиент платит салону в итоге (предоплата уже внутри). */
  finalAmount: number;
  /** Остаток к оплате при закрытии: F − предоплата (не меньше 0). */
  remainder: number;
  /** Если предоплата больше итога, разница возвращается клиенту. */
  refund: number;
  master: number;
  salon: number;
  /** Плановая доля мастера до скидки: округление вниз (P × процент / 100). */
  plannedMaster: number;
  /** Предупреждение, если пришлось сократить доли. Показывается администратору, молча не меняем. */
  warning: string | null;
};

const fmt = (n: number) => `${n.toLocaleString("ru-RU")} ₸`;

/**
 * Одна формула для всего приложения.
 *   D = ⌊P·d/100⌋,  F = P − D,  W = ⌊P·pct/100⌋
 *   мастер платит скидку: bm = D;  салон: bm = 0;  пополам: bm = ⌊D/2⌋
 *   M = min(F, max(0, W − bm)),  S = F − M      (блогер: M = F, S = 0)
 * Доли считаются от итога F, а не от остатка, поэтому предоплата на них не влияет.
 */
export function computeSplit(input: SplitInput): SplitResult {
  const { listAmount: P, discountPercent: d, bearer, blogger, prepaid: A, masterPercent: pct } = input;
  if (!Number.isInteger(P) || P <= 0) throw new ValidationError("Стоимость должна быть целым числом тенге больше нуля");
  if (!Number.isInteger(d) || d < 0 || d > 100) throw new ValidationError("Скидка — целое число процентов от 0 до 100");
  if (A !== 0 && A !== PREPAY_AMOUNT) throw new ValidationError(`Предоплата — ${PREPAY_AMOUNT} ₸ или без предоплаты`);
  if (blogger && d > 0) throw new ValidationError("«Блогер / Реклама» не сочетается со скидкой");
  if (d > 0 && !bearer) throw new ValidationError("Укажите, за чей счёт скидка");

  const D = Math.floor((P * d) / 100);
  const F = P - D;
  const applied = Math.min(A, F);
  const remainder = F - applied;
  const refund = A - applied;
  const W = Math.floor((P * pct) / 100);

  if (blogger) {
    return { discountAmount: 0, finalAmount: F, remainder, refund, master: F, salon: 0, plannedMaster: W, warning: null };
  }
  const bm = d === 0 ? 0 : bearer === "master" ? D : bearer === "shared" ? Math.floor(D / 2) : 0;
  const raw = W - bm;
  let master = Math.min(F, Math.max(0, raw));
  let warning: string | null = null;
  if (F === 0 && D > 0) {
    master = 0;
    warning = "Скидка 100%: доли мастера и салона равны 0 ₸.";
  } else if (raw < 0) {
    warning = `Скидка больше доли мастера: его доля сокращена до 0 ₸ (салону ${fmt(F)}).`;
  } else if (raw > F) {
    warning = `Скидка больше доли салона: доля мастера сокращена до ${fmt(F)}, доход салона 0 ₸ (по плану мастеру ${fmt(W)}).`;
  }
  return { discountAmount: D, finalAmount: F, remainder, refund, master, salon: F - master, plannedMaster: W, warning };
}

/** Из каких способов оплаты сложился итог: предоплата (своим способом) и остаток (способом закрытия). */
export function paymentBreakdown(v: {
  finalAmount: number;
  prepaid: number;
  prepaidMethod: PaymentMethod | null;
  method: PaymentMethod;
}): { method: PaymentMethod; amount: number }[] {
  const applied = v.prepaidMethod ? Math.min(v.prepaid, v.finalAmount) : 0;
  const out: { method: PaymentMethod; amount: number }[] = [];
  if (applied > 0 && v.prepaidMethod) out.push({ method: v.prepaidMethod, amount: applied });
  if (v.finalAmount - applied > 0) out.push({ method: v.method, amount: v.finalAmount - applied });
  return out;
}
