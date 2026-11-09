import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/current";
import { DuplicateWarning, ValidationError } from "@/lib/errors";
import { AmountError } from "@/lib/money";
import { todayInBusinessTz } from "@/lib/periods";
import { findOrCreateClientByName } from "@/lib/services/clients";
import { listMasters } from "@/lib/services/users";
import { createVisit } from "@/lib/services/visits";
import { listCatalog } from "@/lib/services/catalog";
import { CATEGORY_INFO } from "@/lib/categories";
import { ServiceAmount } from "@/components/ServiceAmount";

type SP = { error?: string; dup?: string; masterId?: string; client?: string; amount?: string; method?: string; date?: string };

async function addVisit(formData: FormData) {
  "use server";
  const admin = await requireUser("admin");
  const f = (k: string) => String(formData.get(k) ?? "");
  const keep = new URLSearchParams({ masterId: f("masterId"), client: f("client"), amount: f("amount"), method: f("method"), date: f("date") });
  try {
    const client = await findOrCreateClientByName(admin, f("client"), f("masterId"));
    await createVisit(admin, {
      visitDate: f("date"),
      masterId: f("masterId"),
      clientId: client.id,
      amount: f("amount"),
      paymentMethod: f("method") === "transfer" ? "transfer" : "cash",
      confirmDuplicate: formData.get("confirmDuplicate") === "on",
    });
  } catch (e) {
    if (e instanceof DuplicateWarning) {
      keep.set("dup", "1");
      redirect(`/admin/visits/new?${keep}`);
    }
    if (e instanceof AmountError || e instanceof ValidationError) {
      keep.set("error", e.message);
      redirect(`/admin/visits/new?${keep}`);
    }
    throw e;
  }
  redirect("/admin");
}

export default async function NewVisitPage({ searchParams }: { searchParams: Promise<SP> }) {
  const admin = await requireUser("admin");
  const sp = await searchParams;
  const [masters, clients, catalog] = await Promise.all([
    listMasters(admin),
    prisma.client.findMany({ select: { name: true }, orderBy: { name: "asc" } }),
    listCatalog(admin),
  ]);
  const services = catalog.flatMap((c) =>
    c.groups.flatMap((g) => g.items.map((s) => ({ ...s, label: `${CATEGORY_INFO[c.category].title} · ${g.groupName}` }))),
  );
  return (
    <>
      <h1>Новый визит</h1>
      <p className="sub">Мастер называет итоговую сумму, вы записываете</p>
      {sp.error && <p role="alert" className="alert">{sp.error}</p>}
      {sp.dup && (
        <p role="alert" className="alert">
          Похоже, такой визит уже записан. Если это другой визит, отметьте галочку ниже и сохраните ещё раз.
        </p>
      )}
      <form action={addVisit} className="stack">
        <select name="masterId" defaultValue={sp.masterId ?? ""} required>
          <option value="" disabled>Мастер</option>
          {masters.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
        <input name="client" list="clients" placeholder="Клиент (имя)" defaultValue={sp.client ?? ""} required />
        <datalist id="clients">
          {clients.map((c, i) => (
            <option key={i} value={c.name} />
          ))}
        </datalist>
        <ServiceAmount services={services} defaultAmount={sp.amount} />
        <select name="method" defaultValue={sp.method ?? "cash"}>
          <option value="cash">Наличные</option>
          <option value="transfer">Перевод</option>
        </select>
        <input name="date" type="date" defaultValue={sp.date ?? todayInBusinessTz(new Date())} required />
        {sp.dup && (
          <label>
            <input type="checkbox" name="confirmDuplicate" /> Это другой визит
          </label>
        )}
        <button type="submit">Сохранить</button>
      </form>
    </>
  );
}
