import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/current";
import { friendlyMessage } from "@/lib/actionErrors";
import { addDays, fmtDay, isIsoDate } from "@/lib/dates";
import { todayInBusinessTz } from "@/lib/periods";
import { closeDay, dayFigures, getClosing, reopenDay } from "@/lib/services/closing";

const fmt = (n: number) => `${n.toLocaleString("ru-RU")} ₸`;

async function doClose(formData: FormData) {
  "use server";
  const admin = await requireUser("admin");
  const date = String(formData.get("date"));
  try {
    await closeDay(admin, date, String(formData.get("actualCash") ?? "").replace(/\s/g, ""), String(formData.get("comment") ?? ""));
  } catch (e) {
    const msg = friendlyMessage(e);
    if (!msg) throw e;
    redirect(`/admin/closing?d=${date}&error=${encodeURIComponent(msg)}&cash=${encodeURIComponent(String(formData.get("actualCash") ?? ""))}`);
  }
  redirect(`/admin/closing?d=${date}`);
}

async function doReopen(formData: FormData) {
  "use server";
  const admin = await requireUser("admin");
  const date = String(formData.get("date"));
  try {
    await reopenDay(admin, date, String(formData.get("reason") ?? ""));
  } catch (e) {
    const msg = friendlyMessage(e);
    if (!msg) throw e;
    redirect(`/admin/closing?d=${date}&error=${encodeURIComponent(msg)}`);
  }
  redirect(`/admin/closing?d=${date}`);
}

export default async function ClosingPage({ searchParams }: { searchParams: Promise<{ d?: string; error?: string; cash?: string }> }) {
  const admin = await requireUser("admin");
  const sp = await searchParams;
  const today = todayInBusinessTz(new Date());
  const d = isIsoDate(sp.d) && sp.d <= today ? sp.d : today;
  const [f, closing] = await Promise.all([dayFigures(admin, d), getClosing(admin, d)]);
  const closed = closing?.isClosed === true;
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Almaty", hour: "2-digit", hour12: false }).format(new Date()));
  const inWindow = d === today && hour >= 22;
  const row = (label: string, v: number) => (
    <div className="row"><span className="muted">{label}</span><strong>{fmt(v)}</strong></div>
  );
  return (
    <>
      <h1>Закрытие дня</h1>
      <div className="period">
        <Link href={`/admin/closing?d=${addDays(d, -1)}`} aria-label="Предыдущий день">←</Link>
        <strong>{fmtDay(d)}</strong>
        {d < today ? <Link href={`/admin/closing?d=${addDays(d, 1)}`} aria-label="Следующий день">→</Link> : <span />}
      </div>
      {d === today && !closed && (
        <p className="sub">{inWindow ? "Сейчас удобное время для закрытия дня." : "Обычно день закрывают с 22:30 до 00:00. Закрыть можно и раньше."}</p>
      )}
      {sp.error && <p role="alert" className="alert">{sp.error}</p>}
      {closed && (
        <p className="alert" style={{ background: "var(--gold-soft)", borderColor: "var(--gold)", color: "var(--ink)" }}>
          День закрыт {closing?.closedAt.toLocaleString("ru-RU", { timeZone: "Asia/Almaty" })}. Показатели зафиксированы.
        </p>
      )}
      <div className="stats">
        <div className="card stat"><div className="label">Выполнено процедур</div><div className="value">{closed ? closing!.visitCount : f.visitCount}</div></div>
        <div className="card stat"><div className="label">Выручка</div><div className="value">{fmt(closed ? closing!.revenue : f.revenue)}</div></div>
      </div>
      <div className="card list">
        {row("Заработок мастеров", closed ? closing!.mastersTotal : f.mastersTotal)}
        {row("Доля салона", closed ? closing!.salonShare : f.salonShare)}
        <hr className="divider" />
        {row("Наличные", closed ? closing!.cashTotal : f.cashTotal)}
        {row("Kaspi/QR", closed ? closing!.kaspiTotal : f.kaspiTotal)}
        {row("Перевод", closed ? closing!.transferTotal : f.transferTotal)}
        <hr className="divider" />
        {row("Общая сумма по системе", closed ? closing!.revenue : f.revenue)}
      </div>

      {!closed && f.unfinished > 0 && (
        <p className="alert">
          Есть записи без статуса: {f.unfinished}. Отметьте их выполненными или отмените в <Link href={`/admin/calendar?d=${d}`}><u>календаре</u></Link>, иначе день закрыть нельзя.
        </p>
      )}

      {closed ? (
        <>
          <h2>Касса</h2>
          <div className="card list">
            {row("Наличные по системе", closing!.expectedCash)}
            {row("Фактически в кассе", closing!.actualCash)}
            <div className="row"><span className="muted">Расхождение</span><strong style={{ color: closing!.difference === 0 ? undefined : "var(--danger)" }}>{closing!.difference > 0 ? "+" : ""}{fmt(closing!.difference)}</strong></div>
            {closing!.comment && <p className="muted">Комментарий: {closing!.comment}</p>}
          </div>
          <h2>Открыть день заново</h2>
          <form action={doReopen} className="inline-form">
            <input type="hidden" name="date" value={d} />
            <input name="reason" placeholder="Причина (обязательно)" required />
            <button type="submit" className="danger">Открыть день</button>
          </form>
        </>
      ) : (
        <>
          <h2>Сверка кассы</h2>
          <p className="sub">Сумма наличных по системе: {fmt(f.cashTotal)}. Пересчитайте деньги и введите фактическую сумму.</p>
          <form action={doClose} className="stack">
            <input type="hidden" name="date" value={d} />
            <input name="actualCash" inputMode="numeric" placeholder="Фактически в кассе, ₸" defaultValue={sp.cash ?? ""} required />
            <input name="comment" placeholder="Комментарий (обязателен, если есть расхождение)" />
            <button type="submit" disabled={f.unfinished > 0}>Закрыть день</button>
          </form>
        </>
      )}
    </>
  );
}
