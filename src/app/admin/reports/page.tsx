import Link from "next/link";
import { requireUser } from "@/lib/auth/current";
import { fmtDay, isIsoDate } from "@/lib/dates";
import { periodFor, shiftPeriod, todayInBusinessTz } from "@/lib/periods";
import { monthRange, previousMonthRange, reportForRange } from "@/lib/services/reports";

const fmt = (n: number) => `${n.toLocaleString("ru-RU")} ₸`;
type Kind = "period" | "month" | "prev";

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ kind?: string; d?: string }> }) {
  const admin = await requireUser("admin");
  const sp = await searchParams;
  const today = todayInBusinessTz(new Date());
  const kind: Kind = sp.kind === "month" || sp.kind === "prev" ? sp.kind : "period";
  const d = isIsoDate(sp.d) ? sp.d : today;
  let range: { start: string; end: string };
  let title: string;
  if (kind === "period") {
    range = periodFor(d);
    title = "Отчёт за 15 дней (период выплаты)";
  } else if (kind === "month") {
    range = monthRange(d);
    title = "Месячный отчёт";
  } else {
    range = previousMonthRange(today);
    title = "Итоговый отчёт за прошлый месяц";
  }
  const r = await reportForRange(admin, range.start, range.end);
  const total = r.byMethod.cash + r.byMethod.kaspi + r.byMethod.transfer;
  const tab = (k: Kind, label: string) => (
    <Link href={`/admin/reports?kind=${k}&d=${d}`}><button type="button" className={k === kind ? "" : "ghost"}>{label}</button></Link>
  );
  const prev = kind === "period" ? shiftPeriod(range, -1).start : kind === "month" ? previousMonthRange(d).start : d;
  const next = kind === "period" ? shiftPeriod(range, 1).start : kind === "month" ? addMonth(range.end) : d;
  return (
    <>
      <h1>Отчёты</h1>
      <div className="inline-form" style={{ margin: "8px 0 16px" }}>
        {tab("period", "15 дней")}
        {tab("month", "Месяц")}
        {tab("prev", "Прошлый месяц")}
      </div>
      <h2 style={{ marginTop: 0 }}>{title}</h2>
      <div className="period">
        {kind !== "prev" && <Link href={`/admin/reports?kind=${kind}&d=${prev}`} aria-label="Назад">←</Link>}
        <strong>{fmtDay(range.start)} — {fmtDay(range.end)}</strong>
        {kind !== "prev" && <Link href={`/admin/reports?kind=${kind}&d=${next}`} aria-label="Вперёд">→</Link>}
      </div>
      {r.unclosedDays.length > 0 && (
        <p className="alert">Не закрыты дни: {r.unclosedDays.map(fmtDay).join(", ")}. Отчёт строится по выполненным визитам, но кассовая сверка по этим дням не проведена.</p>
      )}
      <div className="stats">
        <div className="card stat"><div className="label">Выручка</div><div className="value">{fmt(r.revenue)}</div></div>
        <div className="card stat"><div className="label">Процедур</div><div className="value">{r.visitCount}</div></div>
        <div className="card stat"><div className="label">Заработок мастеров</div><div className="value">{fmt(r.mastersTotal)}</div></div>
        <div className="card stat"><div className="label">Доля салона</div><div className="value">{fmt(r.salonShare)}</div></div>
      </div>
      <h2>Способы оплаты</h2>
      <div className="card list">
        {([["Наличные", r.byMethod.cash], ["Kaspi/QR", r.byMethod.kaspi], ["Перевод", r.byMethod.transfer]] as const).map(([label, v]) => (
          <div key={label} className="row"><span className="muted">{label}</span><span><strong>{fmt(v)}</strong> <span className="muted">{total ? Math.round((v / total) * 100) : 0}%</span></span></div>
        ))}
      </div>
      <h2>По мастерам</h2>
      <div className="card">
        <table>
          <thead><tr><th>Мастер</th><th className="num">Процедур</th><th className="num">Выручка</th><th className="num">Заработок</th></tr></thead>
          <tbody>
            {r.masters.map((m) => (
              <tr key={m.masterId}><td>{m.masterName}</td><td className="num">{m.visitCount}</td><td className="num">{fmt(m.revenue)}</td><td className="num">{fmt(m.earned)}</td></tr>
            ))}
            {r.masters.length === 0 && <tr><td colSpan={4} className="muted">Нет выполненных процедур</td></tr>}
          </tbody>
        </table>
      </div>
      <h2>Сверка кассы</h2>
      <div className="card list">
        <div className="row"><span className="muted">Закрыто дней</span><strong>{r.closedDays}</strong></div>
        {r.closings.length === 0 ? <p className="muted">Расхождений нет</p> : r.closings.map((c) => (
          <div key={c.date} className="row"><span>{fmtDay(c.date)}{c.comment && <span className="muted"> — {c.comment}</span>}</span><strong style={{ color: "var(--danger)" }}>{c.difference > 0 ? "+" : ""}{fmt(c.difference)}</strong></div>
        ))}
      </div>
    </>
  );
}

function addMonth(endIso: string): string {
  return new Date(Date.parse(`${endIso}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}
