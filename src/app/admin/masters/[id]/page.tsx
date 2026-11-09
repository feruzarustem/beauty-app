import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/current";
import { CATEGORY_INFO } from "@/lib/categories";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { periodFor, shiftPeriod, todayInBusinessTz, type Period } from "@/lib/periods";
import { getMasterProfile } from "@/lib/services/masters";

const fmt = (n: number) => `${n.toLocaleString("ru-RU")} ₸`;

export default async function MasterProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ p?: string }>;
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
    </>
  );
}
