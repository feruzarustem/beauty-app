import Link from "next/link";
import { redirect } from "next/navigation";
import { createMyVisit, masterClients, masterEarnings, masterServices, masterVisits } from "@/lib/access/master";
import { ServiceAmount } from "@/components/ServiceAmount";
import { DuplicateWarning, PeriodPaidError, ValidationError } from "@/lib/errors";
import { AmountError } from "@/lib/money";
import { requireUser } from "@/lib/auth/current";
import { periodFor, shiftPeriod, todayInBusinessTz } from "@/lib/periods";

const fmt = (n: number) => `${n.toLocaleString("ru-RU")} ₸`;

type SP = { p?: string; error?: string; dup?: string; client?: string; amount?: string; method?: string };

async function addMyVisit(formData: FormData) {
  "use server";
  const me = await requireUser("master");
  const f = (k: string) => String(formData.get(k) ?? "");
  const keep = new URLSearchParams({ client: f("client"), amount: f("amount"), method: f("method") });
  try {
    await createMyVisit(me, {
      clientName: f("client"),
      amount: f("amount"),
      paymentMethod: f("method") === "transfer" ? "transfer" : "cash",
      confirmDuplicate: formData.get("confirmDuplicate") === "on",
    });
  } catch (e) {
    if (e instanceof DuplicateWarning) {
      keep.set("dup", "1");
      redirect(`/master?${keep}`);
    }
    if (e instanceof AmountError || e instanceof ValidationError || e instanceof PeriodPaidError) {
      keep.set("error", e.message);
      redirect(`/master?${keep}`);
    }
    throw e;
  }
  redirect("/master");
}

export default async function MasterHome({ searchParams }: { searchParams: Promise<SP> }) {
  const me = await requireUser("master");
  const sp = await searchParams;
  const period = periodFor(sp.p ?? todayInBusinessTz(new Date()));
  const [visits, earn, services, clients] = await Promise.all([
    masterVisits(me, period),
    masterEarnings(me, period),
    masterServices(me),
    masterClients(me),
  ]);
  const prev = shiftPeriod(period, -1);
  const next = shiftPeriod(period, 1);
  return (
    <>
      <header className="topbar-solo">
        <span className="script">Lash Golden</span>
      </header>
      <main className="content" style={{ margin: "0 auto" }}>
        <h1>Мои визиты</h1>
        <h2 style={{ marginTop: 8 }}>Записать визит</h2>
        <p className="sub">В конце процедуры укажите итоговую сумму, которую заплатила клиентка</p>
        {sp.error && <p role="alert" className="alert">{sp.error}</p>}
        {sp.dup && (
          <p role="alert" className="alert">
            Похоже, такой визит уже записан. Если это другой визит, отметьте галочку и сохраните ещё раз.
          </p>
        )}
        <form action={addMyVisit} className="stack card" style={{ marginBottom: 28 }}>
          <input name="client" list="my-clients" placeholder="Клиентка (имя)" defaultValue={sp.client ?? ""} required />
          <datalist id="my-clients">
            {clients.map((c) => (
              <option key={c.id} value={c.name} />
            ))}
          </datalist>
          <ServiceAmount
            services={services.map((s) => ({ ...s, label: s.groupName }))}
            defaultAmount={sp.amount}
          />
          <select name="method" defaultValue={sp.method ?? "cash"}>
            <option value="cash">Наличные</option>
            <option value="transfer">Перевод</option>
          </select>
          {sp.dup && (
            <label>
              <input type="checkbox" name="confirmDuplicate" /> Это другой визит
            </label>
          )}
          <button type="submit">Сохранить визит</button>
        </form>
        <h2>Визиты за период</h2>
        <div className="period">
          <Link href={`/master?p=${prev.start}`} aria-label="Предыдущий период">←</Link>
          <strong>{period.start} — {period.end}</strong>
          <Link href={`/master?p=${next.start}`} aria-label="Следующий период">→</Link>
        </div>
        <div className="card stat" style={{ marginBottom: 20 }}>
          <div className="label">Мой заработок за период</div>
          <div className="value">{fmt(earn.final)}</div>
          <span className={earn.status === "paid" ? "pill paid" : "pill"}>
            {earn.status === "paid" ? "выплачено" : "ожидает выплаты"}
          </span>
          {earn.adjustment !== 0 && <p className="muted">В том числе корректировка: {fmt(earn.adjustment)}</p>}
        </div>
        <div className="card">
          <table>
            <thead>
              <tr><th>Дата</th><th>Клиент</th><th className="num">Сумма</th><th className="num">Мне</th></tr>
            </thead>
            <tbody>
              {visits.map((v) => (
                <tr key={v.id}>
                  <td>{v.visitDate}</td>
                  <td>{v.clientName ?? "—"}</td>
                  <td className="num">{fmt(v.amount)}</td>
                  <td className="num">{fmt(v.myShare)}</td>
                </tr>
              ))}
              {visits.length === 0 && (
                <tr><td colSpan={4} className="muted">В этом периоде визитов нет</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <form method="POST" action="/api/auth/logout" style={{ marginTop: 24 }}>
          <button type="submit" className="ghost">Выйти</button>
        </form>
      </main>
    </>
  );
}
