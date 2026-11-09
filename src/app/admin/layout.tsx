import Link from "next/link";
import { Nav } from "@/components/Nav";

const ITEMS = [
  { href: "/admin", label: "Главная" },
  { href: "/admin/visits/new", label: "Новый визит" },
  { href: "/admin/masters", label: "Мастера" },
  { href: "/admin/services", label: "Услуги" },
  { href: "/admin/payroll", label: "Зарплата" },
  { href: "/admin/clients", label: "Клиенты" },
  { href: "/admin/staff", label: "Сотрудники" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="shell">
      <aside className="sidebar">
        <Link href="/admin" className="brand">
          <span className="script">Lash Golden</span>
          <small>beauty studio</small>
        </Link>
        <Nav items={ITEMS} />
        <form method="POST" action="/api/auth/logout">
          <button type="submit" className="ghost">Выйти</button>
        </form>
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}
