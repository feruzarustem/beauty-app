import Link from "next/link";
import { requireUser } from "@/lib/auth/current";
import { todayInBusinessTz } from "@/lib/periods";
import { listVisitsForDay } from "@/lib/services/visits";

const fmt = (n: number) => `${n.toLocaleString("ru-RU")} ₸`;

export default async function AdminHome() {
  const admin = await requireUser("admin");
  const today = todayInBusinessTz(new Date());
  const visits = await listVisitsForDay(admin, today);
  const total = visits.reduce((s, v) => s + v.amount, 0);
  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: 16 }}>
      <h1>Сегодня, {today}</h1>
      <p>
        Визитов: {visits.length} · Выручка: <strong>{fmt(total)}</strong>
      </p>
      <nav style={{ display: "flex", gap: 12, flexWrap: "wrap", margin: "12px 0" }}>
        <Link href="/admin/visits/new">+ Добавить визит</Link>
        <Link href="/admin/payroll">Зарплата</Link>
        <Link href="/admin/clients">Клиенты</Link>
        <Link href="/admin/staff">Сотрудники</Link>
      </nav>
      <ul style={{ padding: 0, listStyle: "none", display: "grid", gap: 8 }}>
        {visits.map((v) => (
          <li key={v.id}>
            {v.masterName} · {v.clientName ?? "—"} · {fmt(v.amount)} · {v.paymentMethod === "cash" ? "наличные" : "перевод"}
          </li>
        ))}
      </ul>
      <form method="POST" action="/api/auth/logout">
        <button type="submit">Выйти</button>
      </form>
    </main>
  );
}
