const n = (v: number) => v.toLocaleString("ru-RU");

export function formatPrice(p: { priceMin: number; priceMax: number | null; openEnded: boolean }): string {
  if (p.priceMax != null) return `${n(p.priceMin)}–${n(p.priceMax)} ₸`;
  if (p.openEnded) return `от ${n(p.priceMin)} ₸`;
  return `${n(p.priceMin)} ₸`;
}
