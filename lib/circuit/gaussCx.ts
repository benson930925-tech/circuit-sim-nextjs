import type { Cx } from "./complex";
import { abs, div, mul, sub, cx, isFiniteCx } from "./complex";

export function solveLinearSystemCx(Ain: Cx[][], bin: Cx[]): { ok: true; x: Cx[] } | { ok: false; error: string } {
  const n = Ain.length;
  if (n === 0) return { ok: false, error: "Empty system" };
  const m = Ain[0].length;
  if (m !== n) return { ok: false, error: "Matrix is not square" };
  if (bin.length !== n) return { ok: false, error: "Vector size mismatch" };

  const A: Cx[][] = Ain.map(row => row.map(v => ({...v})));
  const b: Cx[] = bin.map(v => ({...v}));

  const EPS = 1e-14;

  for (let col = 0; col < n; col++) {
    // pivot
    let pivotRow = col;
    let best = abs(A[col][col]);
    for (let r = col + 1; r < n; r++) {
      const v = abs(A[r][col]);
      if (v > best) { best = v; pivotRow = r; }
    }
    if (best < EPS) return { ok: false, error: "奇異矩陣：可能缺少接地、浮接節點，或理想電壓源約束互相衝突。" };

    if (pivotRow !== col) {
      const tmp = A[col]; A[col] = A[pivotRow]; A[pivotRow] = tmp;
      const tb = b[col]; b[col] = b[pivotRow]; b[pivotRow] = tb;
    }

    const pivot = A[col][col];

    // normalize row
    for (let c = col; c < n; c++) A[col][c] = div(A[col][c], pivot);
    b[col] = div(b[col], pivot);

    // eliminate
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = A[r][col];
      if (abs(factor) < EPS) continue;
      for (let c = col; c < n; c++) {
        A[r][c] = sub(A[r][c], mul(factor, A[col][c]));
      }
      b[r] = sub(b[r], mul(factor, b[col]));
    }
  }

  // b is solution now
  if (b.some(v => !isFiniteCx(v))) return { ok: false, error: "求解結果非有限值（可能有 0Ω / 0H / 0F 或 ω=0 的短路模型問題）。" };
  return { ok: true, x: b };
}
