export function solveLinearSystem(Ain: number[][], bin: number[]): { ok: true; x: number[] } | { ok: false; error: string } {
  const n = Ain.length;
  if (n === 0) return { ok: false, error: "Empty system" };
  const m = Ain[0].length;
  if (m !== n) return { ok: false, error: "Matrix is not square" };
  if (bin.length !== n) return { ok: false, error: "Vector size mismatch" };

  // Deep copy
  const A = Ain.map(row => row.slice());
  const b = bin.slice();

  const EPS = 1e-12;

  for (let col = 0; col < n; col++) {
    // partial pivot
    let pivotRow = col;
    let best = Math.abs(A[col][col]);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(A[r][col]);
      if (v > best) { best = v; pivotRow = r; }
    }
    if (best < EPS) {
      return { ok: false, error: "Singular matrix (circuit constraints conflict or floating nodes)." };
    }
    if (pivotRow !== col) {
      [A[col], A[pivotRow]] = [A[pivotRow], A[col]];
      [b[col], b[pivotRow]] = [b[pivotRow], b[col]];
    }

    const pivot = A[col][col];
    // normalize row
    for (let c = col; c < n; c++) A[col][c] /= pivot;
    b[col] /= pivot;

    // eliminate
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = A[r][col];
      if (Math.abs(factor) < EPS) continue;
      for (let c = col; c < n; c++) {
        A[r][c] -= factor * A[col][c];
      }
      b[r] -= factor * b[col];
    }
  }

  return { ok: true, x: b };
}
