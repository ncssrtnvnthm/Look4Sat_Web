/** N2YO catalog lookup URL for a NORAD catalog number. */
export function noradUrl(catNum: number): string {
  return `https://www.n2yo.com/satellite/?s=${catNum}`;
}
