import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/current";
import { AmountError } from "@/lib/money";
import { periodFor, shiftPeriod, todayInBusinessTz } from "@/lib/periods";
import { ValidationError } from "@/lib/errors";
import { adjustPayout, computePayroll, markPaid } from "@/lib/services/payroll";

const fmt = (n: number) => `${n.toLocaleString("ru-RU")} ₸`;

async function payAction(formData: FormData) {
  "use server";
  const admin = await requireUser("admin");
  const start = String(formData.get("start"));
  try {
    await markPaid(admin, String(formData.get("masterId")), periodFor(start));
  } catch (e) {
    if (e instanceof ValidationError) redirect(`/admin/payroll?p=${start}&error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect(`/admin/payroll?p=${start}`);
}

async function adjustAction(formData: FormData) {
  "use server";
  const admin = await requireUser("admin");
  const start = String(formData.get("start"));
  try {
    await adjustPayout(
      admin,
      String(formData.get("masterId")),
      periodFor(start),
      Number(formData.get("adjustment")),
      String(formData.get("reason") ?? ""),
    );
  } catch (e) {
    if (e instanceof ValidationError || e instanceof AmountError) {
      redirect(`/admin/payroll?p=${start}&error=${encodeURIComponent(e.message)}`);
    }
    throw e;
  }
  redirect(`/admin/payroll?p=${start}`);
}

export default async function PayrollPage({ searchParams }: { searchParams: Promise<{ p?: string; error?: string }> }) {
  const admin = await requireUser("admin");
  const sp = await searchParams;
  const period = periodFor(sp.p ?? todayInBusinessTz(new Date()));
  const lines = await computePayroll(admin, period);
  const totals = lines.reduce((t, l) => ({ revenue: t.revenue + l.revenue, final: t.final + l.final }), { revenue: 0, final: 0 });
  const prev = shiftPeriod(period, -1);
  const next = shiftPeriod(period, 1);
  return (
    <main style={{ maxWidth: 520, margin: "0 auto", padding: 16 }}>
      <p><Link href="/admin">← Главная</Link></p>
      <h1>Зарплата</h1>
      <p style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <Link href={`/admin/payroll?p=${prev.start}`}>←</Link>
        <strong>{period.start} — {period.end}</strong>
        <Link href={`/admin/payroll?p=${next.start}`}>→</Link>
      </p>
      {sp.error && <p role="alert">{sp.error}</p>}
      <p>Выручка: {fmt(totals.revenue)} · К выплате мастерам: <strong>{fmt(totals.final)}</strong></p>
      <ul style={{ padding: 0, listStyle: "none", display: "grid", gap: 16 }}>
        {lines.map((l) => (
          <li key={l.masterId} style={{ borderTop: "1px solid #ccc", paddingTop: 8 }}>
            <strong>{l.masterName}</strong> — {l.status === "paid" ? "выплачено" : "ожидает выплаты"}
            <div>Визитов: {l.visitCount} · Выручка: {fmt(l.revenue)}</div>
            <div>Начислено (50%): {fmt(l.calculated)}</div>
            {l.adjustment !== 0 && <div>Корректировка: {fmt(l.adjustment)} ({l.adjustmentReason})</div>}
            <div>К выплате: <strong>{fmt(l.final)}</strong></div>
            {l.status === "pending" && (
              <form action={payAction}>
                <input type="hidden" name="masterId" value={l.masterId} />
                <input type="hidden" name="start" value={period.start} />
                <button type="submit">Выплачено</button>
              </form>
            )}
            <form action={adjustAction} style={{ display: "flex", gap: 6, marginTop: 6 }}>
              <input type="hidden" name="masterId" value={l.masterId} />
              <input type="hidden" name="start" value={period.start} />
              <input name="adjustment" inputMode="numeric" placeholder="± сумма" required style={{ width: 90 }} />
              <input name="reason" placeholder="Причина" required />
              <button type="submit">Корректировка</button>
            </form>
          </li>
        ))}
      </ul>
    </main>
  );
}
