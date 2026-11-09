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
    <>
      <h1>Клиенты</h1>
      <p className="sub">Телефоны видны только администратору</p>
      <ul className="list">
        {clients.map((c) => (
          <li key={c.id} className="card">
            <div className="row">
              <strong>{c.name}</strong>
              <span className="muted">мастер: {c.assignedMaster?.name ?? "—"}</span>
            </div>
            <div className="inline-form" style={{ marginTop: 10 }}>
              <form action={savePhone} className="inline-form">
                <input type="hidden" name="id" value={c.id} />
                <input name="phone" defaultValue={c.contact?.phone ?? ""} placeholder="Телефон" />
                <button type="submit" className="ghost">Сохранить</button>
              </form>
              <form action={remove}>
                <input type="hidden" name="id" value={c.id} />
                <button type="submit" className="danger">Удалить клиента и контакты</button>
              </form>
            </div>
          </li>
        ))}
      </ul>
      <h2>Добавить клиента</h2>
      <form action={add} className="stack">
        <input name="name" placeholder="Имя" required />
        <input name="phone" placeholder="Телефон (необязательно)" />
        <select name="masterId" required defaultValue="">
          <option value="" disabled>Закреплённый мастер</option>
          {masters.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
        <small className="muted">Сохраняя телефон, вы подтверждаете, что клиент согласен на хранение своих данных.</small>
        <button type="submit">Добавить</button>
      </form>
    </>
  );
}
