import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { friendlyMessage } from "@/lib/actionErrors";
import { eachDay, fmtDay, isIsoDate } from "@/lib/dates";
import { addDaysOff, listDaysOff, removeDayOff } from "@/lib/services/dayoff";
import { requireUser } from "@/lib/auth/current";
import { CATEGORY_INFO } from "@/lib/categories";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { periodFor, shiftPeriod, todayInBusinessTz, type Period } from "@/lib/periods";
import { getMasterProfile } from "@/lib/services/masters";

async function addOff(formData: FormData) {
  "use server";
  const admin = await requireUser("admin");
  const masterId = String(formData.get("masterId"));
  const from = String(formData.get("from"));
  const to = String(formData.get("to") || from);
  const back = `/admin/masters/${masterId}`;
  try {
    if (!isIsoDate(from) || !isIsoDate(to) || to < from) throw new ValidationError("Укажите корректные даты");
    const n = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
    if (n > 62) throw new ValidationError("Не больше 62 дней за раз");
    await addDaysOff(admin, masterId, eachDay(from, n));
  } catch (e) {
    const msg = friendlyMessage(e);
    if (!msg) throw e;
    redirect(`${back}?error=${encodeURIComponent(msg)}`);
  }
  redirect(back);
}

async function removeOff(formData: FormData) {
  "use server";
  const admin = await requireUser("admin");
  const masterId = String(formData.get("masterId"));
  await removeDayOff(admin, masterId, String(formData.get("date")));
  redirect(`/admin/masters/${masterId}`);
}

const fmt = (n: number) => `${n.toLocaleString("ru-RU")} ₸`;

export default async function MasterProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ p?: string; error?: string }>;
}) {
  const admin = await requireUser("admin");
  const { id } = await params;
  const sp = await searchParams;
  let period: Period;
  try {
    period = periodFor(sp.p ?? todayInBusinessTz(new Date()));
  } catch (e) {
    if (e instanceof ValidationError) period = periodFor(todayInBusinessTz(new Date()));
    else throw e;
  }
  let profile;
  try {
    profile = await getMasterProfile(admin, id, period);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const todayIso = todayInBusinessTz(new Date());
  const upcomingOff = (await listDaysOff(admin, todayIso, eachDay(todayIso, 120)[119])).filter((x) => x.masterId === profile.id);
  const prev = shiftPeriod(period, -1);
  const next = shiftPeriod(period, 1);
  const cat = profile.category;
  return (
    <>
      <p><Link href="/admin/masters" className="muted">← Все мастера</Link></p>
      <section className="section" data-cat={cat ?? undefined} style={{ marginTop: 8 }}>
        <div className="avatar" style={{ width: 64, height: 64, fontSize: "2.2rem" }}>{profile.name[0]}</div>
        <h1>{profile.name}</h1>
        <p className="sub">
          {cat ? `${CATEGORY_INFO[cat].title} · ${CATEGORY_INFO[cat].description}` : "Категория не указана"}
          {profile.active ? "" : " · отключён"}
        </p>
      </section>
      <div className="period">
        <Link href={`/admin/masters/${profile.id}?p=${prev.start}`} aria-label="Предыдущий период">←</Link>
        <strong>{period.start} — {period.end}</strong>
        <Link href={`/admin/masters/${profile.id}?p=${next.start}`} aria-label="Следующий период">→</Link>
      </div>
      <div className="stats">
        <div className="card stat"><div className="label">Визитов</div><div className="value">{profile.visitCount}</div></div>
        <div className="card stat"><div className="label">Выручка</div><div className="value">{fmt(profile.revenue)}</div></div>
        <div className="card stat">
          <div className="label">К выплате</div>
          <div className="value">{fmt(profile.final)}</div>
          <span className={profile.status === "paid" ? "pill paid" : "pill"}>
            {profile.status === "paid" ? "выплачено" : "ожидает выплаты"}
          </span>
        </div>
      </div>
      <div className="card">
        <table>
          <thead><tr><th>Дата</th><th>Клиент</th><th className="num">Сумма</th></tr></thead>
          <tbody>
            {profile.visits.map((v) => (
              <tr key={v.id}><td>{v.visitDate}</td><td>{v.clientName ?? "—"}</td><td className="num">{fmt(v.amount)}</td></tr>
            ))}
            {profile.visits.length === 0 && <tr><td colSpan={3} className="muted">В этом периоде визитов нет</td></tr>}
          </tbody>
        </table>
      </div>
    <h2>Выходные</h2>
      <p className="sub">Выходной одного мастера не влияет на остальных. Он виден в общем календаре и в расписании мастера.</p>
      {sp.error && <p role="alert" className="alert">{sp.error}</p>}
      <form action={addOff} className="inline-form">
        <input type="hidden" name="masterId" value={profile.id} />
        <input name="from" type="date" min={todayIso} required aria-label="С даты" />
        <input name="to" type="date" min={todayIso} aria-label="По дату (необязательно)" />
        <button type="submit">Отметить выходные</button>
      </form>
      <p className="muted" style={{ marginTop: 6 }}>Один день: заполните только первую дату. Несколько дней подряд: укажите начало и конец.</p>
      <ul className="list" style={{ marginTop: 12 }}>
        {upcomingOff.map((x) => (
          <li key={x.date} className="card row">
            <span>{fmtDay(x.date)}</span>
            <form action={removeOff}>
              <input type="hidden" name="masterId" value={profile.id} />
              <input type="hidden" name="date" value={x.date} />
              <button type="submit" className="ghost">Удалить</button>
            </form>
          </li>
        ))}
        {upcomingOff.length === 0 && <li className="muted">Ближайших выходных нет</li>}
      </ul>
    </>
  );
}
