import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/current";

const LABEL: Record<string, string> = {
  "visit.create": "Визит записан",
  "visit.schedule": "Запись на будущее",
  "visit.complete": "Отмечено выполненным",
  "visit.cancel": "Запись отменена",
  "visit.move": "Запись перенесена",
  "visit.update": "Запись изменена",
  "visit.adjust": "Сумма визита исправлена",
  "payout.paid": "Выплата отмечена",
  "payout.adjust": "Корректировка выплаты",
  "day.close": "День закрыт",
  "day.reopen": "День открыт заново",
  "dayoff.add": "Выходные добавлены",
  "dayoff.remove": "Выходной удалён",
};

export default async function AuditPage() {
  await requireUser("admin");
  const rows = await prisma.auditLog.findMany({ orderBy: { at: "desc" }, take: 200 });
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.actorId))] } }, select: { id: true, name: true } });
  const name = (id: string) => users.find((u) => u.id === id)?.name ?? "—";
  return (
    <>
      <h1>Журнал изменений</h1>
      <p className="sub">Последние 200 действий: кто, что и когда изменил</p>
      <div className="card cal-scroll">
        <table>
          <thead><tr><th>Когда</th><th>Кто</th><th>Что</th><th>Подробности</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={{ whiteSpace: "nowrap" }}>{r.at.toLocaleString("ru-RU", { timeZone: "Asia/Almaty", dateStyle: "short", timeStyle: "short" })}</td>
                <td>{name(r.actorId)}</td>
                <td>{LABEL[r.action] ?? r.action}</td>
                <td className="muted">{r.details}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={4} className="muted">Пока пусто</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
