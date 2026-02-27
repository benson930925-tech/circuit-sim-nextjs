import type { CircuitDoc, CircuitNet, Point, Element } from "./types";
import { UnionFind } from "./unionFind";

function key(p: Point): string {
  return `${p.x},${p.y}`;
}

function dist2(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function buildNet(doc: CircuitDoc): { ok: true; net: CircuitNet; nodePoints: Record<string, Point> } | { ok: false; error: string } {
  const tol = Math.max(6, Math.floor(doc.grid * 0.35)); // pixels
  const tol2 = tol * tol;

  // Collect all conductive points: element terminals, junctions, wire points
  type PRef = { p: Point; kind: "terminal" | "junction" | "wire"; ownerId?: string; term?: "a" | "b" | "gnd" };
  const points: PRef[] = [];

  // element terminals
  for (const el of doc.elements) {
    if (el.type === "GND") {
      points.push({ p: el.p, kind: "terminal", ownerId: el.id, term: "gnd" });
    } else {
      points.push({ p: el.a, kind: "terminal", ownerId: el.id, term: "a" });
      points.push({ p: el.b, kind: "terminal", ownerId: el.id, term: "b" });
    }
  }

  // junctions
  for (const j of doc.junctions) {
    points.push({ p: j.p, kind: "junction", ownerId: j.id });
  }

  // wire points (all points on the polyline are conductor)
  for (const w of doc.wires) {
    for (const p of w.points) {
      points.push({ p, kind: "wire", ownerId: w.id });
    }
  }

  if (doc.elements.length === 0) {
    return { ok: false, error: "目前沒有任何元件。先放一個 R/V/I/GND 再試。"};
  }

  const hasGround = doc.elements.some(e => e.type === "GND");
  if (!hasGround) return { ok: false, error: "缺少 GND：請先放置接地（GND）。" };

  // Index points and unify close points (snap/overlap)
  const uf = new UnionFind(points.length);

  // Fast-ish unify by hashing to grid cell
  const cell = Math.max(10, doc.grid);
  const buckets = new Map<string, number[]>();
  for (let i = 0; i < points.length; i++) {
    const p = points[i].p;
    const cx = Math.floor(p.x / cell);
    const cy = Math.floor(p.y / cell);
    const k = `${cx},${cy}`;
    const arr = buckets.get(k) ?? [];
    arr.push(i);
    buckets.set(k, arr);
  }

  function neighbors(cx: number, cy: number): number[] {
    const out: number[] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const k = `${cx+dx},${cy+dy}`;
        const arr = buckets.get(k);
        if (arr) out.push(...arr);
      }
    }
    return out;
  }

  for (let i = 0; i < points.length; i++) {
    const p = points[i].p;
    const cx = Math.floor(p.x / cell);
    const cy = Math.floor(p.y / cell);
    for (const j of neighbors(cx, cy)) {
      if (j <= i) continue;
      if (dist2(p, points[j].p) <= tol2) uf.union(i, j);
    }
  }

  // Additionally, union all points that belong to the same wire polyline (ensures continuity even if sparse points)
  // In our representation, all wire points are already included, but we still union consecutive points for safety.
  const wirePointIndices = new Map<string, number[]>();
  for (let i = 0; i < points.length; i++) {
    if (points[i].kind === "wire" && points[i].ownerId) {
      const arr = wirePointIndices.get(points[i].ownerId) ?? [];
      arr.push(i);
      wirePointIndices.set(points[i].ownerId, arr);
    }
  }
  for (const arr of wirePointIndices.values()) {
    // union all within the wire
    for (let k = 1; k < arr.length; k++) uf.union(arr[0], arr[k]);
  }

  // Build group -> representative point (average) and detect ground group
  const groups = uf.groups();
  const groupRep = new Map<number, Point>();
  const groupHasGround = new Map<number, boolean>();

  for (const [root, idxs] of groups.entries()) {
    let sx = 0, sy = 0;
    let g = false;
    for (const idx of idxs) {
      sx += points[idx].p.x;
      sy += points[idx].p.y;
      if (points[idx].term === "gnd") g = true;
    }
    groupRep.set(root, { x: sx / idxs.length, y: sy / idxs.length });
    groupHasGround.set(root, g);
  }

  // Assign node ids
  const rootToNodeId = new Map<number, string>();
  let nodeCounter = 1;
  for (const root of groups.keys()) {
    if (groupHasGround.get(root)) {
      rootToNodeId.set(root, "gnd");
    }
  }
  for (const root of groups.keys()) {
    if (rootToNodeId.has(root)) continue;
    rootToNodeId.set(root, `n${nodeCounter++}`);
  }

  // Map element terminals to node ids
  const elementToNodes = new Map<string, { a?: string; b?: string; gnd?: string }>();
  for (let i = 0; i < points.length; i++) {
    const pr = points[i];
    if (pr.kind !== "terminal" || !pr.ownerId) continue;
    const root = uf.find(i);
    const nid = rootToNodeId.get(root)!;
    const prev = elementToNodes.get(pr.ownerId) ?? {};
    if (pr.term === "a") prev.a = nid;
    if (pr.term === "b") prev.b = nid;
    if (pr.term === "gnd") prev.gnd = nid;
    elementToNodes.set(pr.ownerId, prev);
  }

  const elements: CircuitNet["elements"] = doc.elements.map((el: Element) => {
    const nodes = elementToNodes.get(el.id) ?? {};
    if (el.type === "GND") {
      return { id: el.id, type: "GND", name: el.name, a: nodes.gnd ?? "gnd" };
    }
    return { id: el.id, type: el.type, name: el.name, a: nodes.a ?? "gnd", b: nodes.b ?? "gnd", value: el.value };
  });

  // Collect node points (for display) and list non-ground nodes
  const nodePoints: Record<string, Point> = {};
  const nodes: { id: string; p: Point }[] = [];
  for (const [root, nid] of rootToNodeId.entries()) {
    const p = groupRep.get(root)!;
    nodePoints[nid] = p;
    if (nid !== "gnd") nodes.push({ id: nid, p });
  }

  // Quick floating circuit check: at least one non-ground node should exist, and at least one element connects to ground or between nodes
  if (nodes.length === 0) {
    return { ok: false, error: "目前只有 GND（或所有端點都被合併到 GND）。請放元件並接線後再 Solve。" };
  }

  return { ok: true, net: { nodes, hasGround: true, elements }, nodePoints };
}
