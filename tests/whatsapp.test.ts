import { describe, expect, test } from "vitest";
import { ValidationError } from "@/lib/errors";
import { confirmText, formatPhone, normalizePhone, rebookText, waLink } from "@/lib/whatsapp";

describe("normalizePhone: international format", () => {
  test("Kazakhstan numbers in any common spelling become +7XXXXXXXXXX", () => {
    for (const raw of ["+7 700 123 45 67", "8 (700) 123-45-67", "87001234567", "7001234567", "+77001234567", " 7 700 123 4567 "]) {
      expect(normalizePhone(raw)).toBe("+77001234567");
    }
  });
  test("other countries keep their own code; junk and too short are rejected", () => {
    expect(normalizePhone("+380 50 123 45 67")).toBe("+380501234567");
    for (const bad of ["abc", "", "12345", "+1", "700 123", "+7 700 123 45 6", "123456789012345678"]) {
      expect(() => normalizePhone(bad)).toThrow(ValidationError);
    }
  });
  test("formatPhone shows +7 700 123 45 67", () => {
    expect(formatPhone("+77001234567")).toBe("+7 700 123 45 67");
    expect(formatPhone("+380501234567")).toBe("+380501234567");
  });
});

describe("WhatsApp links and agreed texts", () => {
  test("the confirmation text is filled from the appointment", () => {
    expect(confirmText({ name: "Айгуль", date: "2026-11-17", time: "14:30", master: "Дана" })).toBe(
      "Здравствуйте, Айгуль! Вы записаны в салон Lash Golden на 17.11.2026 в 14:30 к мастеру Дана.\n\nПодтвердите, пожалуйста, вашу запись. Будем ждать вас! ❤️",
    );
  });
  test("the rebooking text names the last service and master", () => {
    expect(rebookText({ name: "Айгуль", service: "Классическое наращивание", master: "Дана" })).toBe(
      "Здравствуйте, Айгуль! ❤️ Давно вас не видели в Lash Golden. Хотели бы пригласить вас на повторную процедуру. Можем подобрать удобное время для Классическое наращивание к мастеру Дана. Будем рады вас видеть!",
    );
  });
  test("waLink opens a chat with the digits of the number and an editable, URL-encoded text; nothing is sent automatically", () => {
    const text = "Здравствуйте, Айгуль! ❤️ & да";
    const url = waLink("+7 700 123 45 67", text) as string;
    expect(url.startsWith("https://wa.me/77001234567?text=")).toBe(true);
    expect(decodeURIComponent(url.split("?text=")[1])).toBe(text);
    expect(url).not.toMatch(/api\.whatsapp|send/);
  });
  test("a legacy-formatted stored number still works; an unusable number gives no link", () => {
    expect(waLink("8 700 123 45 67", "x")).toContain("wa.me/77001234567");
    expect(waLink("abc", "x")).toBeNull();
  });
});
