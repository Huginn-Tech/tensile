// amounts.ts (npm test; node --test): how the transaction page and the blob page write a coin the chain printed. The
// transaction fee in TIA down to the utia, the chain's figure with its digits grouped at any length, and a requested
// amount exact. The module is TypeScript with no runtime import, so the test compiles it with the project's own
// TypeScript.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const load = (file) => {
  const src = readFileSync(new URL(file, import.meta.url), "utf8");
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
};
const { coins, feeTia, exactCoin, shortCoin, tia, blobFee } = await load("./amounts.ts");

// /v1/params price_formula as a chain through app version 11 publishes it, and with what one on app version 12 adds
const THROUGH_11 = { base_gas: 650000, gas_per_chunk: 45000, chunk_bytes: 262144, utia_per_gas: 1, note: "" };
const FROM_12 = { ...THROUGH_11, from_app_version: 12, utia_per_gas_numerator: 4, utia_per_gas_denominator: 1000, rounding: "ceil" };
const KiB = 1024, MiB = 1024 * KiB;

test("tia writes every amount from 0.1 TIA up as it always did", () => {
  assert.equal(tia(null), "—");
  assert.equal(tia(undefined), "—");
  assert.equal(tia(0), "0 TIA");
  // a blob's fee at one utia per gas: 256 KiB, 1 MiB, 16 MiB, 128 MiB
  assert.equal(tia(695000), "0.695 TIA");
  assert.equal(tia(830000), "0.830 TIA");
  assert.equal(tia(3530000), "3.530 TIA");
  assert.equal(tia(23690000), "23.69 TIA");
  assert.equal(tia(100000), "0.100 TIA");
  assert.equal(tia(123400000), "123.4 TIA");
  assert.equal(tia(6000000000), "6,000 TIA");
  assert.equal(tia(695000, { unit: false }), "0.695");
});

test("tia writes an amount under 0.1 TIA down to the utia", () => {
  // a blob's fee at 0.004 utia per gas: 256 KiB, 16 MiB, 128 MiB; three decimals said 0.003, 0.014, 0.095
  assert.equal(tia(2780), "0.00278 TIA");
  assert.equal(tia(14120), "0.01412 TIA");
  assert.equal(tia(94760), "0.09476 TIA");
  assert.equal(tia(2500), "0.0025 TIA");
  assert.equal(tia(-2780), "-0.00278 TIA");
  assert.equal(tia(2780, { unit: false }), "0.00278");
  // an average, not a whole number of utia: to the nearest utia
  assert.equal(tia(740.3125), "0.00074 TIA");
});

test("tia leaves an amount three decimals already said whole as it was", () => {
  assert.equal(tia(50000), "0.050 TIA");
  assert.equal(tia(10000), "0.010 TIA");
  assert.equal(tia(1000), "0.001 TIA");
  assert.equal(tia(-50000), "-0.050 TIA");
  // and one under 0.001 TIA, which was always written to the utia
  assert.equal(tia(800), "0.0008 TIA");
  assert.equal(tia(1), "0.000001 TIA");
});

test("blobFee through app version 11 is the gas at utia_per_gas, as it was", () => {
  assert.equal(blobFee(THROUGH_11, 256 * KiB), 695000);
  assert.equal(blobFee(THROUGH_11, 256 * KiB + 1), 740000);
  assert.equal(blobFee(THROUGH_11, MiB), 830000);
  assert.equal(blobFee(THROUGH_11, 16 * MiB), 3530000);
  assert.equal(blobFee(THROUGH_11, 128 * MiB), 23690000);
});

test("blobFee from app version 12 is the gas at the fraction, rounded up to the whole utia", () => {
  assert.equal(blobFee(FROM_12, 256 * KiB), 2780);
  assert.equal(blobFee(FROM_12, 256 * KiB + 1), 2960);
  assert.equal(blobFee(FROM_12, MiB), 3320);
  assert.equal(blobFee(FROM_12, 16 * MiB), 14120);
  assert.equal(blobFee(FROM_12, 128 * MiB), 94760);
  // an account's average blob is no whole number of bytes
  assert.equal(blobFee(FROM_12, 300000.5), 2960);
  // the round-up, on gas the fraction does not divide: 1, 250 and 251 gas at 4/1000
  const gasOnly = (gas) => ({ ...FROM_12, base_gas: gas, gas_per_chunk: 0 });
  assert.equal(blobFee(gasOnly(1), 1), 1);
  assert.equal(blobFee(gasOnly(250), 1), 1);
  assert.equal(blobFee(gasOnly(251), 1), 2);
});

test("a blob's fee from app version 12 is 250 times smaller and still written whole", () => {
  for (const [size, text] of [[256 * KiB, "0.00278 TIA"], [MiB, "0.00332 TIA"], [16 * MiB, "0.01412 TIA"], [128 * MiB, "0.09476 TIA"]]) {
    assert.equal(blobFee(FROM_12, size) * 250, blobFee(THROUGH_11, size));
    assert.equal(tia(blobFee(FROM_12, size)), text);
  }
});

test("feeTia writes a transaction fee in TIA down to the utia", () => {
  assert.equal(feeTia("8000utia"), "0.008 TIA");
  assert.equal(feeTia("800utia"), "0.0008 TIA");
  assert.equal(feeTia("240utia"), "0.00024 TIA");
  assert.equal(feeTia("1utia"), "0.000001 TIA");
  assert.equal(feeTia("2500000utia"), "2.5 TIA");
});

test("feeTia leaves another denomination as coins() writes it", () => {
  assert.equal(feeTia("1500ufoo"), coins("1500ufoo"));
  assert.equal(feeTia("1500ufoo"), "1,500 ufoo");
  // a utia figure past a Number's exact digits is written as the chain printed it, grouped
  assert.equal(feeTia("1000000000000000utia"), coins("1000000000000000utia"));
});

test("coins groups the chain's figure at any length", () => {
  assert.equal(coins("8000utia"), "8,000 utia");
  assert.equal(coins("800utia"), "800 utia");
  assert.equal(coins("1000000000000000utia"), "1,000,000,000,000,000 utia");
  assert.equal(coins("123456789012345678901utia"), "123,456,789,012,345,678,901 utia");
  assert.equal(coins("8000utia,15ufoo"), "8,000 utia, 15 ufoo");
});

test("coins groups as int() does up to 15 digits", () => {
  for (const n of ["0", "7", "999", "1000", "65432", "1234567", "999999999999999"]) {
    assert.equal(coins(`${n}utia`), `${Number(n).toLocaleString("en-US")} utia`);
  }
});

test("exactCoin writes a requested amount exact, its trailing zeros trimmed", () => {
  assert.equal(exactCoin("1000000000000000utia"), "1,000,000,000 TIA");
  assert.equal(exactCoin("1utia"), "0.000001 TIA");
  assert.equal(exactCoin("0utia"), "0 TIA");
  assert.equal(exactCoin("1500000utia"), "1.5 TIA");
  assert.equal(exactCoin("123456789utia"), "123.456789 TIA");
  assert.equal(exactCoin("5ufoo"), "5 ufoo");
});

test("shortCoin cuts a long hash in a denomination to its first and last four, and leaves the rest as coins() writes it", () => {
  const ibc = "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2";
  assert.equal(shortCoin(`5000000${ibc}`), "5,000,000 ibc/2739…5EB2");
  assert.equal(shortCoin("18446744073709551615hyperlane/0x726f757465725f61707000000000000000000000000000010000000000000000"), "18,446,744,073,709,551,615 hyperlane/0x726f…0000");
  assert.equal(shortCoin("1500ufoo"), coins("1500ufoo"));
  assert.equal(shortCoin("7ibc/ABCD1234"), "7 ibc/ABCD1234");
});
