export type Cx = { re: number; im: number };

export const cx = (re: number, im = 0): Cx => ({ re, im });

export const add = (a: Cx, b: Cx): Cx => ({ re: a.re + b.re, im: a.im + b.im });
export const sub = (a: Cx, b: Cx): Cx => ({ re: a.re - b.re, im: a.im - b.im });
export const mul = (a: Cx, b: Cx): Cx => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
export const div = (a: Cx, b: Cx): Cx => {
  const d = b.re * b.re + b.im * b.im;
  if (d === 0) return { re: NaN, im: NaN };
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
};
export const abs = (a: Cx): number => Math.hypot(a.re, a.im);
export const conj = (a: Cx): Cx => ({ re: a.re, im: -a.im });

export const isFiniteCx = (a: Cx) => Number.isFinite(a.re) && Number.isFinite(a.im);

export function fmtCx(a: Cx, digits = 6): string {
  const r = round(a.re, digits);
  const i = round(a.im, digits);
  if (!Number.isFinite(r) || !Number.isFinite(i)) return "—";
  if (Math.abs(i) < 1e-12) return `${r}`;
  if (Math.abs(r) < 1e-12) return `${i}i`;
  return i >= 0 ? `${r}+${i}i` : `${r}${i}i`;
}

function round(v: number, digits: number) {
  const s = Math.pow(10, digits);
  return Math.round(v * s) / s;
}

/** 解析數字：支援 k, M, m, u, n, p 前綴，及複數 a+bi / a-bi / bi / a */
export function parseCx(input: string): Cx | null {
  const s0 = (input ?? "").trim().replace(/\s+/g, "");
  if (!s0) return null;

  // allow j as i
  const s = s0.replace(/j/gi, "i");

  // helper parse real with suffix
  const parseReal = (t: string): number | null => {
    if (!t) return null;
    const m = t.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)([kKmMuUnNpP]|M)?$/);
    if (!m) return null;
    let val = Number(m[1]);
    if (!Number.isFinite(val)) return null;
    const suf = m[2] ?? "";
    const mulMap: Record<string, number> = {
      "p": 1e-12, "P": 1e-12,
      "n": 1e-9, "N": 1e-9,
      "u": 1e-6, "U": 1e-6,
      "m": 1e-3,
      "k": 1e3, "K": 1e3,
      "M": 1e6, // mega
    };
    if (suf) val *= (mulMap[suf] ?? 1);
    return val;
  };

  // If no i -> pure real
  if (!s.includes("i")) {
    const r = parseReal(s);
    return r === null ? null : { re: r, im: 0 };
  }

  // Handle forms: a+bi, a-bi
  // Normalize: split by last '+' or '-' that is not leading and not exponent
  // We'll look for pattern: (realPart)?(sign imagPart)?i
  if (s === "i") return { re: 0, im: 1 };
  if (s === "+i") return { re: 0, im: 1 };
  if (s === "-i") return { re: 0, im: -1 };

  const m = s.match(/^(.+)?([+-])(.+)i$/);
  if (m) {
    const realStr = m[1] ?? "";
    const sign = m[2];
    const imagStr = m[3];
    const reVal = realStr ? parseReal(realStr) : 0;
    const imVal0 = imagStr ? parseReal(imagStr) : 1;
    if (reVal === null || imVal0 === null) return null;
    const imVal = sign === "-" ? -imVal0 : imVal0;
    return { re: reVal, im: imVal };
  }

  // Maybe pure imag like 2i or 2.2ki
  const m2 = s.match(/^(.+)i$/);
  if (m2) {
    const imVal = parseReal(m2[1]);
    if (imVal === null) return null;
    return { re: 0, im: imVal };
  }

  return null;
}
