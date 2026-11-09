import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/current";
import { friendlyMessage } from "@/lib/actionErrors";
import { CATEGORY_INFO } from "@/lib/categories";
import { parsePayment } from "@/lib/payment";
import { VisitForm } from "@/components/VisitForm";
import { updateScheduledVisit } from "@/lib/services/appointments";
import { getAppointment } from "@/lib/services/calendar";
import { listCatalog } from "@/lib/services/catalog";
import { findOrCreateClientByName } from "@/lib/services/clients";

async function save(formData: FormData) {
  "use server";
  const admin = await requireUser("admin");
  const f = (k: string) => String(formData.get(k) ?? "");
  const id = f("id");
  try {
    const client = await findOrCreateClientByName(admin, f("client"), f("masterId"));
    let items: { serviceId: string; price: unknown; belowMinReason?: string }[] = [];
    try {
      const raw: unknown = JSON.parse(f("items"));
      if (Array.isArray(raw)) items = raw as typeof items;
    } catch {
      items = [];
    }
    await updateScheduledVisit(admin, id, { masterId: f("masterId"), clientId: client.id, paymentMethod: parsePayment(f("method")), items });
  } catch (e) {
    const msg = friendlyMessage(e);
    if (!msg) throw e;
    redirect(`/admin/appointments/${id}/edit?error=${encodeURIComponent(msg)}`);
  }
  redirect(`/admin/appointments/${id}`);
}

export default async function EditAppointmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const admin = await requireUser("admin");
  const { id } = await params;
  const sp = await searchParams;
  const a = await getAppointment(admin, id);
  if (!a || a.status !== "scheduled") notFound();
  const [masters, clients, catalog] = await Promise.all([
    prisma.user.findMany({ where: { role: "master", active: true, category: { not: null } }, select: { id: true, name: true, category: true }, orderBy: { name: "asc" } }),
    prisma.client.findMany({ select: { name: true }, orderBy: { name: "asc" } }),
    listCatalog(admin),
  ]);
  const services = catalog.flatMap((c) => c.groups.flatMap((g) => g.items.map((s) => ({ ...s, category: c.category, groupName: g.groupName }))));
  return (
    <>
      <h1>Изменить запись</h1>
      <p className="sub">{a.date} {a.time}. Дату и время меняйте кнопкой «Перенести»</p>
      {sp.error && <p role="alert" className="alert">{sp.error}</p>}
      <VisitForm
        mode="edit"
        visitId={a.id}
        masters={masters.map((m) => ({ id: m.id, name: m.name, category: m.category, categoryTitle: m.category ? CATEGORY_INFO[m.category].title : "" }))}
        services={services}
        clients={clients.map((c) => c.name)}
        action={save}
        today={a.date}
        initial={{
          masterId: a.masterId,
          client: a.clientName ?? "",
          method: a.paymentMethod,
          items: a.items.filter((i) => i.serviceId).map((i) => ({ serviceId: i.serviceId as string, price: i.price, belowMinReason: i.belowMinReason ?? undefined })),
        }}
      />
    </>
  );
}
