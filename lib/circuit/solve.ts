// lib/circuit/solve.ts
// MNA solver (DC / AC phasor) for R/C/L/V/I/GND
//
// Conventions (IMPORTANT):
// - Node voltages are with respect to gnd (if present).
// - Voltage source element "V": Va - Vb = value  (a = +, b = -)
// - Current source element "I": current flows a -> b with value I.
//   In nodal RHS (current injection convention), that means:
//     node a gets injected current = -I
//     node b gets injected current = +I
//   (i.e., current leaves node a and enters node b)
//
// This file also generates solveSteps/debugCx used by the right panel.

import type { CircuitNet, SolveResult } from "./types";
import { fmtCx, parseCx } from "./complex";

// -------------------- Complex helpers --------------------
type Cx = { re: number; im: number };
const cx = (re = 0, im = 0): Cx => ({ re, im });
const cadd = (a: Cx, b: Cx): Cx => ({ re: a.re + b.re, im: a.im + b.im });
const csub = (a: Cx, b: Cx): Cx => ({ re: a.re - b.re, im: a.im - b.im });
const cneg = (a: Cx): Cx => ({ re: -a.re, im: -a.im });
const cmul = (a: Cx, b: Cx): Cx => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
const cconj = (a: Cx): Cx => ({ re: a.re, im: -a.im });
const cabs2 = (a: Cx): number => a.re * a.re + a.im * a.im;
const cabs = (a: Cx): number => Math.hypot(a.re, a.im);

const cdiv = (a: Cx, b: Cx): Cx => {
  const d = cabs2(b);
  if (d === 0) return { re: NaN, im: NaN };
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
};

// 1 / a
const cinv = (a: Cx): Cx => cdiv(cx(1, 0), a);

// -------------------- Parsing helpers --------------------
// SI suffix parsing for real numbers (R in ohm, C in F, L in H, V in volts, I in amps)
function parseRealWithSI(raw: string): number {
  const s = String(raw ?? "").trim();
  if (!s) return NaN;

  // Allow things like "1k", "10m", "1u", "2.2n", "1meg"
  const m = s.match(/^([+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s*([a-zA-Z]+)?$/);
  if (!m) return NaN;

  const base = Number(m[1]);
  if (!Number.isFinite(base)) return NaN;

  const suf = (m[2] ?? "").toLowerCase();

  const mult =
    suf === "" ? 1 :
    suf === "k" ? 1e3 :
    suf === "m" ? 1e-3 :   // milli
    suf === "u" ? 1e-6 :
    suf === "n" ? 1e-9 :
    suf === "p" ? 1e-12 :
    suf === "meg" ? 1e6 :
    suf === "g" ? 1e9 :
    NaN;

  if (!Number.isFinite(mult)) return NaN;
  return base * mult;
}

function looksComplex(s: string): boolean {
  const t = s.trim().toLowerCase();
  // contains 'j' or '+'/'-' beyond leading sign
  if (t.includes("j")) return true;
  // allow "a+b" forms without j? no, keep strict; complex without j is ambiguous
  return false;
}

// NOTE: parseCx() returns Cx | null (from ./complex). We must guard null here to satisfy TS builds.
function parseValueAsCx(raw: string): Cx {
  const s = String(raw ?? "").trim();
  if (!s) return cx(NaN, NaN);

  if (looksComplex(s)) {
    // parseCx supports forms like "1000+200j", "-2j", "3.5", "1e-3+2j"
    const z = parseCx(s);
    return z ?? cx(NaN, NaN);
  }
  const r = parseRealWithSI(s);
  return cx(r, 0);
}

// Interpret element value into impedance Z for R/C/L.
// - For R: if "a+bj" treat as Z directly; else parse as ohms.
// - For C: if complex => treat as impedance Z directly; else parse capacitance C(F) then Z=1/(jωC)
// - For L: if complex => treat as impedance Z directly; else parse inductance L(H) then Z=jωL
function elementImpedance(type: "R" | "C" | "L", value: string, freqHz: number): Cx {
  const s = String(value ?? "").trim();
  const w = 2 * Math.PI * Math.max(0, freqHz);

  if (type === "R") {
    const Z = parseValueAsCx(s);
    return Z;
  }

  if (looksComplex(s)) {
    // user directly inputs impedance, e.g. "-2j"
    const Z = parseCx(s);
    return Z ?? cx(NaN, NaN);
  }

  const x = parseRealWithSI(s);
  if (!Number.isFinite(x)) return cx(NaN, NaN);

  if (type === "C") {
    if (w === 0) {
      // DC capacitor: open circuit -> huge impedance
      return cx(1e18, 0);
    }
    // Z = 1 / (j w C) = -j / (w C)
    return cx(0, -1 / (w * x));
  }

  // L
  if (w === 0) {
    // DC inductor: short circuit -> ~0 impedance
    return cx(1e-12, 0); // tiny, avoid singular blow-ups
  }
  // Z = j w L
  return cx(0, w * x);
}

// -------------------- Matrix helpers --------------------
function makeMat(n: number): Cx[][] {
  const A: Cx[][] = [];
  for (let i = 0; i < n; i++) {
    const row: Cx[] = [];
    for (let j = 0; j < n; j++) row.push(cx(0, 0));
    A.push(row);
  }
  return A;
}
function makeVec(n: number): Cx[] {
  return Array.from({ length: n }, () => cx(0, 0));
}

function addTo(A: Cx[][], i: number, j: number, v: Cx) {
  A[i][j] = cadd(A[i][j], v);
}
function addToZ(z: Cx[], i: number, v: Cx) {
  z[i] = cadd(z[i], v);
}

// Pretty dump for debug
function fmtMat(A: Cx[][]): string[][] {
  return A.map((row) => row.map((v) => fmtCx(v)));
}
function fmtVec(z: Cx[]): string[] {
  return z.map((v) => fmtCx(v));
}

// -------------------- Complex Gaussian elimination --------------------
function solveLinear(Ain: Cx[][], zin: Cx[]): { ok: boolean; x?: Cx[]; error?: string } {
  const n = Ain.length;
  const A = Ain.map((r) => r.map((v) => ({ ...v })));
  const z = zin.map((v) => ({ ...v }));

  // forward elimination with partial pivoting
  for (let k = 0; k < n; k++) {
    // pick pivot row
    let piv = k;
    let best = cabs2(A[k][k]);
    for (let i = k + 1; i < n; i++) {
      const v = cabs2(A[i][k]);
      if (v > best) {
        best = v;
        piv = i;
      }
    }
    if (best === 0 || !Number.isFinite(best)) {
      return { ok: false, error: "Singular matrix (no pivot). Check ground / floating nodes / shorted voltage sources." };
    }
    if (piv !== k) {
      [A[k], A[piv]] = [A[piv], A[k]];
      [z[k], z[piv]] = [z[piv], z[k]];
    }

    const Akk = A[k][k];
    // eliminate below
    for (let i = k + 1; i < n; i++) {
      const factor = cdiv(A[i][k], Akk);
      if (cabs2(factor) === 0) continue;
      // row_i = row_i - factor * row_k
      for (let j = k; j < n; j++) {
        A[i][j] = csub(A[i][j], cmul(factor, A[k][j]));
      }
      z[i] = csub(z[i], cmul(factor, z[k]));
    }
  }

  // back substitution
  const x = makeVec(n);
  for (let i = n - 1; i >= 0; i--) {
    let sum = cx(0, 0);
    for (let j = i + 1; j < n; j++) sum = cadd(sum, cmul(A[i][j], x[j]));
    x[i] = cdiv(csub(z[i], sum), A[i][i]);
  }
  return { ok: true, x };
}

// -------------------- Main solver --------------------
export function solveMNA(net: CircuitNet, freqHz: number): SolveResult {
  try {
    if (!net?.nodes?.length) return { ok: false, error: "No nodes in net." };
    if (!net.hasGround) return { ok: false, error: "奇異矩陣：可能缺少接地（GND）。" };

    const nodeIds = net.nodes.map((n) => n.id).filter((id) => id !== "gnd");
    const nodeIndex = new Map<string, number>();
    nodeIds.forEach((id, idx) => nodeIndex.set(id, idx));

    const vsrc = net.elements.filter((e) => e.type === "V");
    const vsrcOrder = vsrc.map((e) => e.id);

    const N = nodeIds.length;
    const M = vsrcOrder.length;
    const dim = N + M;

    const A = makeMat(dim);
    const z = makeVec(dim);

    const steps: SolveResult["solveSteps"] = [];

    // ---- Step 1: reference & unknowns ----
    steps.push({
      kind: "intro",
      title: "Step 1｜建立參考點與未知量",
      lines: [
        `參考點：gnd（0V）`,
        `未知節點電壓：${nodeIds.length ? nodeIds.map((id) => `V(${id})`).join(", ") : "（無）"}`,
        `電壓源支路電流未知量：${vsrcOrder.length ? vsrcOrder.map((id) => `I(${id})`).join(", ") : "（無）"}`,
      ],
    });

    // ---- Step 2: convert elements ----
    const elemLines: string[] = [];
    elemLines.push(`頻率 f = ${freqHz} Hz`);
    elemLines.push(`ω = 2πf = ${(2 * Math.PI * Math.max(0, freqHz)).toFixed(6)}`);

    for (const e of net.elements) {
      if (e.type === "R" || e.type === "C" || e.type === "L") {
        const Z = elementImpedance(e.type, e.value ?? "", freqHz);
        const Y = cinv(Z);
        elemLines.push(`${e.name} (${e.type})：Z = ${fmtCx(Z)} Ω，Y = 1/Z = ${fmtCx(Y)} S`);
      } else if (e.type === "V") {
        const V = parseValueAsCx(e.value ?? "");
        elemLines.push(`${e.name} (V)：Va - Vb = ${fmtCx(V)} V`);
      } else if (e.type === "I") {
        const I = parseValueAsCx(e.value ?? "");
        elemLines.push(`${e.name} (I)：I(a→b) = ${fmtCx(I)} A`);
      } else if (e.type === "GND") {
        elemLines.push(`${e.name} (GND)`);
      }
    }

    steps.push({
      kind: "elements",
      title: "Step 2｜把元件轉成方程（阻抗/導納/源）",
      lines: elemLines,
    });

    // ---- Stamp passive admittances ----
    const kclLines: string[] = [];
    const kvlLines: string[] = [];

    // For convenience: function to get node variable index (or null if gnd)
    const idxV = (nid?: string): number | null => {
      if (!nid || nid === "gnd") return null;
      const i = nodeIndex.get(nid);
      return typeof i === "number" ? i : null;
    };

    // Passive stamps & current sources into RHS
    for (const e of net.elements) {
      if (e.type === "R" || e.type === "C" || e.type === "L") {
        const ia = idxV(e.a);
        const ib = idxV(e.b);
        const Z = elementImpedance(e.type, e.value ?? "", freqHz);
        const Y = cinv(Z);

        // stamp Y between nodes a and b
        if (ia !== null) addTo(A, ia, ia, Y);
        if (ib !== null) addTo(A, ib, ib, Y);
        if (ia !== null && ib !== null) {
          addTo(A, ia, ib, cneg(Y));
          addTo(A, ib, ia, cneg(Y));
        }
      }

      if (e.type === "I") {
        const ia = idxV(e.a);
        const ib = idxV(e.b);
        const I = parseValueAsCx(e.value ?? "");

        // Injection convention:
        // current source a->b means current LEAVES node a and ENTERS node b,
        // therefore injected current at a is -I, at b is +I.
        if (ia !== null) addToZ(z, ia, cneg(I));
        if (ib !== null) addToZ(z, ib, I);
      }
    }

    // ---- Stamp voltage sources (MNA) ----
    const vsrcIndex = new Map<string, number>();
    vsrcOrder.forEach((id, k) => vsrcIndex.set(id, k));

    for (const e of vsrc) {
      const k = vsrcIndex.get(e.id)!;
      const row = N + k;

      const ia = idxV(e.a);
      const ib = idxV(e.b);
      const V = parseValueAsCx(e.value ?? "");

      // KCL coupling (B matrix):
      // node a: +I(vsrc)
      // node b: -I(vsrc)
      if (ia !== null) {
        addTo(A, ia, row, cx(1, 0));
        addTo(A, row, ia, cx(1, 0));
      }
      if (ib !== null) {
        addTo(A, ib, row, cx(-1, 0));
        addTo(A, row, ib, cx(-1, 0));
      }

      // KVL constraint row:
      // Va - Vb = V
      addToZ(z, row, V);

      kvlLines.push(`KVL(${e.id})：1·V(${e.a}) + (-1)·V(${e.b}) = ${fmtCx(V)}  （Va−Vb=V）`);
    }

    // ---- Build readable KCL equations (symbolic-ish) ----
    // We only create simple KCL summaries here (not full expanded stamps for each element),
    // matching your current UI expectation.
    for (const nid of nodeIds) {
      // show row as Σ A[row,j] x_j = z[row]
      const i = nodeIndex.get(nid)!;
      const terms: string[] = [];
      // node voltages terms
      for (let j = 0; j < N; j++) {
        const c = A[i][j];
        if (cabs2(c) === 0) continue;
        terms.push(`${fmtCx(c)}·V(${nodeIds[j]})`);
      }
      // vsrc currents terms
      for (let k = 0; k < M; k++) {
        const c = A[i][N + k];
        if (cabs2(c) === 0) continue;
        terms.push(`${fmtCx(c)}·I(${vsrcOrder[k]})`);
      }
      const rhs = z[i];
      kclLines.push(`KCL(${nid})：${terms.join(" + ")} = ${fmtCx(rhs)}`);
    }

    steps.push({
      kind: "kcl",
      title: "Step 3｜列出每個非接地節點的 KCL 方程",
      note: "以下方程是 MNA 實際求解的節點方程（與程式矩陣完全一致）。",
      lines: kclLines.length ? kclLines : ["（無 KCL 方程）"],
    });

    steps.push({
      kind: "kvl",
      title: "Step 4｜列出每個電壓源的 KVL 約束方程",
      note: "每個獨立電壓源會新增一條 Va−Vb=V 的約束式，並引入一個電壓源電流未知量。",
      lines: kvlLines.length ? kvlLines : ["（無電壓源）"],
    });

    steps.push({
      kind: "matrix",
      title: "Step 5｜整理成矩陣形式 Ax = z",
      lines: [
        `未知向量 x = [${nodeIds.map((id) => `V(${id})`).concat(vsrcOrder.map((id) => `I(${id})`)).join(", ")}]^T`,
        `矩陣 A 維度：${dim}×${dim}`,
      ],
    });

    // ---- Solve ----
    const solved = solveLinear(A, z);
    if (!solved.ok || !solved.x) {
      return { ok: false, error: solved.error ?? "Solve failed.", solveSteps: steps };
    }
    const x = solved.x;

    // ---- Extract node voltages ----
    const nodeVoltages: Record<string, Cx> = {};
    for (let i = 0; i < N; i++) nodeVoltages[nodeIds[i]] = x[i];
    nodeVoltages["gnd"] = cx(0, 0);

    // ---- Extract vsrc currents ----
    const vsrcCurrents: Record<string, Cx> = {};
    for (let k = 0; k < M; k++) vsrcCurrents[vsrcOrder[k]] = x[N + k];

    // ---- Element V/I/S ----
    const elementVoltages: Record<string, Cx> = {};
    const elementCurrents: Record<string, Cx> = {};
    const elementPowers: Record<string, Cx> = {};

    const Vof = (nid?: string): Cx => {
      if (!nid || nid === "gnd") return cx(0, 0);
      return nodeVoltages[nid] ?? cx(0, 0);
    };

    for (const e of net.elements) {
      if (e.type === "GND") {
        elementVoltages[e.id] = cx(0, 0);
        elementCurrents[e.id] = cx(0, 0);
        elementPowers[e.id] = cx(0, 0);
        continue;
      }

      const Va = Vof(e.a);
      const Vb = Vof(e.b);
      const Vab = csub(Va, Vb);
      elementVoltages[e.id] = Vab;

      if (e.type === "V") {
        const I = vsrcCurrents[e.id] ?? cx(0, 0);
        elementCurrents[e.id] = I;
        // S = V * conj(I) (RMS convention)
        elementPowers[e.id] = cmul(Vab, cconj(I));
      } else if (e.type === "I") {
        const I = parseValueAsCx(e.value ?? "");
        elementCurrents[e.id] = I;
        elementPowers[e.id] = cmul(Vab, cconj(I));
      } else {
        // R/C/L
        const Z = elementImpedance(e.type, e.value ?? "", freqHz);
        const I = cdiv(Vab, Z);
        elementCurrents[e.id] = I;
        elementPowers[e.id] = cmul(Vab, cconj(I));
      }
    }

    // ---- Step 6: solution listing ----
    const solLines: string[] = [];
    for (const nid of nodeIds) solLines.push(`V(${nid}) = ${fmtCx(nodeVoltages[nid])}`);
    for (const vid of vsrcOrder) solLines.push(`I(${vid}) = ${fmtCx(vsrcCurrents[vid] ?? cx(0, 0))}`);

    steps.push({
      kind: "solve",
      title: "Step 6｜解線性方程得到未知量",
      note: "用高斯消去法解出 x（節點電壓與電壓源電流）。",
      lines: solLines,
    });

    // ---- Debug dump ----
    const unknownOrder = nodeIds.map((id) => `V(${id})`).concat(vsrcOrder.map((id) => `I(${id})`));
    const debugCx = {
      nodeOrder: nodeIds,
      vsrcOrder,
      unknownOrder,
      A: fmtMat(A),
      z: fmtVec(z),
      x: fmtVec(x),
    };

    return {
      ok: true,
      nodeVoltages,
      elementVoltages,
      elementCurrents,
      elementPowers,
      solveSteps: steps,
      debugCx,
    };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "Unknown error in solveMNA()" };
  }
}