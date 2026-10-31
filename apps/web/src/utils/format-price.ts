const formatter = new Intl.NumberFormat("es-EC", {
  style: "currency",
  currency: "USD",
});
export function formatPrice(priceMinor: number): string {
  return formatter.format(priceMinor / 100);
}
