import * as THREE from 'three'

export interface AabbPx {
  x: number
  y: number
  w: number
  h: number
}

export interface ObbPx {
  cx: number
  cy: number
  w: number
  h: number
  angle: number // radians, ccw from screen +x
}

export interface EggLabel {
  id: number
  category: 'egg'
  bbox: AabbPx | null   // axis-aligned screen-space, in capture pixels
  obb: ObbPx | null
  visible: boolean
  world: {
    position: [number, number, number]
    quaternion: [number, number, number, number]
    scale: [number, number, number]
    radius: number       // equatorial half-width
    halfLength: number   // pole-to-pole half height
  }
}

export interface FrameLabels {
  image: { width: number; height: number; ts: number }
  camera: {
    position: [number, number, number]
    quaternion: [number, number, number, number]
    fov: number
    aspect: number
    near: number
    far: number
  }
  annotations: EggLabel[]
}

const _v = new THREE.Vector3()

// project all geometry verts (in mesh-local coords) to capture-pixel space.
// returns flat (x,y) pairs and a flag if any vertex is in-frustum.
export function projectVertsToScreen(
  verts: Float32Array,
  mesh: THREE.Mesh,
  camera: THREE.Camera,
  w: number,
  h: number,
): { xs: Float32Array; ys: Float32Array; visible: boolean } {
  const n = verts.length / 3
  const xs = new Float32Array(n)
  const ys = new Float32Array(n)
  let visible = false
  for (let i = 0, j = 0; i < verts.length; i += 3, j++) {
    _v.set(verts[i], verts[i + 1], verts[i + 2])
    _v.applyMatrix4(mesh.matrixWorld)
    _v.project(camera as THREE.PerspectiveCamera)
    if (_v.z >= -1 && _v.z <= 1 && _v.x >= -1.2 && _v.x <= 1.2 && _v.y >= -1.2 && _v.y <= 1.2) visible = true
    xs[j] = (_v.x + 1) * 0.5 * w
    ys[j] = (1 - _v.y) * 0.5 * h
  }
  return { xs, ys, visible }
}

// tight axis-aligned bbox from projected geometry vertices.
export function computeAabb(verts: Float32Array, mesh: THREE.Mesh, camera: THREE.Camera, w: number, h: number): AabbPx | null {
  const { xs, ys, visible } = projectVertsToScreen(verts, mesh, camera, w, h)
  if (!visible) return null
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i], y = ys[i]
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  const x = Math.max(0, minX)
  const y = Math.max(0, minY)
  const x2 = Math.min(w, maxX)
  const y2 = Math.min(h, maxY)
  if (x2 <= x || y2 <= y) return null
  return { x, y, w: x2 - x, h: y2 - y }
}

// PCA-based tight oriented bbox from projected verts.
export function computeObb(verts: Float32Array, mesh: THREE.Mesh, camera: THREE.Camera, w: number, h: number): ObbPx | null {
  const { xs, ys, visible } = projectVertsToScreen(verts, mesh, camera, w, h)
  if (!visible) return null
  const n = xs.length
  if (n < 3) return null

  // centroid
  let cx = 0, cy = 0
  for (let i = 0; i < n; i++) { cx += xs[i]; cy += ys[i] }
  cx /= n; cy /= n

  // covariance
  let sxx = 0, sxy = 0, syy = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - cx
    const dy = ys[i] - cy
    sxx += dx * dx
    sxy += dx * dy
    syy += dy * dy
  }

  // principal axis angle via eigendecomposition of covariance
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy)
  const cs = Math.cos(angle), sn = Math.sin(angle)

  // project all points onto rotated axes; track min/max
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - cx
    const dy = ys[i] - cy
    const u = dx * cs + dy * sn
    const v = -dx * sn + dy * cs
    if (u < minU) minU = u
    if (u > maxU) maxU = u
    if (v < minV) minV = v
    if (v > maxV) maxV = v
  }
  const wU = maxU - minU
  const hV = maxV - minV
  const uC = (minU + maxU) * 0.5
  const vC = (minV + maxV) * 0.5
  // back to original frame
  const ocx = cx + uC * cs - vC * sn
  const ocy = cy + uC * sn + vC * cs

  return { cx: ocx, cy: ocy, w: wU, h: hV, angle }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadPng(canvas: HTMLCanvasElement, filename: string): Promise<void> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (blob) downloadBlob(blob, filename)
      resolve()
    }, 'image/png')
  })
}

export function downloadJson(obj: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' })
  downloadBlob(blob, filename)
}
