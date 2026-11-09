import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/current";
import { createUser, setUserActive } from "@/lib/services/users";
import { CATEGORY_INFO, CATEGORY_ORDER } from "@/lib/categories";

async function addStaff(formData: FormData) {
  "use server";
  const actor = await requireUser("admin");
  await createUser(actor, {
    name: String(formData.get("name") ?? ""),
    login: String(formData.get("login") ?? ""),
    password: String(formData.get("password") ?? ""),
    role: formData.get("role") === "admin" ? "admin" : "master",
    category: CATEGORY_ORDER.find((c) => c === formData.get("category")),
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
    <>
      <h1>Сотрудники</h1>
      <p className="sub">Доступ к системе и роли</p>
      <ul className="list">
        {users.map((u) => (
          <li key={u.id} className="card row">
            <span>
              <strong>{u.name}</strong>{" "}
              <span className="muted">
                {u.role === "admin" ? "администратор" : u.category ? CATEGORY_INFO[u.category].title : "мастер"}
                {u.active ? "" : " · отключён"}
              </span>
            </span>
            <form action={toggleActive}>
              <input type="hidden" name="id" value={u.id} />
              <input type="hidden" name="active" value={String(!u.active)} />
              <button type="submit" className="ghost">{u.active ? "Отключить" : "Включить"}</button>
            </form>
          </li>
        ))}
      </ul>
      <h2>Добавить сотрудника</h2>
      <form action={addStaff} className="stack">
        <input name="name" placeholder="Имя" required />
        <input name="login" placeholder="Логин" required />
        <input name="password" type="password" placeholder="Пароль (от 8 символов)" required minLength={8} />
        <select name="role" defaultValue="master">
          <option value="master">Мастер</option>
          <option value="admin">Администратор</option>
        </select>
        <select name="category" defaultValue="lash">
          {CATEGORY_ORDER.map((c) => (
            <option key={c} value={c}>{CATEGORY_INFO[c].title}</option>
          ))}
        </select>
        <button type="submit">Добавить</button>
      </form>
    </>
  );
}
