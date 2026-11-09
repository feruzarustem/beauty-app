"use client";

import { useState } from "react";
import { formatPrice } from "@/lib/price";

export type ServiceOption = {
  id: string;
  label: string; // группа, например «Наращивание»
  name: string;
  priceMin: number;
  priceMax: number | null;
  openEnded: boolean;
};

/** Выбор услуги только подставляет цену; итоговую сумму всегда вводят вручную. Услуга не сохраняется. */
export function ServiceAmount({ services, defaultAmount }: { services: ServiceOption[]; defaultAmount?: string }) {
  const [amount, setAmount] = useState(defaultAmount ?? "");
  const [hint, setHint] = useState<string | null>(null);
  const groups = [...new Set(services.map((s) => s.label))];
  return (
    <>
      <select
        defaultValue=""
        aria-label="Услуга (подставит цену)"
        onChange={(e) => {
          const s = services.find((x) => x.id === e.target.value);
          if (s) {
            setAmount(String(s.priceMin));
            setHint(s.priceMax != null || s.openEnded ? `Цена по прайсу: ${formatPrice(s)}. Укажите итоговую сумму.` : null);
          } else setHint(null);
        }}
      >
        <option value="">Услуга (необязательно, подставит цену)</option>
        {groups.map((g) => (
          <optgroup key={g} label={g}>
            {services
              .filter((s) => s.label === g)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} — {formatPrice(s)}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
      <input
        name="amount"
        inputMode="numeric"
        placeholder="Итоговая сумма, ₸"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        required
      />
      {hint && <small className="muted">{hint}</small>}
    </>
  );
}
