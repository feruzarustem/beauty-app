import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/current";
import { friendlyMessage } from "@/lib/actionErrors";
import { fmtDay } from "@/lib/dates";
import { PAYMENT_LABEL } from "@/lib/payment";
import { cancelVisit, completeVisit, moveVisit } from "@/lib/services/appointments";
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
async function doMove(formData: FormData) {
  "use server";
  const admin = await requireUser("admin");
  const id = String(formData.get("id"));
  await run(id, () => moveVisit(admin, id, { date: String(formData.get("date")), time: String(formData.get("time")) }), `/admin/appointments/${id}`);
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
  return (
    <>
      <p><Link href={`/admin/calendar?d=${a.date}`} className="muted">← Календарь</Link></p>
      <h1>{a.clientName ?? "Клиент"}</h1>
      <p className="sub">
        {fmtDay(a.date)} {a.time ?? ""} · {a.masterName} · <span className={a.status === "done" ? "pill paid" : "pill"}>{STATUS[a.status]}</span>
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
        <div className="row"><span>Оплата: {PAYMENT_LABEL[a.paymentMethod]}</span><strong>Итого: {fmt(a.amount)}</strong></div>
        {a.clientPhone && <p className="muted" style={{ marginTop: 8 }}>Телефон: {a.clientPhone}</p>}
        {a.cancelledReason && <p className="muted">Причина отмены: {a.cancelledReason}</p>}
      </div>
      {a.status === "scheduled" && (
        <>
          <h2>Действия</h2>
          <div className="inline-form">
            <form action={doComplete}>
              <input type="hidden" name="id" value={a.id} />
              <button type="submit">Выполнено</button>
            </form>
            <Link href={`/admin/appointments/${a.id}/edit`}><button type="button" className="ghost">Изменить услуги</button></Link>
          </div>
          <h2>Перенести</h2>
          <form action={doMove} className="inline-form">
            <input type="hidden" name="id" value={a.id} />
            <input name="date" type="date" defaultValue={a.date} required />
            <input name="time" type="time" min="08:00" max="19:59" defaultValue={a.time ?? ""} required />
            <button type="submit" className="ghost">Перенести</button>
          </form>
          <h2>Отменить</h2>
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
