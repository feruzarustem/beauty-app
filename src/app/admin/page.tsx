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
    <>
      <h1>Сегодня</h1>
      <p className="sub">{today}</p>
      <div className="stats">
        <div className="card stat">
          <div className="label">Визитов</div>
          <div className="value">{visits.length}</div>
        </div>
        <div className="card stat">
          <div className="label">Выручка</div>
          <div className="value">{fmt(total)}</div>
        </div>
      </div>
      <p>
        <Link href="/admin/visits/new"><button type="button">+ Добавить визит</button></Link>
      </p>
      <h2>Визиты дня</h2>
      <div className="card">
        <table>
          <thead>
            <tr><th>Мастер</th><th>Клиент</th><th>Оплата</th><th className="num">Сумма</th></tr>
          </thead>
          <tbody>
            {visits.map((v) => (
              <tr key={v.id}>
                <td>{v.masterName}</td>
                <td>{v.clientName ?? "—"}</td>
                <td>{v.paymentMethod === "cash" ? "наличные" : "перевод"}</td>
                <td className="num">{fmt(v.amount)}</td>
              </tr>
            ))}
            {visits.length === 0 && (
              <tr><td colSpan={4} className="muted">Сегодня визитов пока нет</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
