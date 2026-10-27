// A bounding volume hierarchy over world triangles for fast ray tests in the
// health checks (thousands of sight lines per second, no three.js needed, so
// it runs in a worker). Built with binned SAH; nodes are flat typed arrays.

const BINS = 12
const LEAF = 4

export class Bvh {
  /** Triangles in tree order, 9 floats each. */
  readonly tris: Float32Array
  readonly flags: Uint8Array
  /** Per node: min xyz, max xyz. */
  private bounds: Float32Array
  /** Per node: first child (inner) or first triangle (leaf). */
  private first: Int32Array
  /** Per node: triangle count (0 = inner node; children are first and first + 1). */
  private count: Int32Array
  private stack = new Int32Array(128)
  readonly min: [number, number, number]
  readonly max: [number, number, number]
  /** Rays cast so far (for the stats). */
  rays = 0

  constructor(tris: Float32Array, flags: Uint8Array) {
    const n = flags.length
    const cen = new Float32Array(n * 3)
    const lo = new Float32Array(n * 3), hi = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      for (let a = 0; a < 3; a++) {
        const v0 = tris[i * 9 + a], v1 = tris[i * 9 + 3 + a], v2 = tris[i * 9 + 6 + a]
        const l = Math.min(v0, v1, v2), h = Math.max(v0, v1, v2)
        lo[i * 3 + a] = l; hi[i * 3 + a] = h; cen[i * 3 + a] = (l + h) / 2
      }
    }
    const order = new Int32Array(n)
    for (let i = 0; i < n; i++) order[i] = i
    const maxNodes = Math.max(1, 2 * n)
    this.bounds = new Float32Array(maxNodes * 6)
    this.first = new Int32Array(maxNodes)
    this.count = new Int32Array(maxNodes)
    let used = 1
    const setBounds = (node: number, start: number, end: number) => {
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity
      for (let k = start; k < end; k++) {
        const t = order[k] * 3
        if (lo[t] < x0) x0 = lo[t]; if (lo[t + 1] < y0) y0 = lo[t + 1]; if (lo[t + 2] < z0) z0 = lo[t + 2]
        if (hi[t] > x1) x1 = hi[t]; if (hi[t + 1] > y1) y1 = hi[t + 1]; if (hi[t + 2] > z1) z1 = hi[t + 2]
      }
      const b = node * 6
      this.bounds[b] = x0; this.bounds[b + 1] = y0; this.bounds[b + 2] = z0
      this.bounds[b + 3] = x1; this.bounds[b + 4] = y1; this.bounds[b + 5] = z1
    }
    const area = (dx: number, dy: number, dz: number) => (dx < 0 ? 0 : dx * dy + dy * dz + dz * dx)
    const binCount = new Int32Array(BINS)
    const binB = new Float32Array(BINS * 6)
    const leftA = new Float32Array(BINS), leftN = new Int32Array(BINS)
    // Explicit stack of [node, start, end].
    const work: number[] = [0, 0, n]
    setBounds(0, 0, n)
    while (work.length) {
      const end = work.pop()!, start = work.pop()!, node = work.pop()!
      const cnt = end - start
      if (cnt <= LEAF) { this.first[node] = start; this.count[node] = cnt; continue }
      // Centroid bounds pick the split axis.
      const c0 = [Infinity, Infinity, Infinity], c1 = [-Infinity, -Infinity, -Infinity]
      for (let k = start; k < end; k++) {
        const t = order[k] * 3
        for (let a = 0; a < 3; a++) { const c = cen[t + a]; if (c < c0[a]) c0[a] = c; if (c > c1[a]) c1[a] = c }
      }
      let bestCost = Infinity, bestAxis = -1, bestBin = 0
      for (let a = 0; a < 3; a++) {
        const ext = c1[a] - c0[a]
        if (ext < 1e-6) continue
        binCount.fill(0)
        for (let b = 0; b < BINS; b++) { binB[b * 6] = binB[b * 6 + 1] = binB[b * 6 + 2] = Infinity; binB[b * 6 + 3] = binB[b * 6 + 4] = binB[b * 6 + 5] = -Infinity }
        for (let k = start; k < end; k++) {
          const t = order[k] * 3
          const b = Math.min(BINS - 1, Math.floor(((cen[t + a] - c0[a]) / ext) * BINS))
          binCount[b]++
          for (let q = 0; q < 3; q++) {
            if (lo[t + q] < binB[b * 6 + q]) binB[b * 6 + q] = lo[t + q]
            if (hi[t + q] > binB[b * 6 + 3 + q]) binB[b * 6 + 3 + q] = hi[t + q]
          }
        }
        // Sweep from the left, then from the right, costing each split.
        let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity, acc = 0
        for (let b = 0; b < BINS - 1; b++) {
          acc += binCount[b]
          if (binCount[b]) {
            x0 = Math.min(x0, binB[b * 6]); y0 = Math.min(y0, binB[b * 6 + 1]); z0 = Math.min(z0, binB[b * 6 + 2])
            x1 = Math.max(x1, binB[b * 6 + 3]); y1 = Math.max(y1, binB[b * 6 + 4]); z1 = Math.max(z1, binB[b * 6 + 5])
          }
          leftN[b] = acc; leftA[b] = acc ? area(x1 - x0, y1 - y0, z1 - z0) : 0
        }
        x0 = y0 = z0 = Infinity; x1 = y1 = z1 = -Infinity; acc = 0
        for (let b = BINS - 1; b > 0; b--) {
          acc += binCount[b]
          if (binCount[b]) {
            x0 = Math.min(x0, binB[b * 6]); y0 = Math.min(y0, binB[b * 6 + 1]); z0 = Math.min(z0, binB[b * 6 + 2])
            x1 = Math.max(x1, binB[b * 6 + 3]); y1 = Math.max(y1, binB[b * 6 + 4]); z1 = Math.max(z1, binB[b * 6 + 5])
          }
          const ln = leftN[b - 1]
          if (!ln || !acc) continue
          const cost = leftA[b - 1] * ln + area(x1 - x0, y1 - y0, z1 - z0) * acc
          if (cost < bestCost) { bestCost = cost; bestAxis = a; bestBin = b }
        }
      }
      let mid: number
      if (bestAxis < 0) mid = (start + end) >> 1 // all centroids together: split the list in half
      else {
        const a = bestAxis, ext = c1[a] - c0[a]
        let i = start, j = end - 1
        while (i <= j) {
          const b = Math.min(BINS - 1, Math.floor(((cen[order[i] * 3 + a] - c0[a]) / ext) * BINS))
          if (b < bestBin) i++
          else { const t = order[i]; order[i] = order[j]; order[j] = t; j-- }
        }
        mid = i
        if (mid === start || mid === end) mid = (start + end) >> 1
      }
      const left = used
      used += 2
      this.first[node] = left
      this.count[node] = 0
      setBounds(left, start, mid)
      setBounds(left + 1, mid, end)
      work.push(left, start, mid, left + 1, mid, end)
    }
    this.bounds = this.bounds.slice(0, used * 6)
    this.first = this.first.slice(0, used)
    this.count = this.count.slice(0, used)
    this.tris = new Float32Array(n * 9)
    this.flags = new Uint8Array(n)
    for (let k = 0; k < n; k++) {
      this.tris.set(tris.subarray(order[k] * 9, order[k] * 9 + 9), k * 9)
      this.flags[k] = flags[order[k]]
    }
    const b = this.bounds
    this.min = n ? [b[0], b[1], b[2]] : [0, 0, 0]
    this.max = n ? [b[3], b[4], b[5]] : [0, 0, 0]
  }

  /** Ray from o along d (not normalized); returns the nearest hit parameter t in (tMin, tMax) on triangles matching `mask`, or -1.
   *  With `any`, stops at the first hit found. `hitTri` receives the triangle. */
  private trace(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, tMin: number, tMax: number, mask: number, any: boolean): number {
    this.rays++
    const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz
    const B = this.bounds, T = this.tris, F = this.flags, first = this.first, count = this.count
    let stack = this.stack
    let sp = 0
    stack[sp++] = 0
    let best = tMax, bestTri = -1
    while (sp) {
      const node = stack[--sp]
      const b = node * 6
      // Slab test against [tMin, best].
      let t0 = (B[b] - ox) * ix, t1 = (B[b + 3] - ox) * ix
      let lo = t0 < t1 ? t0 : t1, hi = t0 < t1 ? t1 : t0
      t0 = (B[b + 1] - oy) * iy; t1 = (B[b + 4] - oy) * iy
      lo = Math.max(lo, t0 < t1 ? t0 : t1); hi = Math.min(hi, t0 < t1 ? t1 : t0)
      t0 = (B[b + 2] - oz) * iz; t1 = (B[b + 5] - oz) * iz
      lo = Math.max(lo, t0 < t1 ? t0 : t1); hi = Math.min(hi, t0 < t1 ? t1 : t0)
      // NaN (a zero direction component on a slab face) fails both comparisons and keeps the node: safe.
      if (lo > hi || hi < tMin || lo > best) continue
      const cnt = count[node]
      if (cnt === 0) {
        if (sp + 2 >= stack.length) { const s = new Int32Array(stack.length * 2); s.set(stack); this.stack = stack = s }
        stack[sp++] = first[node]
        stack[sp++] = first[node] + 1
        continue
      }
      for (let k = first[node], e = k + cnt; k < e; k++) {
        if (!(F[k] & mask)) continue
        // Möller–Trumbore, both sides.
        const p = k * 9
        const ax = T[p], ay = T[p + 1], az = T[p + 2]
        const e1x = T[p + 3] - ax, e1y = T[p + 4] - ay, e1z = T[p + 5] - az
        const e2x = T[p + 6] - ax, e2y = T[p + 7] - ay, e2z = T[p + 8] - az
        const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x
        const det = e1x * px + e1y * py + e1z * pz
        if (det > -1e-12 && det < 1e-12) continue
        const inv = 1 / det
        const sx = ox - ax, sy = oy - ay, sz = oz - az
        const u = (sx * px + sy * py + sz * pz) * inv
        if (u < 0 || u > 1) continue
        const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x
        const v = (dx * qx + dy * qy + dz * qz) * inv
        if (v < 0 || u + v > 1) continue
        const t = (e2x * qx + e2y * qy + e2z * qz) * inv
        if (t <= tMin || t >= best) continue
        best = t; bestTri = k
        if (any) { this.hitTri = k; return t }
      }
    }
    this.hitTri = bestTri
    return bestTri < 0 ? -1 : best
  }

  /** Tree index of the triangle the last query hit (-1: none). */
  hitTri = -1

  /** True if the segment a→b crosses a triangle matching `mask` (ends excluded). */
  blocked(ax: number, ay: number, az: number, bx: number, by: number, bz: number, mask: number): boolean {
    return this.trace(ax, ay, az, bx - ax, by - ay, bz - az, 1e-4, 1 - 1e-4, mask, true) >= 0
  }

  /** Distance to the nearest hit along a unit direction, or -1. */
  closest(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, far: number, mask: number): number {
    return this.trace(ox, oy, oz, dx, dy, dz, 1e-5, far, mask, false)
  }

  /** Every hit straight down from (x, top, z) to `bottom`: heights (descending) and triangle indices. */
  column(x: number, z: number, top: number, bottom: number, mask: number, ys: number[], tris: number[]) {
    ys.length = 0; tris.length = 0
    const B = this.bounds, T = this.tris, F = this.flags, first = this.first, count = this.count
    let stack = this.stack
    let sp = 0
    stack[sp++] = 0
    this.rays++
    while (sp) {
      const node = stack[--sp]
      const b = node * 6
      if (x < B[b] || x > B[b + 3] || z < B[b + 2] || z > B[b + 5] || B[b + 1] > top || B[b + 4] < bottom) continue
      const cnt = count[node]
      if (cnt === 0) {
        if (sp + 2 >= stack.length) { const s = new Int32Array(stack.length * 2); s.set(stack); this.stack = stack = s }
        stack[sp++] = first[node]
        stack[sp++] = first[node] + 1
        continue
      }
      for (let k = first[node], e = k + cnt; k < e; k++) {
        if (!(F[k] & mask)) continue
        const p = k * 9
        // Barycentric test in XZ, then the height of the plane there.
        const ax = T[p], az = T[p + 2], bx = T[p + 3], bz = T[p + 5], cx = T[p + 6], cz = T[p + 8]
        const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz)
        if (d > -1e-12 && d < 1e-12) continue // vertical triangle
        const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d
        const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d
        const l3 = 1 - l1 - l2
        if (l1 < -1e-7 || l2 < -1e-7 || l3 < -1e-7) continue
        const y = l1 * T[p + 1] + l2 * T[p + 4] + l3 * T[p + 7]
        if (y > top || y < bottom) continue
        ys.push(y); tris.push(k)
      }
    }
    // Sort by height, highest first (insertion sort: columns hold few hits).
    for (let i = 1; i < ys.length; i++) {
      const y = ys[i], t = tris[i]
      let j = i - 1
      while (j >= 0 && ys[j] < y) { ys[j + 1] = ys[j]; tris[j + 1] = tris[j]; j-- }
      ys[j + 1] = y; tris[j + 1] = t
    }
  }

  /** Y of the unit normal of a triangle (by tree index). */
  normalY(k: number): number {
    const T = this.tris, p = k * 9
    const e1x = T[p + 3] - T[p], e1y = T[p + 4] - T[p + 1], e1z = T[p + 5] - T[p + 2]
    const e2x = T[p + 6] - T[p], e2y = T[p + 7] - T[p + 1], e2z = T[p + 8] - T[p + 2]
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x
    const len = Math.hypot(nx, ny, nz)
    return len ? ny / len : 0
  }
}
