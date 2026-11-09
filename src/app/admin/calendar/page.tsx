import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/current";
import { CATEGORY_INFO } from "@/lib/categories";
import { addDays, eachDay, fmtDay, isIsoDate, startOfWeek } from "@/lib/dates";
import { todayInBusinessTz } from "@/lib/periods";
import { calendarRange } from "@/lib/services/calendar";
import { monthRange } from "@/lib/services/reports";

type View = "day" | "week" | "month";
const HOURS = Array.from({ length: 12 }, (_, i) => i + 8);
const STATUS_CLASS = { scheduled: "ev", done: "ev done", cancelled: "ev off" } as const;

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ view?: string; d?: string }> }) {
  const admin = await requireUser("admin");
  const sp = await searchParams;
  const today = todayInBusinessTz(new Date());
  const view: View = sp.view === "week" || sp.view === "month" ? sp.view : "day";
  const d = isIsoDate(sp.d) ? sp.d : today;

  let from = d;
  let to = d;
  let prev = addDays(d, -1);
  let next = addDays(d, 1);
  let title = fmtDay(d);
  if (view === "week") {
    from = startOfWeek(d);
    to = addDays(from, 6);
    prev = addDays(from, -7);
    next = addDays(from, 7);
    title = `${fmtDay(from)} — ${fmtDay(to)}`;
  } else if (view === "month") {
    const m = monthRange(d);
    from = startOfWeek(m.start);
    to = addDays(startOfWeek(m.end), 6);
    prev = addDays(m.start, -1);
    next = addDays(m.end, 1);
    title = new Date(`${m.start}T00:00:00Z`).toLocaleDateString("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" });
  }
  const [masters, cal] = await Promise.all([
    prisma.user.findMany({
      where: { role: "master", active: true, category: { not: null } },
      select: { id: true, name: true, category: true },
      orderBy: { name: "asc" },
    }),
    calendarRange(admin, from, to),
  ]);
  const off = new Set(cal.daysOff.map((x) => `${x.masterId}|${x.date}`));
  const live = cal.entries.filter((e) => e.status !== "cancelled");
  const link = (v: View, date: string) => `/admin/calendar?view=${v}&d=${date}`;

  return (
    <>
      <h1>Календарь</h1>
      <div className="row" style={{ margin: "8px 0 16px" }}>
        <div className="period" style={{ margin: 0 }}>
          <Link href={link(view, prev)} aria-label="Назад">←</Link>
          <strong style={{ textTransform: "capitalize" }}>{title}</strong>
          <Link href={link(view, next)} aria-label="Вперёд">→</Link>
        </div>
        <div className="inline-form">
          {(["day", "week", "month"] as const).map((v) => (
            <Link key={v} href={link(v, d)}>
              <button type="button" className={v === view ? "" : "ghost"}>{{ day: "День", week: "Неделя", month: "Месяц" }[v]}</button>
            </Link>
          ))}
          <Link href={link(view, today)}><button type="button" className="ghost">Сегодня</button></Link>
        </div>
      </div>

      {view === "day" && (
        <div className="cal-scroll card" style={{ padding: 0 }}>
          <table className="cal">
            <thead>
              <tr>
                <th className="hour" />
                {masters.map((m) => (
                  <th key={m.id}>
                    <Link href={`/admin/masters/${m.id}`}>{m.name}</Link>
                    <small>{m.category ? CATEGORY_INFO[m.category].title : ""}</small>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {HOURS.map((h) => {
                const hh = String(h).padStart(2, "0");
                return (
                  <tr key={h}>
                    <td className="hour">{hh}:00</td>
                    {masters.map((m) => {
                      if (off.has(`${m.id}|${d}`)) return <td key={m.id} className="off-day">выходной</td>;
                      const here = cal.entries.filter((e) => e.masterId === m.id && e.time?.startsWith(`${hh}:`));
                      const free = here.every((e) => e.status === "cancelled");
                      return (
                        <td key={m.id}>
                          {here.map((e) => (
                            <Link key={e.id} href={`/admin/appointments/${e.id}`} className={STATUS_CLASS[e.status]}>
                              <b>{e.time}</b> {e.clientName ?? "—"}
                              <small>{e.services.join(", ")}</small>
                            </Link>
                          ))}
                          {free && (
                            <Link href={`/admin/visits/new?status=scheduled&masterId=${m.id}&date=${d}&time=${hh}:00`} className="slot" aria-label={`Записать на ${hh}:00`}>+</Link>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {view === "week" && (
        <div className="cal-scroll card" style={{ padding: 0 }}>
          <table className="cal">
            <thead>
              <tr>
                <th />
                {eachDay(from, 7).map((day) => (
                  <th key={day}><Link href={link("day", day)}>{fmtDay(day)}</Link></th>
                ))}
              </tr>
            </thead>
            <tbody>
              {masters.map((m) => (
                <tr key={m.id}>
                  <td className="hour"><Link href={`/admin/masters/${m.id}`}>{m.name}</Link></td>
                  {eachDay(from, 7).map((day) => {
                    if (off.has(`${m.id}|${day}`)) return <td key={day} className="off-day">выходной</td>;
                    const n = live.filter((e) => e.masterId === m.id && e.date === day).length;
                    return (
                      <td key={day}>
                        <Link href={link("day", day)} className={n ? "count" : "count none"}>{n ? `${n} зап.` : "свободно"}</Link>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view === "month" && (
        <div className="month">
          {eachDay(from, 7).map((day) => <div key={day} className="mh">{fmtDay(day).slice(0, 2)}</div>)}
          {eachDay(from, Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1).map((day) => {
            const n = live.filter((e) => e.date === day).length;
            const inMonth = day.slice(0, 7) === monthRange(d).start.slice(0, 7);
            const offCount = cal.daysOff.filter((x) => x.date === day).length;
            return (
              <Link key={day} href={link("day", day)} className={`md${inMonth ? "" : " dim"}${day === today ? " today" : ""}`}>
                <span>{Number(day.slice(8))}</span>
                {n > 0 && <em>{n} зап.</em>}
                {offCount > 0 && <small>вых.: {offCount}</small>}
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
