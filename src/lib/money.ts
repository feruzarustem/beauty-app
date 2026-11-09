export const MAX_AMOUNT = 10_000_000;

export class AmountError extends Error {
  constructor(message = "Сумма должна быть целым числом тенге больше нуля (не более 10 000 000)") {
    super(message);
    this.name = "AmountError";
  }
}

/** Доля мастера в тенге: округление вниз, остаток остаётся салону. */
export function masterShare(amount: number, percent: number): number {
  return Math.floor((amount * percent) / 100);
}

/** Принимает целое число или строку из одних цифр; всё остальное отклоняет. */
export function parseAmount(input: unknown): number {
  let n: number;
  if (typeof input === "number") n = input;
  else if (typeof input === "string" && /^\d+$/.test(input)) n = Number(input);
  else throw new AmountError();
  if (!Number.isInteger(n) || n <= 0 || n > MAX_AMOUNT) throw new AmountError();
  return n;
}
