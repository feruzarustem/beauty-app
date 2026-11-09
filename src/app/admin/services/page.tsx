import { requireUser } from "@/lib/auth/current";
import { CATEGORY_INFO } from "@/lib/categories";
import { formatPrice } from "@/lib/price";
import { listCatalog } from "@/lib/services/catalog";

export default async function ServicesPage() {
  const admin = await requireUser("admin");
  const catalog = await listCatalog(admin);
  return (
    <>
      <h1>Услуги</h1>
      <p className="sub">Прайс-лист LASH GOLDEN</p>
      {catalog.map((c) => (
        <section key={c.category} className="section" data-cat={c.category}>
          <div className="section-head">
            <h2>{CATEGORY_INFO[c.category].title}</h2>
            <span className="muted">{CATEGORY_INFO[c.category].description}</span>
          </div>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
            {c.groups.map((g) => (
              <div key={g.groupName} className="card">
                <strong>{g.groupName}</strong>
                <hr className="divider" />
                <ul className="list">
                  {g.items.map((s) => (
                    <li key={s.id}>
                      <div className="row" style={{ flexWrap: "nowrap", alignItems: "baseline" }}>
                        <span>{s.name}</span>
                        <span style={{ whiteSpace: "nowrap" }}>{formatPrice(s)}</span>
                      </div>
                      {s.details && <div className="muted" style={{ fontSize: "0.85rem" }}>{s.details}</div>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {c.groups.length === 0 && <p className="muted">Услуги не загружены</p>}
          </div>
        </section>
      ))}
    </>
  );
}
