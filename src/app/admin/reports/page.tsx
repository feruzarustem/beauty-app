import Link from "next/link";
import { PAYMENT_LABEL, PAYMENT_METHODS } from "@/lib/payment";
import { requireUser } from "@/lib/auth/current";
import { addDays, fmtDay, isIsoDate, startOfWeek } from "@/lib/dates";
import { periodFor, shiftPeriod, todayInBusinessTz } from "@/lib/periods";
import { monthRange, previousMonthRange, reportForRange } from "@/lib/services/reports";

const fmt = (n: number) => `${n.toLocaleString("ru-RU")} ₸`;
type Kind = "day" | "week" | "period" | "month" | "prev";

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ kind?: string; d?: string }> }) {
  const admin = await requireUser("admin");
  const sp = await searchParams;
  const today = todayInBusinessTz(new Date());
  const kind: Kind = sp.kind === "day" || sp.kind === "week" || sp.kind === "month" || sp.kind === "prev" ? sp.kind : "period";
  const d = isIsoDate(sp.d) ? sp.d : today;
  let range: { start: string; end: string };
  let title: string;
  if (kind === "day") {
    range = { start: d, end: d };
    title = "Отчёт за день";
  } else if (kind === "week") {
    range = { start: startOfWeek(d), end: addDays(startOfWeek(d), 6) };
    title = "Отчёт за неделю";
  } else if (kind === "period") {
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
  const total = PAYMENT_METHODS.reduce((s, m) => s + r.byMethod[m], 0);
  const tab = (k: Kind, label: string) => (
    <Link href={`/admin/reports?kind=${k}&d=${d}`}><button type="button" className={k === kind ? "" : "ghost"}>{label}</button></Link>
  );
  const prev = kind === "day" ? addDays(d, -1) : kind === "week" ? addDays(range.start, -7) : kind === "period" ? shiftPeriod(range, -1).start : kind === "month" ? previousMonthRange(d).start : d;
  const next = kind === "day" ? addDays(d, 1) : kind === "week" ? addDays(range.start, 7) : kind === "period" ? shiftPeriod(range, 1).start : kind === "month" ? addMonth(range.end) : d;
  return (
    <>
      <h1>Отчёты</h1>
      <div className="inline-form" style={{ margin: "8px 0 16px" }}>
        {tab("day", "День")}
        {tab("week", "Неделя")}
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
        {PAYMENT_METHODS.map((m) => (
          <div key={m} className="row"><span className="muted">{PAYMENT_LABEL[m]}</span><span><strong>{fmt(r.byMethod[m])}</strong> <span className="muted">{total ? Math.round((r.byMethod[m] / total) * 100) : 0}%</span></span></div>
        ))}
      </div>
      <h2>Предоплаты</h2>
      <div className="card list">
        <div className="row"><span className="muted">Вошли в стоимость выполненных записей</span><strong>{fmt(r.prepayments.applied)}</strong></div>
        <div className="row"><span className="muted">Остались салону при отмене записи</span><strong>{fmt(r.prepayments.forfeited)}</strong></div>
        <div className="row"><span className="muted">К возврату клиентам (излишек)</span><strong>{fmt(r.prepayments.refunded)}</strong></div>
        <p className="muted" style={{ fontSize: "0.85rem" }}>Предоплата уже входит в выручку выполненных записей и отдельным доходом не считается. Исключение: предоплаты отменённых записей, они остаются салону.</p>
      </div>
      <h2>Скидки</h2>
      <div className="card cal-scroll">
        <table>
          <thead><tr><th>Дата</th><th>Мастер / клиент</th><th className="num">Было</th><th className="num">Скидка</th><th>Причина</th><th>За счёт</th><th className="num">Итог</th><th className="num">Мастеру</th><th className="num">Салону</th></tr></thead>
          <tbody>
            {r.discounts.map((x) => (
              <tr key={x.visitId}>
                <td>{fmtDay(x.date)}</td>
                <td>{x.masterName}<div className="muted" style={{ fontSize: "0.8rem" }}>{x.clientName ?? "—"}</div></td>
                <td className="num">{fmt(x.listAmount)}</td>
                <td className="num">{x.percent}% (−{fmt(x.amount)})</td>
                <td>{x.reason}</td>
                <td>{x.bearer === "master" ? "мастер" : x.bearer === "salon" ? "салон" : "пополам"}</td>
                <td className="num">{fmt(x.finalAmount)}</td>
                <td className="num">{fmt(x.master)}</td>
                <td className="num">{fmt(x.salon)}</td>
              </tr>
            ))}
            {r.discounts.length === 0 && <tr><td colSpan={9} className="muted">Скидок нет</td></tr>}
          </tbody>
        </table>
        {r.discounts.length > 0 && <p className="muted" style={{ padding: 8 }}>Всего скидок: {fmt(r.discountTotal)}</p>}
      </div>
      <h2>Блогер / Реклама</h2>
      <div className="card list">
        <div className="row"><span className="muted">Записей</span><strong>{r.blogger.count}</strong></div>
        <div className="row"><span className="muted">Сумма процедур</span><strong>{fmt(r.blogger.total)}</strong></div>
        <div className="row"><span className="muted">Получили мастера (100%), доход салона 0 ₸</span><strong>{fmt(r.blogger.masterEarned)}</strong></div>
        <p className="muted" style={{ fontSize: "0.85rem" }}>Это не скидка и в разделе «Скидки» не учитывается.</p>
      </div>
      <h2>По мастерам</h2>
      <div className="card">
        <table>
          <thead><tr><th>Мастер</th><th className="num">Процедур</th><th className="num">Выручка</th><th className="num">Зарплата</th></tr></thead>
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
