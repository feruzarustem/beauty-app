import Link from "next/link";
import { requireUser } from "@/lib/auth/current";
import { CATEGORY_INFO } from "@/lib/categories";
import { listMastersByCategory } from "@/lib/services/masters";

export default async function MastersPage() {
  const admin = await requireUser("admin");
  const groups = await listMastersByCategory(admin);
  return (
    <>
      <h1>Мастера</h1>
      <p className="sub">Команда по направлениям</p>
      {groups.map((g) => (
        <section key={g.category} className="section" data-cat={g.category}>
          <div className="section-head">
            <h2>{CATEGORY_INFO[g.category].title}</h2>
            <span className="muted">{CATEGORY_INFO[g.category].description}</span>
          </div>
          <div className="grid">
            {g.masters.map((m) => (
              <Link key={m.id} href={`/admin/masters/${m.id}`} className="card">
                <div className="avatar">{m.name[0]}</div>
                <strong>{m.name}</strong>
                <div className="muted">{CATEGORY_INFO[g.category].description}</div>
              </Link>
            ))}
            {g.masters.length === 0 && <p className="muted">Пока никого</p>}
          </div>
        </section>
      ))}
    </>
  );
}
