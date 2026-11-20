import { ValidationError } from "@/lib/errors";

/**
 * Номер в международном формате. Казахстан и Россия (+7): 8… и 10 цифр приводятся к +7XXXXXXXXXX.
 * Другие страны — только с «+» и кодом страны (8–15 цифр).
 */
export function normalizePhone(raw: string): string {
  const input = String(raw ?? "").trim();
  if (!/^\+?[\d\s\-()]+$/.test(input)) throw new ValidationError("Неверный номер телефона");
  const digits = input.replace(/\D/g, "");
  const hasPlus = input.startsWith("+");
  let e164: string | null = null;
  if (digits.length === 10 && !hasPlus) e164 = `+7${digits}`;
  else if (digits.length === 11 && (digits[0] === "7" || digits[0] === "8")) e164 = `+7${digits.slice(1)}`;
  else if (hasPlus && digits[0] !== "7" && digits.length >= 8 && digits.length <= 15) e164 = `+${digits}`;
  if (!e164) throw new ValidationError("Укажите номер в международном формате, например +7 700 123 45 67");
  return e164;
}

/** +77001234567 → «+7 700 123 45 67» (для экрана). Другие страны — как есть. */
export function formatPhone(e164: string): string {
  const m = /^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/.exec(e164);
  return m ? `+7 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : e164;
}

/** Ссылка, которая открывает чат WhatsApp с готовым редактируемым текстом. Сообщение отправляет человек вручную. */
export function waLink(phone: string, text: string): string | null {
  try {
    return `https://wa.me/${normalizePhone(phone).slice(1)}?text=${encodeURIComponent(text)}`;
  } catch {
    return null;
  }
}

const ruDate = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

export function confirmText(a: { name: string; date: string; time: string; master: string }): string {
  return `Здравствуйте, ${a.name}! Вы записаны в салон Lash Golden на ${ruDate(a.date)} в ${a.time} к мастеру ${a.master}.\n\nПодтвердите, пожалуйста, вашу запись. Будем ждать вас! ❤️`;
}

export function rebookText(a: { name: string; service: string; master: string }): string {
  return `Здравствуйте, ${a.name}! ❤️ Давно вас не видели в Lash Golden. Хотели бы пригласить вас на повторную процедуру. Можем подобрать удобное время для ${a.service} к мастеру ${a.master}. Будем рады вас видеть!`;
}
