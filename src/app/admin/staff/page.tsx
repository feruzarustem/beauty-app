import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/current";
import { createUser, setUserActive } from "@/lib/services/users";

async function addStaff(formData: FormData) {
  "use server";
  const actor = await requireUser("admin");
  await createUser(actor, {
    name: String(formData.get("name") ?? ""),
    login: String(formData.get("login") ?? ""),
    password: String(formData.get("password") ?? ""),
    role: formData.get("role") === "admin" ? "admin" : "master",
  });
  revalidatePath("/admin/staff");
}

async function toggleActive(formData: FormData) {
  "use server";
  const actor = await requireUser("admin");
  await setUserActive(actor, String(formData.get("id")), formData.get("active") === "true");
  revalidatePath("/admin/staff");
}

export default async function StaffPage() {
  await requireUser("admin");
  const users = await prisma.user.findMany({ orderBy: [{ role: "asc" }, { name: "asc" }] });
  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: 16 }}>
      <h1>Сотрудники</h1>
      <ul style={{ padding: 0, listStyle: "none", display: "grid", gap: 8 }}>
        {users.map((u) => (
          <li key={u.id} style={{ display: "flex", justifyContent: "space-between" }}>
            <span>
              {u.name} ({u.role === "admin" ? "админ" : "мастер"}){u.active ? "" : " — отключён"}
            </span>
            <form action={toggleActive}>
              <input type="hidden" name="id" value={u.id} />
              <input type="hidden" name="active" value={String(!u.active)} />
              <button type="submit">{u.active ? "Отключить" : "Включить"}</button>
            </form>
          </li>
        ))}
      </ul>
      <h2>Добавить</h2>
      <form action={addStaff} style={{ display: "grid", gap: 8 }}>
        <input name="name" placeholder="Имя" required />
        <input name="login" placeholder="Логин" required />
        <input name="password" type="password" placeholder="Пароль (от 8 символов)" required minLength={8} />
        <select name="role" defaultValue="master">
          <option value="master">Мастер</option>
          <option value="admin">Администратор</option>
        </select>
        <button type="submit">Добавить</button>
      </form>
    </main>
  );
}
