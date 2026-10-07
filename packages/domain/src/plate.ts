/**
 * Rule 1: plates are compared without spaces, dashes or case, so "ab-123-cd" and "AB 123 CD"
 * are the same plate. A foreign plate is stored as typed; only this comparison key is normalised.
 */
export function plateKey(plate: string): string {
  return plate.replace(/[\s-]+/g, '').toUpperCase();
}
