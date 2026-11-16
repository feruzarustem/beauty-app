import Link from "next/link";
import { revalidatePath } from "next/cache";
import { fmtDay } from "@/lib/dates";
import { formatPhone } from "@/lib/whatsapp";
import { listClientsWithHistory } from "@/lib/services/clientCard";
import { requireUser } from "@/lib/auth/current";
import { ValidationError } from "@/lib/errors";
import { createClient } from "@/lib/services/clients";
import { listMasters } from "@/lib/services/users";

async function add(formData: FormData) {
  "use server";
  const admin = await requireUser("admin");
  try {
    await createClient(admin, {
      name: String(formData.get("name") ?? ""),
      assignedMasterId: String(formData.get("masterId") ?? ""),
      phone: String(formData.get("phone") ?? ""),
    });
  } catch (e) {
    if (!(e instanceof ValidationError)) throw e;
  }
  revalidatePath("/admin/clients");
}

const FILTERS = [30, 45, 60, 90] as const;

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ inactive?: string }> }) {
  const admin = await requireUser("admin");
  const sp = await searchParams;
  const inactive = FILTERS.find((n) => String(n) === sp.inactive);
  const [masters, clients] = await Promise.all([listMasters(admin), listClientsWithHistory(admin, { inactiveDays: inactive })]);
  return (
    <>
      <h1>Клиенты</h1>
      <p className="sub">Телефоны видны только администратору</p>
      <div className="inline-form" style={{ marginBottom: 16 }}>
        <Link href="/admin/clients"><button type="button" className={inactive ? "ghost" : ""}>Все</button></Link>
        {FILTERS.map((n) => (
          <Link key={n} href={`/admin/clients?inactive=${n}`}>
            <button type="button" className={inactive === n ? "" : "ghost"}>Не были &gt; {n} дн.</button>
          </Link>
        ))}
      </div>
      <p className="muted" style={{ marginBottom: 12 }}>Найдено: {clients.length}</p>
      <ul className="list">
        {clients.map((c) => (
          <li key={c.id} className="card">
            <div className="row">
              <strong><Link href={`/admin/clients/${c.id}`}>{c.name}</Link></strong>
              <span className="muted">мастер: {c.masterName ?? "—"}</span>
            </div>
            <div className="muted" style={{ marginTop: 4 }}>
              {c.phone ? formatPhone(c.phone) : "телефон не указан"} · визитов: {c.totalVisits} ·{" "}
              {c.lastVisit ? `последний: ${fmtDay(c.lastVisit)} (${c.daysSince} дн. назад)` : "ещё не был(а)"}
            </div>
          </li>
        ))}
        {clients.length === 0 && <li className="muted">Никого не найдено</li>}
      </ul>
      <h2>Добавить клиента</h2>
      <form action={add} className="stack">
        <input name="name" placeholder="Имя" required />
        <input name="phone" placeholder="Телефон, например +7 700 123 45 67 (необязательно)" />
        <select name="masterId" required defaultValue="">
          <option value="" disabled>Закреплённый мастер</option>
          {masters.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
        <small className="muted">Сохраняя телефон, вы подтверждаете, что клиент согласен на хранение своих данных. Номер сохраняется в международном формате.</small>
        <button type="submit">Добавить</button>
      </form>
    </>
  );
}
