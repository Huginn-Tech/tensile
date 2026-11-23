/**
 * A coin as the chain printed it ("8000utia", several joined by commas), as the transaction page and the blob page write
 * it; utia as TIA, as every page writes an amount (tia); and the fee of a blob by the module's price formula (blobFee).
 * No runtime import, so amounts.test.mjs loads it on its own; every page takes these from @/lib/api.
 */

/** a digit string with its thousands grouped by commas, exact at any length (a Number is exact to 15 digits only) */
const grouped = (n: string) => n.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** the fee as the chain printed it ("800utia", coins joined by commas), with each amount's digits grouped and a space before its denomination */
export const coins = (fee: string) =>
  fee.split(",").map((c) => c.replace(/^(\d+)(\D.*)$/, (_, n: string, d: string) => `${grouped(n)} ${d}`)).join(", ");

/** utia in TIA down to the utia, its trailing zeros dropped: 2500 is "0.0025", 2500000 "2.5" */
const toTheUtia = (utia: number) => (utia / 1e6).toFixed(6).replace(/\.?0+$/, "");

/**
 * the fee in TIA, as the site writes amounts, but always down to the utia and with no trailing zeros ("2500utia" is
 * 0.0025 TIA, "2500000utia" 2.5 TIA, where tia() writes 2.500): a transaction fee is small and paid exactly; another
 * denomination as coins() prints it
 */
export const feeTia = (fee: string) =>
  fee.split(",").map((c) => {
    const m = /^(\d{1,15})utia$/.exec(c.trim());
    return m ? `${toTheUtia(Number(m[1]))} TIA` : coins(c);
  }).join(", ");

/**
 * an amount under 0.1 TIA, as tia() writes it: down to the utia, the way feeTia writes a transaction fee, so a blob's fee
 * of 2,780 utia is "0.00278" where three decimals said "0.003" and lost it. From 0.001 TIA up it keeps the three
 * decimals tia() always gave there, so an amount they already said whole reads as it did ("0.050", "0.001")
 */
const smallTia = (utia: number) => {
  const s = toTheUtia(utia), dot = s.indexOf(".");
  return Math.abs(utia) >= 1000 && (dot < 0 || s.length - dot - 1 < 3) ? (utia / 1e6).toFixed(3) : s;
};

/**
 * utia as TIA with the precision the size of the figure deserves: a fee is
 * 0.695 TIA, a day is 12.4 TIA, an escrow is 6,000 TIA. Three decimals at most
 * from 0.1 TIA up; below it, down to the utia (smallTia: 0.00278 TIA, 0.0008
 * TIA), so a fee at 0.004 utia per gas keeps its digits, every amount is in TIA
 * and none is a bare "0".
 */
export function tia(utia: number | null | undefined, opts: { unit?: boolean } = {}): string {
  if (utia == null) return "—";
  const v = utia / 1e6;
  let s: string;
  if (v === 0) s = "0";
  else if (Math.abs(v) >= 1000) s = Math.round(v).toLocaleString("en-US");
  else if (Math.abs(v) >= 100) s = v.toFixed(1);
  else if (Math.abs(v) >= 10) s = v.toFixed(2);
  else if (Math.abs(v) >= 0.1) s = v.toFixed(3);
  else s = smallTia(utia);
  return opts.unit === false ? s : `${s} TIA`;
}

/** /v1/params price_formula, as far as a fee needs it (PriceFormula in api.ts) */
type Formula = {
  base_gas: number;
  gas_per_chunk: number;
  chunk_bytes: number;
  utia_per_gas: number;
  utia_per_gas_numerator?: number;
  utia_per_gas_denominator?: number;
};

/**
 * the fee of one blob of this size now, in utia, by the module's price formula. With the fraction a chain on app version
 * 12 publishes it is gas × utia_per_gas_numerator / utia_per_gas_denominator, rounded up to the whole utia; without it,
 * gas × utia_per_gas, as the formula was through app version 11
 */
export function blobFee(f: Formula, size: number): number {
  const gas = f.base_gas + f.gas_per_chunk * Math.ceil(size / f.chunk_bytes);
  return f.utia_per_gas_numerator != null && f.utia_per_gas_denominator ? Math.ceil((gas * f.utia_per_gas_numerator) / f.utia_per_gas_denominator) : gas * f.utia_per_gas;
}

/**
 * an amount the chain printed, exact, its trailing zeros trimmed: "1,000,000,000 TIA", "0.000001 TIA"; never rounded to a
 * page's precision, so a request of 1 utia never reads "0.000 TIA". A coin that is not utia stays as coins() gives it.
 */
export function exactCoin(c: string): string {
  const m = /^(\d+)utia$/.exec(c.trim());
  if (!m) return coins(c);
  const s = m[1].replace(/^0+(?=\d)/, "");
  const whole = s.length > 6 ? s.slice(0, -6) : "0";
  const frac = s.padStart(6, "0").slice(-6).replace(/0+$/, "");
  return `${grouped(whole)}${frac ? `.${frac}` : ""} TIA`;
}

/**
 * a coin of another denomination in a list's amount column, which an escrow can be held in: as coins() writes it, a long
 * hash in its denomination cut to its first and last four ("5,000,000 ibc/2739…5EB2"); the whole coin goes on hover
 */
export const shortCoin = (c: string) =>
  coins(c).replace(/\/(0x)?([0-9a-f]{4})[0-9a-f]{8,}([0-9a-f]{4})\b/gi, (_, x: string | undefined, a: string, b: string) => `/${x ?? ""}${a}…${b}`);
