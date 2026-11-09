import Link from "next/link";
import { redirect } from "next/navigation";
import { masterSchedule } from "@/lib/access/master";
import { friendlyMessage } from "@/lib/actionErrors";
import { requireUser } from "@/lib/auth/current";
import { addDays, fmtDay, isIsoDate } from "@/lib/dates";
import { todayInBusinessTz } from "@/lib/periods";
import { completeVisit } from "@/lib/services/appointments";

async function done(formData: FormData) {
  "use server";
  const me = await requireUser("master");
  const from = String(formData.get("from"));
  try {
    await completeVisit(me, String(formData.get("id")));
  } catch (e) {
    const msg = friendlyMessage(e);
    if (!msg) throw e;
    redirect(`/master/schedule?from=${from}&error=${encodeURIComponent(msg)}`);
  }
  redirect(`/master/schedule?from=${from}`);
}

const STATUS = { scheduled: "ожидает", done: "выполнено", cancelled: "отменена" } as const;

export default async function MasterSchedulePage({ searchParams }: { searchParams: Promise<{ from?: string; error?: string }> }) {
  const me = await requireUser("master");
  const sp = await searchParams;
  const today = todayInBusinessTz(new Date());
  const from = isIsoDate(sp.from) ? sp.from : today;
  const days = await masterSchedule(me, from, 7);
  const total = days.reduce((n, d) => n + d.items.filter((i) => i.status !== "cancelled").length, 0);
  const fmtHours = (hs: number[]) => (hs.length === 0 ? "нет" : hs.map((h) => `${String(h).padStart(2, "0")}:00`).join(", "));
  return (
    <>
      <header className="topbar-solo"><span className="script">Lash Golden</span></header>
      <main className="content" style={{ margin: "0 auto" }}>
        <p><Link href="/master" className="muted">← Мои визиты и заработок</Link></p>
        <h1>Моё расписание</h1>
        <p className="sub">Записей на выбранные 7 дней: {total}</p>
        <div className="inline-form" style={{ marginBottom: 16 }}>
          <Link href={`/master/schedule?from=${today}`}><button type="button" className={from === today ? "" : "ghost"}>Сегодня</button></Link>
          <Link href={`/master/schedule?from=${addDays(today, 1)}`}><button type="button" className={from === addDays(today, 1) ? "" : "ghost"}>Завтра</button></Link>
          <Link href={`/master/schedule?from=${addDays(today, 2)}`}><button type="button" className={from === addDays(today, 2) ? "" : "ghost"}>Послезавтра</button></Link>
        </div>
        <div className="period">
          <Link href={`/master/schedule?from=${addDays(from, -7)}`} aria-label="Неделей раньше">←</Link>
          <strong>{fmtDay(from)} — {fmtDay(addDays(from, 6))}</strong>
          <Link href={`/master/schedule?from=${addDays(from, 7)}`} aria-label="Неделей позже">→</Link>
        </div>
        <form action={`/master/schedule`} className="inline-form" style={{ marginBottom: 16 }}>
          <input name="from" type="date" defaultValue={from} aria-label="Любая дата" />
          <button type="submit" className="ghost">Открыть дату</button>
        </form>
        {sp.error && <p role="alert" className="alert">{sp.error}</p>}
        <ul className="list">
          {days.map((d) => (
            <li key={d.date} className="card">
              <div className="row"><strong>{fmtDay(d.date)}</strong>{d.dayOff && <span className="pill">выходной</span>}</div>
              {d.items.map((i) => (
                <div key={i.id} className="row" style={{ marginTop: 10 }}>
                  <span>
                    <b>{i.time}</b> {i.clientName ?? "—"}
                    <div className="muted" style={{ fontSize: "0.85rem" }}>{i.services.join(", ")}</div>
                  </span>
                  <span className="inline-form">
                    <span className={i.status === "done" ? "pill paid" : "pill"}>{STATUS[i.status]}</span>
                    {i.status === "scheduled" && d.date <= today && (
                      <form action={done}>
                        <input type="hidden" name="id" value={i.id} />
                        <input type="hidden" name="from" value={from} />
                        <button type="submit">Выполнено</button>
                      </form>
                    )}
                  </span>
                </div>
              ))}
              {!d.dayOff && <p className="muted" style={{ marginTop: 10, fontSize: "0.85rem" }}>Свободные часы: {fmtHours(d.freeHours)}</p>}
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}
