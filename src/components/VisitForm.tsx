"use client";

import { useMemo, useState } from "react";
import { formatPrice } from "@/lib/price";
import { PAYMENT_LABEL, PAYMENT_METHODS } from "@/lib/payment";

export type FormService = {
  id: string;
  category: string;
  groupName: string;
  name: string;
  priceMin: number;
  priceMax: number | null;
  openEnded: boolean;
  details: string | null;
  kind: "main" | "addon" | "option";
};
export type FormMaster = { id: string; name: string; category: string | null; categoryTitle: string };
type Chosen = { price: number; from: boolean; reason: string };
export type InitialItem = { serviceId: string; price: number; belowMinReason?: string };

const STEP = 1000;
const nf = (n: number) => `${n.toLocaleString("ru-RU")} ₸`;
const isFlexible = (s: FormService) => s.priceMax != null || s.openEnded;

export function VisitForm({
  masters,
  services,
  clients,
  action,
  today,
  initial,
  mode = "create",
  visitId,
}: {
  masters: FormMaster[];
  services: FormService[];
  clients: string[];
  action: (formData: FormData) => void | Promise<void>;
  today: string;
  initial: { masterId?: string; client?: string; method?: string; date?: string; time?: string; status?: string; items?: InitialItem[]; dup?: boolean };
  mode?: "create" | "edit";
  visitId?: string;
}) {
  const [status, setStatus] = useState(initial.status === "scheduled" ? "scheduled" : "done");
  const [masterId, setMasterId] = useState(initial.masterId ?? "");
  const [chosen, setChosen] = useState<Record<string, Chosen>>(() => {
    const m: Record<string, Chosen> = {};
    for (const i of initial.items ?? []) {
      const s = services.find((x) => x.id === i.serviceId);
      if (s) m[s.id] = { price: i.price, from: isFlexible(s) && i.price !== s.priceMin, reason: i.belowMinReason ?? "" };
    }
    return m;
  });
  const master = masters.find((m) => m.id === masterId);
  const list = useMemo(() => services.filter((s) => master && s.category === master.category), [services, master]);
  const groups = [...new Set(list.map((s) => s.groupName))];
  const picked = list.filter((s) => chosen[s.id]);
  const paid = picked.filter((s) => s.kind !== "option");
  const total = paid.reduce((sum, s) => sum + chosen[s.id].price, 0);
  const payload = picked.map((s) => ({ serviceId: s.id, price: chosen[s.id].price, belowMinReason: chosen[s.id].reason }));

  const toggle = (s: FormService) =>
    setChosen((c) => {
      const next = { ...c };
      if (next[s.id]) delete next[s.id];
      else next[s.id] = { price: s.kind === "option" ? 0 : s.priceMin, from: false, reason: "" };
      return next;
    });
  const patch = (id: string, p: Partial<Chosen>) => setChosen((c) => ({ ...c, [id]: { ...c[id], ...p } }));

  return (
    <form action={action} className="stack visit-form">
      <select
        name="masterId"
        value={masterId}
        required
        onChange={(e) => {
          setMasterId(e.target.value);
          setChosen({});
        }}
      >
        <option value="" disabled>Мастер</option>
        {[...new Set(masters.map((m) => m.categoryTitle))].map((t) => (
          <optgroup key={t} label={t}>
            {masters.filter((m) => m.categoryTitle === t).map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </optgroup>
        ))}
      </select>
      <input name="client" list="clients" placeholder="Клиент (имя)" defaultValue={initial.client ?? ""} required />
      <datalist id="clients">
        {clients.map((c, i) => (
          <option key={i} value={c} />
        ))}
      </datalist>

      {master ? (
        groups.map((g) => (
          <fieldset key={g} className="svc-group">
            <legend>{g}</legend>
            {list.filter((s) => s.groupName === g).map((s) => {
              const c = chosen[s.id];
              const flexible = isFlexible(s);
              return (
                <div key={s.id} className={c ? "svc on" : "svc"}>
                  <label className="svc-head">
                    <input type="checkbox" checked={!!c} onChange={() => toggle(s)} />
                    <span className="svc-name">
                      {s.name}
                      {s.kind === "addon" && <em className="tag">доп.</em>}
                      {s.kind === "option" && <em className="tag">параметр</em>}
                    </span>
                    <span className="svc-price">{s.kind === "option" ? "без доплаты" : formatPrice(s)}</span>
                  </label>
                  {c && s.kind !== "option" && (
                    <div className="svc-body">
                      {flexible && (
                        <label className="switch">
                          <input type="checkbox" checked={c.from} onChange={(e) => patch(s.id, { from: e.target.checked, price: e.target.checked ? c.price : s.priceMin, reason: "" })} />
                          <span className="track" aria-hidden="true" />
                          <span>Цена от — выбрать итоговую</span>
                        </label>
                      )}
                      {flexible && c.from ? (
                        <div className="stepper">
                          <button type="button" className="ghost" aria-label="Уменьшить" onClick={() => patch(s.id, { price: Math.max(0, c.price - STEP) })}>−</button>
                          <input
                            inputMode="numeric"
                            aria-label={`Сумма: ${s.name}`}
                            value={c.price}
                            onChange={(e) => patch(s.id, { price: Number(e.target.value.replace(/\D/g, "")) || 0 })}
                          />
                          <button type="button" className="ghost" aria-label="Увеличить" onClick={() => patch(s.id, { price: c.price + STEP })}>+</button>
                          <span className="muted">от {nf(s.priceMin)}</span>
                        </div>
                      ) : (
                        <div className="muted">Сумма: {nf(c.price)}</div>
                      )}
                      {c.price < s.priceMin && (
                        <input
                          placeholder="Причина, почему ниже минимума"
                          value={c.reason}
                          onChange={(e) => patch(s.id, { reason: e.target.value })}
                          required
                        />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </fieldset>
        ))
      ) : (
        <p className="muted">Выберите мастера, чтобы открыть его прайс-лист</p>
      )}

      <div className="card total">
        <div className="label">Итого к оплате</div>
        {paid.length === 0 && <p className="muted">Услуги не выбраны</p>}
        {picked.map((s) => (
          <div key={s.id} className="row total-row">
            <span>{s.name}</span>
            <span>{s.kind === "option" ? "параметр" : nf(chosen[s.id].price)}</span>
          </div>
        ))}
        <hr className="divider" />
        <div className="row">
          <strong>Общая сумма</strong>
          <strong className="total-sum">{nf(total)}</strong>
        </div>
      </div>

      <input type="hidden" name="items" value={JSON.stringify(payload)} />
      {visitId && <input type="hidden" name="id" value={visitId} />}
      <select name="method" defaultValue={initial.method ?? "cash"} aria-label="Способ оплаты">
        {PAYMENT_METHODS.map((m) => (
          <option key={m} value={m}>{PAYMENT_LABEL[m]}</option>
        ))}
      </select>
      {mode === "create" && (
        <>
          <select name="status" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Тип записи">
            <option value="done">Уже выполнена (оплачена)</option>
            <option value="scheduled">Запись на будущее</option>
          </select>
          <input name="date" type="date" defaultValue={initial.date ?? today} required />
          <input name="startTime" type="time" min="08:00" max="19:59" defaultValue={initial.time ?? ""} required={status === "scheduled"} aria-label="Время начала" />
        </>
      )}
      {initial.dup && (
        <label>
          <input type="checkbox" name="confirmDuplicate" /> Это другой визит
        </label>
      )}
      <button type="submit" disabled={paid.length === 0}>{mode === "edit" ? "Сохранить изменения" : "Сохранить"}</button>
    </form>
  );
}
