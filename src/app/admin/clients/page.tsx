import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/current";
import { ValidationError } from "@/lib/errors";
import { createClient, deleteClient, updateClientContact } from "@/lib/services/clients";
import { listMasters } from "@/lib/services/users";

async function add(formData: FormData) {
  "use server";
  const admin = await requireUser("admin");
  try {
    await createClient(admin, {
      name: String(formData.get("name") ?? ""),
      assignedMasterId: String(formData.get("masterId") ?? ""),
      phone: String(formData.get("phone") ?? ""),
    });
  } catch (e) {
    if (!(e instanceof ValidationError)) throw e;
  }
  revalidatePath("/admin/clients");
}

async function savePhone(formData: FormData) {
  "use server";
  const admin = await requireUser("admin");
  try {
    await updateClientContact(admin, String(formData.get("id")), String(formData.get("phone") ?? ""));
  } catch (e) {
    if (!(e instanceof ValidationError)) throw e;
  }
  revalidatePath("/admin/clients");
}

async function remove(formData: FormData) {
  "use server";
  const admin = await requireUser("admin");
  await deleteClient(admin, String(formData.get("id")));
  revalidatePath("/admin/clients");
}

export default async function ClientsPage() {
  const admin = await requireUser("admin");
  const [masters, clients] = await Promise.all([
    listMasters(admin),
    prisma.client.findMany({ include: { contact: true, assignedMaster: { select: { name: true } } }, orderBy: { name: "asc" } }),
  ]);
  return (
    <main style={{ maxWidth: 520, margin: "0 auto", padding: 16 }}>
      <h1>Клиенты</h1>
      <ul style={{ padding: 0, listStyle: "none", display: "grid", gap: 12 }}>
        {clients.map((c) => (
          <li key={c.id} style={{ borderTop: "1px solid #ccc", paddingTop: 8 }}>
            <strong>{c.name}</strong> · мастер: {c.assignedMaster?.name ?? "—"}
            <form action={savePhone} style={{ display: "flex", gap: 6 }}>
              <input type="hidden" name="id" value={c.id} />
              <input name="phone" defaultValue={c.contact?.phone ?? ""} placeholder="Телефон" />
              <button type="submit">Сохранить</button>
            </form>
            <form action={remove}>
              <input type="hidden" name="id" value={c.id} />
              <button type="submit">Удалить клиента и контакты</button>
            </form>
          </li>
        ))}
      </ul>
      <h2>Добавить клиента</h2>
      <form action={add} style={{ display: "grid", gap: 8 }}>
        <input name="name" placeholder="Имя" required />
        <input name="phone" placeholder="Телефон (необязательно)" />
        <select name="masterId" required defaultValue="">
          <option value="" disabled>Закреплённый мастер</option>
          {masters.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
        <small>Сохраняя телефон, вы подтверждаете, что клиент согласен на хранение своих данных.</small>
        <button type="submit">Добавить</button>
      </form>
    </main>
  );
}
