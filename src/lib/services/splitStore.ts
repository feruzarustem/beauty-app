import type { DiscountBearer, MasterCategory, PaymentMethod } from "@prisma/client";
import { computeSplit, type SplitResult } from "@/lib/split";
import { getSharePercent } from "./settings";

export type MoneyFields = {
  listAmount: number;
  discountPercent: number;
  discountBearer: DiscountBearer | null;
  isBlogger: boolean;
  prepaidAmount: number;
  prepaidMethod?: PaymentMethod | null;
};

/** Считает деньги записи и возвращает поля для сохранения (итог, скидка, доли). Единственное место, где формула применяется к записи. */
export async function splitData(m: MoneyFields, masterCategory: MasterCategory | null): Promise<{ result: SplitResult; data: Record<string, unknown> }> {
  const pct = await getSharePercent(masterCategory);
  const result = computeSplit({
    listAmount: m.listAmount,
    discountPercent: m.discountPercent,
    bearer: m.discountBearer,
    blogger: m.isBlogger,
    prepaid: m.prepaidAmount,
    masterPercent: m.isBlogger ? 100 : pct,
  });
  return {
    result,
    data: {
      amount: result.finalAmount,
      listAmount: m.listAmount,
      discountAmount: result.discountAmount,
      masterAmount: result.master,
      salonAmount: result.salon,
      splitPercent: m.isBlogger ? 100 : pct,
      splitWarning: result.warning,
    },
  };
}
