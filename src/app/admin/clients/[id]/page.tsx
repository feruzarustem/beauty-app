import Link from "next/link";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/current";
import { fmtDay } from "@/lib/dates";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { deleteClient, updateClientContact } from "@/lib/services/clients";
import { getClientCard } from "@/lib/services/clientCard";
import { confirmText, formatPhone, rebookText, waLink } from "@/lib/whatsapp";
import { redirect } from "next/navigation";

const fmt = (n: number) => `${n.toLocaleString("ru-RU")} ₸`;

async function savePhone(formData: FormData) {
  "use server";
  const admin = await requireUser("admin");
  const id = String(formData.get("id"));
  try {
    await updateClientContact(admin, id, String(formData.get("phone") ?? ""));
  } catch (e) {
    if (e instanceof ValidationError) redirect(`/admin/clients/${id}?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  revalidatePath(`/admin/clients/${id}`);
  redirect(`/admin/clients/${id}`);
}

async function remove(formData: FormData) {
  "use server";
  const admin = await requireUser("admin");
  await deleteClient(admin, String(formData.get("id")));
  redirect("/admin/clients");
}

export default async function ClientPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const admin = await requireUser("admin");
  const { id } = await params;
  const sp = await searchParams;
  let c;
  try {
    c = await getClientCard(admin, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const next = c.nextAppointment;
  const confirmLink =
    c.phone && next && next.time ? waLink(c.phone, confirmText({ name: c.name, date: next.date, time: next.time, master: next.masterName })) : null;
  const rebookLink =
    c.phone && c.lastVisit
      ? waLink(c.phone, rebookText({ name: c.name, service: c.lastService ?? "процедуры", master: c.lastMasterName ?? c.masterName ?? "вашему мастеру" }))
      : null;
  return (
    <>
      <p><Link href="/admin/clients" className="muted">← Все клиенты</Link></p>
      <h1>{c.name}</h1>
      <p className="sub">{c.phone ? formatPhone(c.phone) : "телефон не указан"} · мастер: {c.masterName ?? "—"}</p>
      {sp.error && <p role="alert" className="alert">{sp.error}</p>}

      <div className="stats">
        <div className="card stat"><div className="label">Последнее посещение</div><div className="value" style={{ fontSize: "1.2rem" }}>{c.lastVisit ? fmtDay(c.lastVisit) : "—"}</div></div>
        <div className="card stat"><div className="label">Дней прошло</div><div className="value">{c.daysSince ?? "—"}</div></div>
        <div className="card stat"><div className="label">Всего посещений</div><div className="value">{c.totalVisits}</div></div>
      </div>

      <h2>Написать в WhatsApp</h2>
      <p className="sub">Откроется чат с готовым текстом. Вы читаете, при необходимости правите и отправляете сами. Автоматической отправки нет.</p>
      <div className="inline-form">
        {confirmLink ? <a href={confirmLink} target="_blank" rel="noopener noreferrer"><button type="button">Написать в WhatsApp: подтвердить запись</button></a> : <button type="button" disabled>Подтвердить запись</button>}
        {rebookLink ? <a href={rebookLink} target="_blank" rel="noopener noreferrer"><button type="button" className="ghost">Пригласить на повторную запись</button></a> : <button type="button" className="ghost" disabled>Пригласить на повторную запись</button>}
      </div>
      <p className="muted" style={{ marginTop: 6 }}>
        {!c.phone ? "Нет номера телефона." : !next ? "Подтверждение недоступно: нет предстоящей записи." : !c.lastVisit ? "Приглашение недоступно: у клиента ещё не было посещений." : ""}
      </p>

      <h2>Следующая запись</h2>
      {next ? (
        <Link href={`/admin/appointments/${next.id}`} className="card" style={{ display: "block" }}>
          {fmtDay(next.date)} {next.time} · {next.masterName}
          <div className="muted">{next.services.join(", ") || "услуги не указаны"}</div>
        </Link>
      ) : (
        <p className="muted">Предстоящих записей нет</p>
      )}

      <h2>История процедур</h2>
      <div className="card cal-scroll">
        <table>
          <thead><tr><th>Дата</th><th>Мастер</th><th>Услуги</th><th className="num">Сумма</th></tr></thead>
          <tbody>
            {c.history.map((h) => (
              <tr key={h.id}>
                <td><Link href={`/admin/appointments/${h.id}`}>{fmtDay(h.date)}</Link></td>
                <td>{h.masterName}</td>
                <td>{h.services.join(", ") || "—"}</td>
                <td className="num">{fmt(h.amount)}</td>
              </tr>
            ))}
            {c.history.length === 0 && <tr><td colSpan={4} className="muted">Посещений пока нет</td></tr>}
          </tbody>
        </table>
      </div>

      <h2>Контакты</h2>
      <form action={savePhone} className="inline-form">
        <input type="hidden" name="id" value={c.id} />
        <input name="phone" defaultValue={c.phone ?? ""} placeholder="+7 700 123 45 67" />
        <button type="submit" className="ghost">Сохранить номер</button>
      </form>
      <form action={remove} style={{ marginTop: 16 }}>
        <input type="hidden" name="id" value={c.id} />
        <button type="submit" className="danger">Удалить клиента и контакты</button>
      </form>
    </>
  );
}
