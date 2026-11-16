import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/current";
import { friendlyMessage } from "@/lib/actionErrors";
import { fmtDay } from "@/lib/dates";
import { CloseVisitForm } from "@/components/CloseVisitForm";
import { cancelVisit, closeVisit, completeVisit, moveVisit } from "@/lib/services/appointments";
import { confirmText, waLink } from "@/lib/whatsapp";
import { getSharePercent } from "@/lib/services/settings";
import { PAYMENT_LABEL, parsePayment, parsePrepayMethod } from "@/lib/payment";
import type { DiscountBearer } from "@prisma/client";
import { getAppointment } from "@/lib/services/calendar";

const fmt = (n: number) => `${n.toLocaleString("ru-RU")} ₸`;
const STATUS = { scheduled: "запланирована", done: "выполнена", cancelled: "отменена" } as const;

async function run(id: string, fn: () => Promise<void>, back: string) {
  try {
    await fn();
  } catch (e) {
    const msg = friendlyMessage(e);
    if (!msg) throw e;
    redirect(`/admin/appointments/${id}?error=${encodeURIComponent(msg)}`);
  }
  redirect(back);
}

async function doComplete(formData: FormData) {
  "use server";
  const admin = await requireUser("admin");
  const id = String(formData.get("id"));
  await run(id, () => completeVisit(admin, id), `/admin/appointments/${id}`);
}
async function doCancel(formData: FormData) {
  "use server";
  const admin = await requireUser("admin");
  const id = String(formData.get("id"));
  await run(id, () => cancelVisit(admin, id, String(formData.get("reason") ?? "")), `/admin/appointments/${id}`);
}
async function doClose(formData: FormData) {
  "use server";
  const admin = await requireUser("admin");
  const id = String(formData.get("id"));
  const f = (k: string) => String(formData.get(k) ?? "");
  const bearer = f("discountBearer");
  await run(
    id,
    async () => {
      await closeVisit(admin, id, {
        discountPercent: f("discountPercent") || "0",
        discountReason: f("discountReason"),
        discountBearer: bearer === "master" || bearer === "salon" || bearer === "shared" ? (bearer as DiscountBearer) : null,
        isBlogger: formData.get("isBlogger") === "on",
        paymentMethod: parsePayment(f("paymentMethod")),
        prepaid: formData.get("prepaid") === "on",
        prepaidMethod: parsePrepayMethod(f("prepaidMethod")),
        acknowledgeWarning: formData.get("acknowledgeWarning") === "on",
      });
    },
    `/admin/appointments/${id}`,
  );
}

async function doMove(formData: FormData) {
  "use server";
  const admin = await requireUser("admin");
  const id = String(formData.get("id"));
  await run(id, () => moveVisit(admin, id, { date: String(formData.get("date")), time: String(formData.get("time")), durationMin: String(formData.get("durationMin") ?? "") || undefined }), `/admin/appointments/${id}`);
}

export default async function AppointmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const admin = await requireUser("admin");
  const { id } = await params;
  const sp = await searchParams;
  const a = await getAppointment(admin, id);
  if (!a) notFound();
  const masterPercent = await getSharePercent((a.masterCategory as never) ?? null);
  const isDone = a.status === "done";
  const wa = a.status === "scheduled" && a.clientPhone && a.time ? waLink(a.clientPhone, confirmText({ name: a.clientName ?? "", date: a.date, time: a.time, master: a.masterName })) : null;
  const bearerLabel = { master: "мастер", salon: "салон", shared: "пополам 50/50" } as const;
  return (
    <>
      <p><Link href={`/admin/calendar?d=${a.date}`} className="muted">← Календарь</Link></p>
      <h1>{a.clientName ?? "Клиент"}</h1>
      <p className="sub">
        {fmtDay(a.date)} {a.time ?? ""}{a.durationMin ? ` · ${a.durationMin} мин` : ""} · {a.masterName} ·{" "}
        <span className={isDone ? "pill paid" : "pill"}>{STATUS[a.status]}</span>{" "}
        <span className={a.prepaidAmount > 0 ? "pill badge-prepaid" : "pill badge-noprepay"}>
          {a.prepaidAmount > 0 ? `предоплата ${fmt(a.prepaidAmount)} получена${a.prepaidMethod ? ` (${PAYMENT_LABEL[a.prepaidMethod]})` : ""}` : "без предоплаты"}
        </span>
        {a.isBlogger && <> <span className="pill">Блогер / Реклама</span></>}
      </p>
      {sp.error && <p role="alert" className="alert">{sp.error}</p>}
      <div className="card">
        <table>
          <thead><tr><th>Услуга</th><th className="num">Сумма</th></tr></thead>
          <tbody>
            {a.items.map((i) => (
              <tr key={i.id}>
                <td>{i.name}{i.belowMinReason && <div className="muted" style={{ fontSize: "0.85rem" }}>ниже минимума ({fmt(i.priceMin)}): {i.belowMinReason}</div>}</td>
                <td className="num">{fmt(i.price)}</td>
              </tr>
            ))}
            {a.items.length === 0 && <tr><td colSpan={2} className="muted">Услуги не указаны (старая запись)</td></tr>}
          </tbody>
        </table>
        <hr className="divider" />
        <div className="row total-row"><span>Полная стоимость</span><span>{fmt(a.listAmount)}</span></div>
        {a.discountPercent > 0 && (
          <div className="row total-row">
            <span>Скидка {a.discountPercent}% (за счёт: {a.discountBearer ? bearerLabel[a.discountBearer as keyof typeof bearerLabel] : "—"})</span>
            <span>−{fmt(a.discountAmount)}</span>
          </div>
        )}
        {a.discountReason && <div className="muted" style={{ fontSize: "0.85rem" }}>Причина скидки: {a.discountReason}</div>}
        <div className="row total-row"><strong>Итоговая стоимость</strong><strong>{fmt(a.amount)}</strong></div>
        {a.prepaidAmount > 0 && <div className="row total-row"><span>Предоплата (входит в стоимость)</span><span>{fmt(Math.min(a.prepaidAmount, a.amount))}</span></div>}
        <div className="row total-row"><span>Остаток к оплате ({PAYMENT_LABEL[a.paymentMethod]})</span><span>{fmt(Math.max(0, a.amount - a.prepaidAmount))}</span></div>
        {isDone && a.masterAmount !== null && (
          <>
            <hr className="divider" />
            <div className="row total-row"><span>Заработок мастера</span><span>{fmt(a.masterAmount)}</span></div>
            <div className="row total-row"><span>Доход салона</span><span>{fmt(a.salonAmount ?? 0)}</span></div>
          </>
        )}
        {a.splitWarning && <p className="alert">{a.splitWarning}</p>}
        {a.clientPhone && <p className="muted" style={{ marginTop: 8 }}>Телефон: {a.clientPhone}</p>}
        {a.cancelledReason && <p className="muted">Причина отмены: {a.cancelledReason}{a.prepaidAmount > 0 ? `. Предоплата ${fmt(a.prepaidAmount)} остаётся салону.` : ""}</p>}
      </div>

      {wa && (
        <p style={{ marginTop: 16 }}>
          <a href={wa} target="_blank" rel="noopener noreferrer"><button type="button">Написать в WhatsApp: подтвердить запись</button></a>
        </p>
      )}

      {a.status !== "cancelled" && (
        <>
          <h2>{isDone ? "Изменить оплату или скидку" : "Закрыть запись"}</h2>
          <p className="sub">{isDone ? "Пока день не закрыт и период не выплачен. Изменение попадёт в журнал." : "Скидка, способ оплаты и расчёт. Запись станет выполненной."}</p>
          <CloseVisitForm
            visitId={a.id}
            listAmount={a.listAmount}
            masterPercent={masterPercent}
            action={doClose}
            submitLabel={isDone ? "Сохранить" : "Закрыть запись"}
            initial={{
              percent: a.discountPercent,
              reason: a.discountReason ?? "",
              bearer: (a.discountBearer as DiscountBearer | null) ?? null,
              blogger: a.isBlogger,
              method: a.paymentMethod,
              prepaid: a.prepaidAmount > 0,
              prepaidMethod: a.prepaidMethod ?? "transfer",
            }}
          />
        </>
      )}
      {a.status === "scheduled" && (
        <>
          <h2>Другие действия</h2>
          <div className="inline-form">
            <form action={doComplete}>
              <input type="hidden" name="id" value={a.id} />
              <button type="submit" className="ghost">Только отметить «Выполнено»</button>
            </form>
            <Link href={`/admin/appointments/${a.id}/edit`}><button type="button" className="ghost">Изменить услуги</button></Link>
          </div>
          <h2>Перенести</h2>
          <form action={doMove} className="inline-form">
            <input type="hidden" name="id" value={a.id} />
            <input name="date" type="date" defaultValue={a.date} required />
            <input name="time" type="time" min="08:00" max="22:59" defaultValue={a.time ?? ""} required />
            <input name="durationMin" inputMode="numeric" placeholder="Минут" defaultValue={a.durationMin ?? ""} style={{ width: 100 }} aria-label="Длительность в минутах" />
            <button type="submit" className="ghost">Перенести</button>
          </form>
          <h2>Отменить</h2>
          {a.prepaidAmount > 0 && <p className="sub">Предоплата {fmt(a.prepaidAmount)} при отмене клиенту не возвращается и остаётся салону.</p>}
          <form action={doCancel} className="inline-form">
            <input type="hidden" name="id" value={a.id} />
            <input name="reason" placeholder="Причина отмены" required />
            <button type="submit" className="danger">Отменить запись</button>
          </form>
        </>
      )}
    </>
  );
}
