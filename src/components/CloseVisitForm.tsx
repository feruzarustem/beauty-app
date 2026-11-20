"use client";

import { useMemo, useState } from "react";
import { PAYMENT_LABEL, PAYMENT_METHODS, PREPAY_METHODS } from "@/lib/payment";
import { PREPAY_AMOUNT, computeSplit, type DiscountBearer } from "@/lib/split";

const nf = (n: number) => `${n.toLocaleString("ru-RU")} ₸`;
const QUICK = [0, 10, 20, 30, 40, 50, 100];
const BEARERS: { v: DiscountBearer; label: string }[] = [
  { v: "master", label: "Мастер" },
  { v: "salon", label: "Салон" },
  { v: "shared", label: "Пополам 50/50" },
];

/** Закрытие записи: скидка, «Блогер / Реклама», способ оплаты остатка. Расчёт на экране = расчёт на сервере (одна формула). */
export function CloseVisitForm({
  visitId,
  listAmount,
  masterPercent,
  initial,
  action,
  submitLabel = "Закрыть запись",
}: {
  visitId: string;
  listAmount: number;
  masterPercent: number;
  initial: { percent: number; reason: string; bearer: DiscountBearer | null; blogger: boolean; method: string; prepaid: boolean; prepaidMethod: string };
  action: (formData: FormData) => void | Promise<void>;
  submitLabel?: string;
}) {
  const [percent, setPercent] = useState(String(initial.percent));
  const [reason, setReason] = useState(initial.reason);
  const [bearer, setBearer] = useState<DiscountBearer | "">(initial.bearer ?? "");
  const [blogger, setBlogger] = useState(initial.blogger);
  const [prepaid, setPrepaid] = useState(initial.prepaid);
  const [ack, setAck] = useState(false);

  const d = blogger ? 0 : Number(percent || "0");
  const calc = useMemo(() => {
    try {
      return {
        r: computeSplit({
          listAmount,
          discountPercent: d,
          bearer: d > 0 && bearer ? bearer : null,
          blogger,
          prepaid: prepaid ? PREPAY_AMOUNT : 0,
          masterPercent: blogger ? 100 : masterPercent,
        }),
        error: null as string | null,
      };
    } catch (e) {
      return { r: null, error: e instanceof Error ? e.message : "Проверьте данные" };
    }
  }, [listAmount, d, bearer, blogger, prepaid, masterPercent]);
  const r = calc.r;
  const needReason = d > 0 && reason.trim().length < 3;
  const blocked = !r || needReason || (r.warning !== null && !ack);

  return (
    <form action={action} className="stack close-form">
      <input type="hidden" name="id" value={visitId} />
      <label className="switch">
        <input type="checkbox" name="isBlogger" checked={blogger} onChange={(e) => { setBlogger(e.target.checked); if (e.target.checked) setPercent("0"); }} />
        <span className="track" aria-hidden="true" />
        <span>Блогер / Реклама (мастер получает 100%, салон 0)</span>
      </label>

      <fieldset className="svc-group" disabled={blogger}>
        <legend>Скидка</legend>
        <div className="inline-form" role="group" aria-label="Скидка, %">
          {QUICK.map((q) => (
            <button type="button" key={q} className={Number(percent) === q ? "" : "ghost"} onClick={() => setPercent(String(q))}>
              {q === 0 ? "Нет" : `${q}%`}
            </button>
          ))}
          <input inputMode="numeric" aria-label="Скидка, произвольный процент" placeholder="% другое" value={percent} onChange={(e) => setPercent(e.target.value.replace(/\D/g, ""))} style={{ width: 110 }} />
        </div>
        <input type="hidden" name="discountPercent" value={d} />
        {d > 0 && (
          <>
            <input name="discountReason" placeholder="Причина скидки (обязательно)" value={reason} onChange={(e) => setReason(e.target.value)} required style={{ marginTop: 10, width: "100%" }} />
            <div className="inline-form" style={{ marginTop: 10 }} role="radiogroup" aria-label="За чей счёт скидка">
              {BEARERS.map((b) => (
                <label key={b.v} className="radio">
                  <input type="radio" name="discountBearer" value={b.v} checked={bearer === b.v} onChange={() => setBearer(b.v)} required /> {b.label}
                </label>
              ))}
            </div>
          </>
        )}
      </fieldset>

      <label className="prepay">
        <input type="checkbox" name="prepaid" checked={prepaid} onChange={(e) => setPrepaid(e.target.checked)} />
        <span>Предоплата {PREPAY_AMOUNT.toLocaleString("ru-RU")} ₸ получена</span>
      </label>
      {prepaid && (
        <select name="prepaidMethod" defaultValue={initial.prepaidMethod} aria-label="Способ предоплаты (только безналичный)">
          {PREPAY_METHODS.map((m) => (
            <option key={m} value={m}>{PAYMENT_LABEL[m]}</option>
          ))}
        </select>
      )}
      <select name="paymentMethod" defaultValue={initial.method} aria-label="Способ оплаты остатка">
        {PAYMENT_METHODS.map((m) => (
          <option key={m} value={m}>Остаток: {PAYMENT_LABEL[m]}</option>
        ))}
      </select>

      <div className="card total">
        <div className="label">Расчёт</div>
        {calc.error && <p className="alert">{calc.error}</p>}
        {r && (
          <>
            <div className="row total-row"><span>Полная стоимость</span><span>{nf(listAmount)}</span></div>
            {r.discountAmount > 0 && <div className="row total-row"><span>Скидка {d}%{reason.trim() ? ` — ${reason.trim()}` : ""}</span><span>−{nf(r.discountAmount)}</span></div>}
            <div className="row total-row"><span>Итоговая стоимость</span><strong>{nf(r.finalAmount)}</strong></div>
            {prepaid && <div className="row total-row"><span>Предоплата (входит в стоимость)</span><span>−{nf(Math.min(PREPAY_AMOUNT, r.finalAmount))}</span></div>}
            <hr className="divider" />
            <div className="row"><strong>Остаток к оплате</strong><strong className="total-sum">{nf(r.remainder)}</strong></div>
            {r.refund > 0 && <p className="muted">Возврат клиенту излишней предоплаты: {nf(r.refund)}</p>}
            <hr className="divider" />
            <div className="row total-row"><span>Заработок мастера ({blogger ? 100 : masterPercent}%)</span><span>{nf(r.master)}</span></div>
            <div className="row total-row"><span>Доход салона</span><span>{nf(r.salon)}</span></div>
            {r.warning && (
              <div className="alert" role="alert" style={{ marginTop: 10 }}>
                <b>Внимание:</b> {r.warning}
                <label style={{ display: "block", marginTop: 8 }}>
                  <input type="checkbox" name="acknowledgeWarning" checked={ack} onChange={(e) => setAck(e.target.checked)} /> Понимаю, сохранить с таким расчётом
                </label>
              </div>
            )}
          </>
        )}
      </div>
      <button type="submit" disabled={blocked}>{submitLabel}</button>
    </form>
  );
}
