export class UnionFind {
  private parent: number[];
  private rank: number[];

  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
    this.rank = Array.from({ length: n }, () => 0);
  }

  find(x: number): number {
    let p = this.parent[x];
    if (p !== x) this.parent[x] = this.find(p);
    return this.parent[x];
  }

  union(a: number, b: number) {
    let ra = this.find(a);
    let rb = this.find(b);
    if (ra === rb) return;
    if (this.rank[ra] < this.rank[rb]) {
      this.parent[ra] = rb;
    } else if (this.rank[ra] > this.rank[rb]) {
      this.parent[rb] = ra;
    } else {
      this.parent[rb] = ra;
      this.rank[ra]++;
    }
  }

  groups(): Map<number, number[]> {
    const m = new Map<number, number[]>();
    for (let i = 0; i < this.parent.length; i++) {
      const r = this.find(i);
      const arr = m.get(r) ?? [];
      arr.push(i);
      m.set(r, arr);
    }
    return m;
  }
}
