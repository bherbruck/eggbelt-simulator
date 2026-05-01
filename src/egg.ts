import * as THREE from 'three'

export interface EggGeometryVariant {
  geometry: THREE.LatheGeometry
  vertices: Float32Array // unit-scale verts, for convex-hull physics
  asymmetry: number
}

// asymmetry: 0 = symmetric ellipse (round both ends), 0.4 = pointy chicken-egg shape
export function makeEggGeometry(segments = 28, radial = 36, asymmetry = 0.4): EggGeometryVariant {
  const points: THREE.Vector2[] = []
  for (let i = 0; i <= segments; i++) {
    const u = -1 + (2 * i) / segments
    const r = Math.sqrt(Math.max(0, (1 - u * u) * (1 + asymmetry * u)))
    points.push(new THREE.Vector2(r * 0.5, u * 0.5))
  }
  // pointy end at +Y
  const flipped = points.map((p) => new THREE.Vector2(p.x, -p.y)).reverse()
  const geo = new THREE.LatheGeometry(flipped, radial)
  geo.computeVertexNormals()
  const vertices = (geo.attributes.position.array as Float32Array).slice()
  return { geometry: geo, vertices, asymmetry }
}

// gradient of pointiness: asymmetry from 0 (ellipse) to maxAsymmetry (pointy egg)
export function makeEggGeometryVariants(count = 5, maxAsymmetry = 0.4): EggGeometryVariant[] {
  const out: EggGeometryVariant[] = []
  for (let i = 0; i < count; i++) {
    const t = count > 1 ? i / (count - 1) : 1
    out.push(makeEggGeometry(28, 36, t * maxAsymmetry))
  }
  return out
}
