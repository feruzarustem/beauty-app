import Link from "next/link";
import { masterEarnings, masterVisits } from "@/lib/access/master";
import { requireUser } from "@/lib/auth/current";
import { periodFor, shiftPeriod, todayInBusinessTz } from "@/lib/periods";

const fmt = (n: number) => `${n.toLocaleString("ru-RU")} ₸`;

export default async function MasterHome({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const me = await requireUser("master");
  const sp = await searchParams;
  const period = periodFor(sp.p ?? todayInBusinessTz(new Date()));
  const [visits, earn] = await Promise.all([masterVisits(me, period), masterEarnings(me, period)]);
  const prev = shiftPeriod(period, -1);
  const next = shiftPeriod(period, 1);
  return (
    <>
      <header className="topbar-solo">
        <span className="script">Lash Golden</span>
      </header>
      <main className="content" style={{ margin: "0 auto" }}>
        <h1>Мои визиты</h1>
        <div className="period">
          <Link href={`/master?p=${prev.start}`} aria-label="Предыдущий период">←</Link>
          <strong>{period.start} — {period.end}</strong>
          <Link href={`/master?p=${next.start}`} aria-label="Следующий период">→</Link>
        </div>
        <div className="card stat" style={{ marginBottom: 20 }}>
          <div className="label">Мой заработок за период</div>
          <div className="value">{fmt(earn.final)}</div>
          <span className={earn.status === "paid" ? "pill paid" : "pill"}>
            {earn.status === "paid" ? "выплачено" : "ожидает выплаты"}
          </span>
          {earn.adjustment !== 0 && <p className="muted">В том числе корректировка: {fmt(earn.adjustment)}</p>}
        </div>
        <div className="card">
          <table>
            <thead>
              <tr><th>Дата</th><th>Клиент</th><th className="num">Сумма</th><th className="num">Мне</th></tr>
            </thead>
            <tbody>
              {visits.map((v) => (
                <tr key={v.id}>
                  <td>{v.visitDate}</td>
                  <td>{v.clientName ?? "—"}</td>
                  <td className="num">{fmt(v.amount)}</td>
                  <td className="num">{fmt(v.myShare)}</td>
                </tr>
              ))}
              {visits.length === 0 && (
                <tr><td colSpan={4} className="muted">В этом периоде визитов нет</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <form method="POST" action="/api/auth/logout" style={{ marginTop: 24 }}>
          <button type="submit" className="ghost">Выйти</button>
        </form>
      </main>
    </>
  );
}
