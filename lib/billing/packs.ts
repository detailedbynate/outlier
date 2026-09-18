/** Credit packs for sale. Prices are in US cents; bought credits never expire. */
export interface CreditPack {
  id: string;
  credits: number;
  priceCents: number;
  label: string;
}

export const CREDIT_PACKS: readonly CreditPack[] = [
  { id: "small", credits: 200, priceCents: 500, label: "Top-up" },
  { id: "medium", credits: 600, priceCents: 1_200, label: "Popular" },
  { id: "large", credits: 2_000, priceCents: 3_000, label: "Best value" },
];

export function findPack(id: string | null | undefined): CreditPack | null {
  return CREDIT_PACKS.find((pack) => pack.id === id) ?? null;
}

export function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}
