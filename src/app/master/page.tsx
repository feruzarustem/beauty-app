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
    <main style={{ maxWidth: 480, margin: "0 auto", padding: 16 }}>
      <h1>Мои визиты</h1>
      <p style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <Link href={`/master?p=${prev.start}`}>←</Link>
        <strong>{period.start} — {period.end}</strong>
        <Link href={`/master?p=${next.start}`}>→</Link>
      </p>
      <p>
        Мой заработок за период: <strong>{fmt(earn.final)}</strong> ({earn.status === "paid" ? "выплачено" : "ожидает выплаты"})
      </p>
      {earn.adjustment !== 0 && <p>В том числе корректировка: {fmt(earn.adjustment)}</p>}
      <ul style={{ padding: 0, listStyle: "none", display: "grid", gap: 8 }}>
        {visits.map((v) => (
          <li key={v.id}>
            {v.visitDate} · {v.clientName ?? "—"} · {fmt(v.amount)} · мне {fmt(v.myShare)}
          </li>
        ))}
        {visits.length === 0 && <li>В этом периоде визитов нет</li>}
      </ul>
      <form method="POST" action="/api/auth/logout">
        <button type="submit">Выйти</button>
      </form>
    </main>
  );
}
