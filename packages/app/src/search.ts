/** Lower case and without accents, for a search that forgives both. */
export function searchable(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}
