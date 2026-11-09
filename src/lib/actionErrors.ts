import { DayClosedError, DuplicateWarning, NotFoundError, PeriodPaidError, ValidationError } from "@/lib/errors";
import { AmountError } from "@/lib/money";

/** Ожидаемые ошибки пользователя → текст для экрана; остальное (баги) пробрасывается. */
export function friendlyMessage(e: unknown): string | null {
  if (e instanceof ValidationError || e instanceof AmountError || e instanceof DayClosedError || e instanceof PeriodPaidError) return e.message;
  if (e instanceof DuplicateWarning) return e.message;
  if (e instanceof NotFoundError) return "Не найдено";
  return null;
}
