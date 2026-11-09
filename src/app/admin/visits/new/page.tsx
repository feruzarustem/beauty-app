import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/current";
import { DuplicateWarning, ValidationError } from "@/lib/errors";
import { AmountError } from "@/lib/money";
import { todayInBusinessTz } from "@/lib/periods";
import { findOrCreateClientByName } from "@/lib/services/clients";
import { createVisitWithItems } from "@/lib/services/visits";
import { listCatalog } from "@/lib/services/catalog";
import { CATEGORY_INFO } from "@/lib/categories";
import { VisitForm, type InitialItem } from "@/components/VisitForm";

type SP = { error?: string; dup?: string; masterId?: string; client?: string; items?: string; method?: string; date?: string };

function parseItems(raw: string): InitialItem[] {
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v
      .filter((i): i is Record<string, unknown> => typeof i === "object" && i !== null && typeof (i as Record<string, unknown>).serviceId === "string")
      .map((i) => ({ serviceId: String(i.serviceId), price: Number(i.price) || 0, belowMinReason: typeof i.belowMinReason === "string" ? i.belowMinReason : undefined }));
  } catch {
    return [];
  }
}

async function addVisit(formData: FormData) {
  "use server";
  const admin = await requireUser("admin");
  const f = (k: string) => String(formData.get(k) ?? "");
  const keep = new URLSearchParams({ masterId: f("masterId"), client: f("client"), items: f("items"), method: f("method"), date: f("date") });
  try {
    const client = await findOrCreateClientByName(admin, f("client"), f("masterId"));
    await createVisitWithItems(admin, {
      visitDate: f("date"),
      masterId: f("masterId"),
      clientId: client.id,
      items: parseItems(f("items")),
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
    prisma.user.findMany({
      where: { role: "master", active: true, category: { not: null } },
      select: { id: true, name: true, category: true },
      orderBy: { name: "asc" },
    }),
    prisma.client.findMany({ select: { name: true }, orderBy: { name: "asc" } }),
    listCatalog(admin),
  ]);
  const services = catalog.flatMap((c) =>
    c.groups.flatMap((g) => g.items.map((s) => ({ ...s, category: c.category, groupName: g.groupName }))),
  );
  return (
    <>
      <h1>Новый визит</h1>
      <p className="sub">Выберите мастера и услуги. Сумму устанавливаете вы</p>
      {sp.error && <p role="alert" className="alert">{sp.error}</p>}
      {sp.dup && (
        <p role="alert" className="alert">
          Похоже, такой визит уже записан. Если это другой визит, отметьте галочку ниже и сохраните ещё раз.
        </p>
      )}
      <VisitForm
        masters={masters.map((m) => ({ id: m.id, name: m.name, category: m.category, categoryTitle: m.category ? CATEGORY_INFO[m.category].title : "" }))}
        services={services}
        clients={clients.map((c) => c.name)}
        action={addVisit}
        today={todayInBusinessTz(new Date())}
        initial={{ masterId: sp.masterId, client: sp.client, method: sp.method, date: sp.date, items: parseItems(sp.items ?? "[]"), dup: !!sp.dup }}
      />
    </>
  );
}
