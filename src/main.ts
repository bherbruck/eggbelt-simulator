import './styles.css'

import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import RAPIER from '@dimforge/rapier3d-compat'
import GUI, { type Controller } from 'lil-gui'

import { CameraFilterShader } from './shaders/camera-filter.js'
import {
  computeAabb,
  computeObb,
  downloadJson,
  downloadPng,
  downloadBlob,
  type FrameLabels,
  type EggLabel,
} from './capture.js'
import {
  makeBeltTextureSet,
  makeWallTextureSet,
  makeEggShellVariants,
  BELT_STYLES,
  WALL_STYLES,
  type BeltStyle,
  type WallStyle,
  type BeltTextureSet,
  type WallTextureSet,
} from './textures.js'
import { makeEggGeometryVariants } from './egg.js'

await RAPIER.init()

// ---------------- params ----------------
interface Params {
  beltSpeed: number
  beltWidth: number
  beltLength: number
  flowDirection: 1 | -1
  beltStyle: BeltStyle
  beltColor: string
  wallStyle: WallStyle
  wallColor: string

  eggsPerSec: number
  eggSizeMean: number
  eggSizeVariance: number
  speedVariance: number
  maxEggs: number
  spawnSpread: number

  eggColor: string
  eggColor2: string
  eggColorVariance: number
  eggRoughness: number
  eggTexture: boolean
  eggDirtChance: number
  eggFriction: number
  eggMassScale: number
  beltGrip: number
  beltAngularDamp: number

  ambient: number
  hemi: number
  keyIntensity: number
  keyColor: string
  keyAzimuth: number
  keyElevation: number
  keyDistance: number
  fillIntensity: number
  fillColor: string
  flicker: number
  lightAutoOrbit: boolean
  lightOrbitSpeed: number

  cameraDistance: number
  cameraTilt: number
  cameraYaw: number
  fov: number

  captureFixed: boolean
  captureWidth: number
  captureHeight: number
  displayScale: number // 0 = fit window; >0 = integer-ish scale (1 = native pixels)
  targetFps: number
  showBboxes: boolean
  showObbs: boolean

  filterEnabled: boolean
  pixelation: number
  noise: number
  chromatic: number
  vignette: number
  exposure: number
  contrast: number
  saturation: number
  jpegBlock: number
  scanlines: number
  blur: number
}

const DEFAULTS: Params = {
  beltSpeed: 1.2,
  beltWidth: 2.0,
  beltLength: 6,
  flowDirection: 1,
  beltStyle: 'perforated',
  beltColor: '#ffffff',
  wallStyle: 'galvanized',
  wallColor: '#ffffff',

  eggsPerSec: 8,
  eggSizeMean: 0.07,
  eggSizeVariance: 0.18,
  speedVariance: 0.25,
  maxEggs: 240,
  spawnSpread: 0.7,

  eggColor: '#f1e6d4',
  eggColor2: '#c89060',
  eggColorVariance: 0.06,
  eggRoughness: 0.55,
  eggTexture: true,
  eggDirtChance: 0.25,
  eggFriction: 0.9,
  eggMassScale: 1.0,
  beltGrip: 12.0,
  beltAngularDamp: 6.0,

  ambient: 0.22,
  hemi: 0.25,
  keyIntensity: 1.4,
  keyColor: '#ffd9a8',
  keyAzimuth: -0.35,
  keyElevation: 1.05,
  keyDistance: 5.0,
  fillIntensity: 0.4,
  fillColor: '#5a6a78',
  flicker: 0.06,
  lightAutoOrbit: false,
  lightOrbitSpeed: 0.4,

  cameraDistance: 4.5,
  cameraTilt: 0.0,
  cameraYaw: 0.0,
  fov: 38,

  captureFixed: false,
  captureWidth: 512,
  captureHeight: 512,
  displayScale: 0,
  targetFps: 30,
  showBboxes: false,
  showObbs: false,

  filterEnabled: false,
  pixelation: 720,
  noise: 0.08,
  chromatic: 0.002,
  vignette: 0.4,
  exposure: 1.0,
  contrast: 1.1,
  saturation: 1.0,
  jpegBlock: 0.18,
  scanlines: 0.0,
  blur: 0,
}

// ---------------- localStorage ----------------
const STORAGE_KEY = 'eggbelt-sim:params:v1'

function loadParams(): Params {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULTS }
    const data = JSON.parse(raw) as Partial<Params>
    const merged = { ...DEFAULTS }
    for (const k of Object.keys(DEFAULTS) as (keyof Params)[]) {
      const v = (data as Record<string, unknown>)[k as string]
      if (v !== undefined && typeof v === typeof (DEFAULTS as unknown as Record<string, unknown>)[k as string]) {
        ;(merged as unknown as Record<string, unknown>)[k as string] = v
      }
    }
    return merged
  } catch (e) {
    console.warn('failed loading saved params', e)
    return { ...DEFAULTS }
  }
}

let saveTimer: number | undefined
function saveParams(): void {
  if (saveTimer !== undefined) clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    try {
      const out: Record<string, unknown> = {}
      for (const k of Object.keys(DEFAULTS) as (keyof Params)[]) {
        out[k as string] = (params as unknown as Record<string, unknown>)[k as string]
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(out))
    } catch (e) {
      console.warn('failed saving params', e)
    }
  }, 200)
}

const params: Params = loadParams()

// ---------------- renderer ----------------
const canvas = document.getElementById('view') as HTMLCanvasElement
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.0
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFShadowMap

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x05060a)
scene.fog = new THREE.FogExp2(0x05060a, 0.05)

const camera = new THREE.PerspectiveCamera(params.fov, window.innerWidth / window.innerHeight, 0.05, 80)
const camTarget = new THREE.Vector3(0, 0, 0)

function applyCameraFromParams(): void {
  const r = params.cameraDistance
  const tilt = Math.max(0.0001, params.cameraTilt)
  const yaw = params.cameraYaw
  camera.position.set(
    r * Math.sin(tilt) * Math.sin(yaw),
    r * Math.cos(tilt),
    r * Math.sin(tilt) * Math.cos(yaw),
  )
  camera.lookAt(camTarget)
}
applyCameraFromParams()

let camCtrls: Controller[] = []
let lightCtrls: Controller[] = []

// ---------------- lights ----------------
const ambient = new THREE.AmbientLight(0xffffff, params.ambient)
scene.add(ambient)
const hemi = new THREE.HemisphereLight(0x8899aa, 0x202018, params.hemi)
scene.add(hemi)

const keyLight = new THREE.SpotLight(params.keyColor, params.keyIntensity, 18, Math.PI * 0.5, 0.45, 1.5)
keyLight.target.position.set(0, 0, 0)
keyLight.castShadow = true
keyLight.shadow.mapSize.set(2048, 2048)
keyLight.shadow.camera.near = 0.3
keyLight.shadow.camera.far = 14
keyLight.shadow.bias = -0.0002
keyLight.shadow.normalBias = 0.02
keyLight.shadow.radius = 1.5
scene.add(keyLight, keyLight.target)

const keyLight2 = new THREE.SpotLight(params.keyColor, params.keyIntensity * 0.6, 16, Math.PI * 0.55, 0.6, 1.5)
keyLight2.target.position.set(0, 0, 0)
scene.add(keyLight2, keyLight2.target)

const fillLight = new THREE.PointLight(params.fillColor, params.fillIntensity, 10, 1.5)
scene.add(fillLight)

function applyLightAngle(az: number, el: number, dist: number): void {
  const horiz = Math.cos(el) * dist
  keyLight.position.set(horiz * Math.sin(az), Math.sin(el) * dist, horiz * Math.cos(az))
  const a2 = az + Math.PI
  const e2 = Math.max(0.2, el * 0.7)
  const h2 = Math.cos(e2) * dist * 0.85
  keyLight2.position.set(h2 * Math.sin(a2), Math.sin(e2) * dist * 0.85, h2 * Math.cos(a2))
  const af = az - Math.PI / 2
  fillLight.position.set(Math.cos(af) * 2.2, 1.4, Math.sin(af) * 2.2)
}
applyLightAngle(params.keyAzimuth, params.keyElevation, params.keyDistance)

// ---------------- belt + walls ----------------
const beltGroup = new THREE.Group()
scene.add(beltGroup)

let beltSet: BeltTextureSet = makeBeltTextureSet(params.beltStyle)
const beltMat = new THREE.MeshStandardMaterial({
  map: beltSet.map,
  normalMap: beltSet.normalMap,
  roughnessMap: beltSet.roughnessMap ?? null,
  normalScale: new THREE.Vector2(beltSet.normalScale, beltSet.normalScale),
  roughness: beltSet.roughness,
  metalness: beltSet.metalness,
  color: new THREE.Color(params.beltColor),
})

let wallSet: WallTextureSet = makeWallTextureSet(params.wallStyle)
const wallMat = new THREE.MeshStandardMaterial({
  map: wallSet.map,
  normalMap: wallSet.normalMap,
  roughnessMap: wallSet.roughnessMap ?? null,
  normalScale: new THREE.Vector2(wallSet.normalScale, wallSet.normalScale),
  roughness: wallSet.roughness,
  metalness: wallSet.metalness,
  color: new THREE.Color(params.wallColor),
})

function applyWallRepeat(): void {
  const r = wallSet.repeatScale
  const repL = new THREE.Vector2(params.beltLength / r, 0.7 / r)
  wallSet.map.repeat.copy(repL)
  wallSet.normalMap.repeat.copy(repL)
  if (wallSet.roughnessMap) wallSet.roughnessMap.repeat.copy(repL)
}

function applyWallStyle(): void {
  const old = wallSet
  wallSet = makeWallTextureSet(params.wallStyle)
  wallMat.map = wallSet.map
  wallMat.normalMap = wallSet.normalMap
  wallMat.roughnessMap = wallSet.roughnessMap ?? null
  wallMat.normalScale.set(wallSet.normalScale, wallSet.normalScale)
  wallMat.roughness = wallSet.roughness
  wallMat.metalness = wallSet.metalness
  wallMat.needsUpdate = true
  applyWallRepeat()
  old.map.dispose()
  old.normalMap.dispose()
  old.roughnessMap?.dispose()
}

let beltMesh: THREE.Mesh | undefined
let leftWall: THREE.Mesh | undefined
let rightWall: THREE.Mesh | undefined
let backWall: THREE.Mesh | undefined

function applyBeltRepeat(): void {
  const r = beltSet.repeatScale
  const rep = new THREE.Vector2(params.beltWidth / r, params.beltLength / r)
  beltSet.map.repeat.copy(rep)
  beltSet.normalMap.repeat.copy(rep)
  if (beltSet.roughnessMap) beltSet.roughnessMap.repeat.copy(rep)
}

function applyBeltStyle(): void {
  const old = beltSet
  beltSet = makeBeltTextureSet(params.beltStyle)
  beltMat.map = beltSet.map
  beltMat.normalMap = beltSet.normalMap
  beltMat.roughnessMap = beltSet.roughnessMap ?? null
  beltMat.normalScale.set(beltSet.normalScale, beltSet.normalScale)
  beltMat.roughness = beltSet.roughness
  beltMat.metalness = beltSet.metalness
  // keep user tint
  beltMat.needsUpdate = true
  applyBeltRepeat()
  old.map.dispose()
  old.normalMap.dispose()
  old.roughnessMap?.dispose()
}

function buildBeltMeshes(): void {
  for (const m of [beltMesh, leftWall, rightWall, backWall]) {
    if (m) { beltGroup.remove(m); m.geometry.dispose() }
  }
  const geo = new THREE.PlaneGeometry(params.beltWidth, params.beltLength, 1, 1)
  geo.rotateX(-Math.PI / 2)
  beltMesh = new THREE.Mesh(geo, beltMat)
  beltMesh.receiveShadow = true
  beltGroup.add(beltMesh)
  applyBeltRepeat()

  const wallH = 0.7
  const sideGeo = new THREE.BoxGeometry(0.06, wallH, params.beltLength)
  leftWall = new THREE.Mesh(sideGeo, wallMat)
  leftWall.position.set(-params.beltWidth / 2 - 0.03, wallH / 2 - 0.02, 0)
  leftWall.castShadow = leftWall.receiveShadow = true
  rightWall = leftWall.clone()
  rightWall.position.x = params.beltWidth / 2 + 0.03
  beltGroup.add(leftWall, rightWall)
  applyWallRepeat()

  // single spawn-side lip (no front lip — discharge end is open)
  const lipGeo = new THREE.BoxGeometry(params.beltWidth + 0.2, 0.2, 0.04)
  backWall = new THREE.Mesh(lipGeo, wallMat)
  const spawnZ = -params.flowDirection * (params.beltLength / 2 + 0.02)
  backWall.position.set(0, 0.08, spawnZ)
  backWall.castShadow = backWall.receiveShadow = true
  beltGroup.add(backWall)
}

// ---------------- physics ----------------
const gravity = { x: 0, y: -9.81, z: 0 }
const world = new RAPIER.World(gravity)
world.timestep = 1 / 60

let beltCollider: RAPIER.Collider | undefined
const wallColliders: RAPIER.Collider[] = []
function buildColliders(): void {
  if (beltCollider) world.removeCollider(beltCollider, true)
  for (const c of wallColliders) world.removeCollider(c, true)
  wallColliders.length = 0

  // belt friction = 0 so contact friction doesn't spin eggs forward.
  // motion + backspin are applied manually as impulses in driveEggs().
  const cd = RAPIER.ColliderDesc.cuboid(params.beltWidth / 2, 0.02, params.beltLength / 2)
    .setTranslation(0, -0.02, 0)
    .setFriction(0.0)
    .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
    .setRestitution(0.05)
  beltCollider = world.createCollider(cd)

  const h = 0.7
  for (const sx of [-1, 1]) {
    const wd = RAPIER.ColliderDesc.cuboid(0.03, h / 2, params.beltLength / 2)
      .setTranslation(sx * (params.beltWidth / 2 + 0.03), h / 2 - 0.02, 0)
      .setFriction(0.4)
      .setRestitution(0.15)
    wallColliders.push(world.createCollider(wd))
  }
  // single spawn-side lip
  const spawnZ = -params.flowDirection * (params.beltLength / 2 + 0.02)
  const lip = RAPIER.ColliderDesc.cuboid((params.beltWidth + 0.2) / 2, 0.1, 0.02)
    .setTranslation(0, 0.08, spawnZ)
    .setFriction(0.4)
    .setRestitution(0.1)
  wallColliders.push(world.createCollider(lip))
}

function rebuildBelt(): void {
  buildBeltMeshes()
  buildColliders()
}
rebuildBelt()

// ---------------- eggs ----------------
const eggVariants = makeEggGeometryVariants(5, 0.4)
const eggBaseMat = new THREE.MeshPhysicalMaterial({
  color: params.eggColor,
  roughness: params.eggRoughness,
  metalness: 0.0,
  clearcoat: 0.05,
  clearcoatRoughness: 0.6,
  sheen: 0.2,
  sheenRoughness: 0.8,
  sheenColor: new THREE.Color(0xfff2dd),
})

const cleanShellTextures = makeEggShellVariants(4, 256, 0, 0)
const dirtyShellTextures = makeEggShellVariants(4, 256, 0.3, 1.0)

function pickShellTexture(): THREE.CanvasTexture {
  const useDirty = Math.random() < params.eggDirtChance
  const set = useDirty ? dirtyShellTextures : cleanShellTextures
  return set[Math.floor(Math.random() * set.length)]
}

interface EggRec {
  mesh: THREE.Mesh
  body: RAPIER.RigidBody
  mat: THREE.MeshPhysicalMaterial
  speedJitter: number
  radius: number
  halfLength: number
  // shared unit-scale geometry verts; matrixWorld carries the per-egg scale
  verts: Float32Array
}

const eggs: EggRec[] = []
const tmpQ = new THREE.Quaternion()

function spawnEgg(): void {
  if (eggs.length >= params.maxEggs) return

  const variant = eggVariants[Math.floor(Math.random() * eggVariants.length)]

  const sizeJ = 1 + (Math.random() * 2 - 1) * params.eggSizeVariance
  const r = params.eggSizeMean * sizeJ
  const longAxis = r * 1.32

  const mat = eggBaseMat.clone()
  // pick a random point along the eggColor → eggColor2 gradient, then jitter
  const c1 = new THREE.Color(params.eggColor)
  const c2 = new THREE.Color(params.eggColor2)
  const c = c1.clone().lerp(c2, Math.random())
  const v = params.eggColorVariance
  c.offsetHSL((Math.random() - 0.5) * 0.04 * v, (Math.random() - 0.5) * v, (Math.random() - 0.5) * v)
  mat.color = c
  mat.map = params.eggTexture ? pickShellTexture() : null

  const mesh = new THREE.Mesh(variant.geometry, mat)
  mesh.scale.set(r * 2, longAxis * 2, r * 2)
  mesh.castShadow = true
  mesh.receiveShadow = true
  scene.add(mesh)

  const halfL = params.beltLength / 2
  const dir = params.flowDirection
  const x = (Math.random() * 2 - 1) * params.spawnSpread * (params.beltWidth / 2 - r)
  const z = -dir * (halfL - 0.4) + (Math.random() - 0.5) * 0.2
  const y = 0.55 + Math.random() * 0.25

  const bd = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(x, y, z)
    .setLinearDamping(0.15)
    .setAngularDamping(0.65)
    .setCcdEnabled(true)
  const body = world.createRigidBody(bd)

  // convex-hull collider from per-egg scaled vertices for proper egg-rolling
  const sx = r * 2, sy = longAxis * 2, sz = r * 2
  const verts = variant.vertices
  const scaled = new Float32Array(verts.length)
  for (let i = 0; i < verts.length; i += 3) {
    scaled[i] = verts[i] * sx
    scaled[i + 1] = verts[i + 1] * sy
    scaled[i + 2] = verts[i + 2] * sz
  }
  let cd = RAPIER.ColliderDesc.convexHull(scaled)
  if (!cd) {
    cd = RAPIER.ColliderDesc.capsule(Math.max(longAxis - r, 0.001), r)
  }
  cd.setFriction(params.eggFriction)
    .setRestitution(0.15)
    .setDensity(700 * params.eggMassScale)
  world.createCollider(cd, body)

  // varied initial orientation — uniformly random axis-angle
  const ax = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize()
  tmpQ.setFromAxisAngle(ax, Math.random() * Math.PI * 2)
  body.setRotation({ x: tmpQ.x, y: tmpQ.y, z: tmpQ.z, w: tmpQ.w }, true)

  const sv = 1 + (Math.random() * 2 - 1) * params.speedVariance
  // start at belt speed so contact doesn't jolt them into spinning
  body.setLinvel({ x: (Math.random() - 0.5) * 0.05, y: -0.15, z: dir * params.beltSpeed * sv }, true)
  // mild initial tumble — the belt grip will damp it once they settle
  body.setAngvel({
    x: (Math.random() - 0.5) * 1.5,
    y: (Math.random() - 0.5) * 1.0,
    z: (Math.random() - 0.5) * 1.5,
  }, true)

  eggs.push({ mesh, body, mat, speedJitter: sv, radius: r, halfLength: longAxis, verts: variant.vertices })
}

function despawnEgg(i: number): void {
  const e = eggs[i]
  scene.remove(e.mesh)
  e.mat.dispose()
  world.removeRigidBody(e.body)
  eggs.splice(i, 1)
}

function resetEggs(): void {
  for (let i = eggs.length - 1; i >= 0; i--) despawnEgg(i)
}

function driveEggs(dt: number): void {
  const halfL = params.beltLength / 2
  const dir = params.flowDirection
  for (let i = eggs.length - 1; i >= 0; i--) {
    const e = eggs[i]
    const t = e.body.translation()
    const offFront = dir > 0 ? t.z > halfL + 0.15 : t.z < -halfL - 0.15
    if (offFront || t.y < -0.35 || Math.abs(t.x) > params.beltWidth / 2 + 1.0) {
      despawnEgg(i)
      continue
    }
    // touching belt? (y close to belt surface, within belt x bounds)
    if (t.y < e.radius * 2.0 && Math.abs(t.x) < params.beltWidth / 2 + 0.05) {
      const v = e.body.linvel()
      // every egg targets belt speed exactly — no per-egg jitter that would let it
      // overshoot the belt. divergence only happens via collisions / jams.
      const target = dir * params.beltSpeed
      const k = 1 - Math.exp(-params.beltGrip * dt) // 0..1 fraction resolved this frame

      // hard-set linvel toward belt speed — guarantees egg moves with belt
      const newZ = v.z + (target - v.z) * k
      const newX = v.x * (1 - k * 0.5)
      e.body.setLinvel({ x: newX, y: v.y, z: newZ }, true)

      // residual angular damping kills collision-induced spin so eggs don't roll
      if (params.beltAngularDamp > 0) {
        const af = Math.exp(-params.beltAngularDamp * dt)
        const w = e.body.angvel()
        e.body.setAngvel({ x: w.x * af, y: w.y * af, z: w.z * af }, true)
      }
    }
  }
}

// ---------------- spawner ----------------
let spawnAccum = 0
function tickSpawner(dt: number): void {
  spawnAccum += dt * params.eggsPerSec
  // cap burst-spawn after long frames / tab throttling
  if (spawnAccum > 8) spawnAccum = 8
  while (spawnAccum >= 1) {
    spawnEgg()
    spawnAccum -= 1
  }
}

// ---------------- postprocess ----------------
const composer = new EffectComposer(renderer)
composer.setPixelRatio(Math.min(devicePixelRatio, 2))
composer.setSize(window.innerWidth, window.innerHeight)
composer.addPass(new RenderPass(scene, camera))
const filterPass = new ShaderPass(CameraFilterShader)
filterPass.uniforms.uResolution.value.set(window.innerWidth, window.innerHeight)
composer.addPass(filterPass)
composer.addPass(new OutputPass())

// ---------------- resolution ----------------
interface ResolutionPreset { w: number; h: number }
const RESOLUTION_PRESETS: Record<string, ResolutionPreset | 'auto'> = {
  auto: 'auto',
  '1920x1080': { w: 1920, h: 1080 },
  '1280x720':  { w: 1280, h: 720 },
  '960x540':   { w: 960,  h: 540 },
  '640x480':   { w: 640,  h: 480 },
  '512x512':   { w: 512,  h: 512 },
  '512x384':   { w: 512,  h: 384 },
  '320x240':   { w: 320,  h: 240 },
}

const captureInfoEl = document.getElementById('capture-info') as HTMLElement
const overlayCanvas = document.getElementById('overlay') as HTMLCanvasElement
const overlayCtx = overlayCanvas.getContext('2d')!

function applyRenderSize(): void {
  const w = params.captureFixed ? Math.max(16, Math.round(params.captureWidth)) : window.innerWidth
  const h = params.captureFixed ? Math.max(16, Math.round(params.captureHeight)) : window.innerHeight

  renderer.setPixelRatio(params.captureFixed ? 1 : Math.min(devicePixelRatio, 2))
  renderer.setSize(w, h, false)
  composer.setPixelRatio(renderer.getPixelRatio())
  composer.setSize(w, h)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  filterPass.uniforms.uResolution.value.set(w, h)

  // overlay canvas internal size matches capture pixel space
  overlayCanvas.width = w
  overlayCanvas.height = h

  if (params.captureFixed) {
    const margin = 24
    const maxW = window.innerWidth - margin * 2
    const maxH = window.innerHeight - margin * 2
    const fitScale = Math.min(maxW / w, maxH / h)
    const scale = params.displayScale > 0 ? params.displayScale : fitScale
    const dispW = Math.round(w * scale)
    const dispH = Math.round(h * scale)
    canvas.style.width = `${dispW}px`
    canvas.style.height = `${dispH}px`
    canvas.style.left = `${Math.round((window.innerWidth - dispW) / 2)}px`
    canvas.style.top = `${Math.round((window.innerHeight - dispH) / 2)}px`
    canvas.style.imageRendering = 'pixelated'
    overlayCanvas.style.width = canvas.style.width
    overlayCanvas.style.height = canvas.style.height
    overlayCanvas.style.left = canvas.style.left
    overlayCanvas.style.top = canvas.style.top
    overlayCanvas.style.imageRendering = 'auto'
    document.body.classList.add('letterbox')
    const scaleLabel = params.displayScale > 0 ? `${scale.toFixed(2)}×` : `fit ${fitScale.toFixed(2)}×`
    captureInfoEl.textContent = `capture · ${w}×${h} · ${scaleLabel}`
  } else {
    canvas.style.width = ''
    canvas.style.height = ''
    canvas.style.left = ''
    canvas.style.top = ''
    canvas.style.imageRendering = 'auto'
    overlayCanvas.style.width = ''
    overlayCanvas.style.height = ''
    overlayCanvas.style.left = ''
    overlayCanvas.style.top = ''
    document.body.classList.remove('letterbox')
  }
}

function syncFilterUniforms(): void {
  const u = filterPass.uniforms
  u.uEnabled.value = params.filterEnabled ? 1 : 0
  u.uPixelation.value = params.pixelation
  u.uNoise.value = params.noise
  u.uChromatic.value = params.chromatic
  u.uVignette.value = params.vignette
  u.uExposure.value = params.exposure
  u.uContrast.value = params.contrast
  u.uSaturation.value = params.saturation
  u.uJpegBlock.value = params.jpegBlock
  u.uScanlines.value = params.scanlines
  u.uBlur.value = params.blur
}
syncFilterUniforms()

// ---------------- gui ----------------
const gui = new GUI({ title: 'eggbelt sim' })
gui.onChange(saveParams)

const fBelt = gui.addFolder('belt')
fBelt.add(params, 'beltStyle', BELT_STYLES).name('style').onChange(applyBeltStyle)
fBelt.addColor(params, 'beltColor').name('tint').onChange((v: string) => beltMat.color.set(v))
fBelt.add(params, 'beltSpeed', 0, 2, 0.005)
fBelt.add(params, 'flowDirection', { '+Z (forward)': 1, '-Z (reverse)': -1 }).name('direction').onChange(rebuildBelt)
fBelt.add(params, 'beltWidth', 0.8, 5, 0.05).onChange(rebuildBelt)
fBelt.add(params, 'beltLength', 2, 20, 0.1).onChange(rebuildBelt)

const fWalls = gui.addFolder('walls')
fWalls.add(params, 'wallStyle', WALL_STYLES).name('style').onChange(applyWallStyle)
fWalls.addColor(params, 'wallColor').name('tint').onChange((v: string) => wallMat.color.set(v))

const fSpawn = gui.addFolder('eggs')
fSpawn.add(params, 'eggsPerSec', 0, 40, 0.1)
fSpawn.add(params, 'eggSizeMean', 0.025, 0.14, 0.001)
fSpawn.add(params, 'eggSizeVariance', 0, 0.6, 0.01)
fSpawn.add(params, 'speedVariance', 0, 1, 0.01)
fSpawn.add(params, 'maxEggs', 10, 800, 1)
fSpawn.add(params, 'spawnSpread', 0, 1, 0.02)
fSpawn.addColor(params, 'eggColor').name('color A')
fSpawn.addColor(params, 'eggColor2').name('color B')
fSpawn.add(params, 'eggColorVariance', 0, 1, 0.005).name('color variance')
fSpawn.add(params, 'eggRoughness', 0, 1, 0.01).onChange((v: number) => (eggBaseMat.roughness = v))
fSpawn.add(params, 'eggTexture').name('shell texture')
fSpawn.add(params, 'eggDirtChance', 0, 1, 0.01).name('dirt chance')
fSpawn.add(params, 'eggFriction', 0, 4, 0.01).name('friction')
fSpawn.add(params, 'eggMassScale', 0.1, 20, 0.05).name('mass scale')
fSpawn.add(params, 'beltGrip', 0, 100, 0.5).name('belt grip')
fSpawn.add(params, 'beltAngularDamp', 0, 60, 0.5).name('ang damp')
fSpawn.add({ reset: resetEggs }, 'reset').name('reset eggs')

const fLight = gui.addFolder('lighting')
fLight.add(params, 'ambient', 0, 1, 0.01).onChange((v: number) => (ambient.intensity = v))
fLight.add(params, 'hemi', 0, 1, 0.01).onChange((v: number) => (hemi.intensity = v))
fLight.add(params, 'keyIntensity', 0, 5, 0.05).onChange((v: number) => { keyLight.intensity = v; keyLight2.intensity = v * 0.6 })
fLight.addColor(params, 'keyColor').onChange((v: string) => { keyLight.color.set(v); keyLight2.color.set(v) })
lightCtrls = [
  fLight.add(params, 'keyAzimuth', -Math.PI, Math.PI, 0.01).name('key azimuth'),
  fLight.add(params, 'keyElevation', 0.05, Math.PI / 2, 0.01).name('key elevation'),
  fLight.add(params, 'keyDistance', 1, 12, 0.1).name('key distance'),
]
for (const c of lightCtrls) c.onChange(() => applyLightAngle(params.keyAzimuth, params.keyElevation, params.keyDistance))
fLight.add(params, 'fillIntensity', 0, 3, 0.05).onChange((v: number) => (fillLight.intensity = v))
fLight.addColor(params, 'fillColor').onChange((v: string) => fillLight.color.set(v))
fLight.add(params, 'flicker', 0, 0.5, 0.005)
fLight.add(params, 'lightAutoOrbit').name('auto-orbit')
fLight.add(params, 'lightOrbitSpeed', 0, 2, 0.01).name('orbit speed')

const fCam = gui.addFolder('camera')
camCtrls = [
  fCam.add(params, 'cameraDistance', 0.6, 14, 0.05).onChange(applyCameraFromParams),
  fCam.add(params, 'cameraTilt', 0, Math.PI * 0.49, 0.01).name('tilt (0=top-down)').onChange(applyCameraFromParams),
  fCam.add(params, 'cameraYaw', -Math.PI, Math.PI, 0.01).name('yaw').onChange(applyCameraFromParams),
  fCam.add(params, 'fov', 18, 90, 1).onChange((v: number) => { camera.fov = v; camera.updateProjectionMatrix() }),
]
fCam.add({
  topDown: () => {
    params.cameraTilt = 0
    params.cameraYaw = 0
    applyCameraFromParams()
    for (const c of camCtrls) c.updateDisplay()
    saveParams()
  },
}, 'topDown').name('snap top-down')

const fFilter = gui.addFolder('crappy camera')
fFilter.add(params, 'filterEnabled').onChange(syncFilterUniforms)
fFilter.add(params, 'pixelation', 80, 1200, 10).onChange(syncFilterUniforms)
fFilter.add(params, 'noise', 0, 0.5, 0.005).onChange(syncFilterUniforms)
fFilter.add(params, 'chromatic', 0, 0.02, 0.0005).onChange(syncFilterUniforms)
fFilter.add(params, 'vignette', 0, 1.5, 0.01).onChange(syncFilterUniforms)
fFilter.add(params, 'exposure', 0.2, 2, 0.01).onChange(syncFilterUniforms)
fFilter.add(params, 'contrast', 0.5, 2, 0.01).onChange(syncFilterUniforms)
fFilter.add(params, 'saturation', 0, 1.5, 0.01).onChange(syncFilterUniforms)
fFilter.add(params, 'jpegBlock', 0, 1, 0.01).onChange(syncFilterUniforms)
fFilter.add(params, 'scanlines', 0, 0.6, 0.01).onChange(syncFilterUniforms)
fFilter.add(params, 'blur', 0, 6, 0.05).onChange(syncFilterUniforms)

const fPreset = gui.addFolder('filter presets')
fPreset.add({ clean: () => applyPreset('clean') }, 'clean').name('clean')
fPreset.add({ cctv: () => applyPreset('cctv') }, 'cctv').name('CCTV night')
fPreset.add({ phonecam: () => applyPreset('phonecam') }, 'phonecam').name('phone cam')
fPreset.add({ potato: () => applyPreset('potato') }, 'potato').name('potato cam')

const fRender = gui.addFolder('render')
const renderCtrls: Controller[] = []
const renderPresetProxy = { preset: 'auto' as string }
fRender.add(renderPresetProxy, 'preset', Object.keys(RESOLUTION_PRESETS))
  .name('preset')
  .onChange((name: string) => {
    const p = RESOLUTION_PRESETS[name]
    if (p === 'auto') {
      params.captureFixed = false
    } else {
      params.captureFixed = true
      params.captureWidth = p.w
      params.captureHeight = p.h
    }
    for (const c of renderCtrls) c.updateDisplay()
    applyRenderSize()
    saveParams()
  })
renderCtrls.push(
  fRender.add(params, 'captureFixed').name('fixed capture').onChange(applyRenderSize),
  fRender.add(params, 'captureWidth', 64, 4096, 1).name('width').onChange(applyRenderSize),
  fRender.add(params, 'captureHeight', 64, 4096, 1).name('height').onChange(applyRenderSize),
  fRender.add(params, 'displayScale', 0, 6, 0.05).name('display scale (0=fit)').onChange(applyRenderSize),
)
fRender.add(params, 'targetFps', 1, 120, 1).name('fps')

const fCapture = gui.addFolder('capture')
fCapture.add(params, 'showBboxes').name('show AABB')
fCapture.add(params, 'showObbs').name('show OBB')
fCapture.add({ snap: () => { void snapshot() } }, 'snap').name('snapshot (PNG + JSON)')
const recordProxy = {
  start: () => startRecording(),
  stop:  () => stopRecording(),
}
fCapture.add(recordProxy, 'start').name('start recording')
fCapture.add(recordProxy, 'stop').name('stop recording')

const fMisc = gui.addFolder('misc')

function exportSettings(): void {
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(DEFAULTS) as (keyof Params)[]) {
    out[k as string] = (params as unknown as Record<string, unknown>)[k as string]
  }
  downloadJson(out, `eggbelt-settings-${Date.now()}.json`)
}

function importSettings(): void {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'application/json,.json'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return
    let data: Record<string, unknown>
    try {
      data = JSON.parse(await file.text()) as Record<string, unknown>
    } catch (e) {
      alert(`failed to parse settings JSON: ${e}`)
      return
    }
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(DEFAULTS) as (keyof Params)[]) {
      const v = data[k as string]
      const expected = typeof (DEFAULTS as unknown as Record<string, unknown>)[k as string]
      if (v !== undefined && typeof v === expected) {
        out[k as string] = v
      }
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(out))
    location.reload()
  }
  input.click()
}

fMisc.add({ exportSettings }, 'exportSettings').name('export settings (.json)')
fMisc.add({ importSettings }, 'importSettings').name('import settings (.json)')
fMisc.add({
  resetSettings: () => {
    localStorage.removeItem(STORAGE_KEY)
    location.reload()
  },
}, 'resetSettings').name('reset all settings')

function applyPreset(name: 'clean' | 'cctv' | 'phonecam' | 'potato'): void {
  const presets = {
    clean:    { filterEnabled: false, blur: 0 },
    cctv:     { filterEnabled: true, pixelation: 540, noise: 0.10, chromatic: 0.0025, vignette: 0.5,  exposure: 0.85, contrast: 1.15, saturation: 0.85, jpegBlock: 0.18, scanlines: 0.04, blur: 0.6 },
    phonecam: { filterEnabled: true, pixelation: 720, noise: 0.06, chromatic: 0.0015, vignette: 0.35, exposure: 1.0,  contrast: 1.08, saturation: 1.0,  jpegBlock: 0.15, scanlines: 0.0,  blur: 0.3 },
    potato:   { filterEnabled: true, pixelation: 380, noise: 0.16, chromatic: 0.004,  vignette: 0.65, exposure: 0.8,  contrast: 1.2,  saturation: 0.78, jpegBlock: 0.28, scanlines: 0.08, blur: 1.4 },
  } as const
  Object.assign(params, presets[name])
  syncFilterUniforms()
  fFilter.controllers.forEach((c) => c.updateDisplay())
  saveParams()
}

// ---------------- capture (snapshot, video, labels) ----------------
function buildLabels(): FrameLabels {
  const w = renderer.domElement.width
  const h = renderer.domElement.height
  const annotations: EggLabel[] = []
  let id = 0
  for (const e of eggs) {
    e.mesh.updateMatrixWorld(true)
    const bbox = computeAabb(e.verts, e.mesh, camera, w, h)
    const obb = computeObb(e.verts, e.mesh, camera, w, h)
    const p = e.mesh.position
    const q = e.mesh.quaternion
    const s = e.mesh.scale
    annotations.push({
      id: id++,
      category: 'egg',
      bbox,
      obb,
      visible: bbox !== null,
      world: {
        position: [p.x, p.y, p.z],
        quaternion: [q.x, q.y, q.z, q.w],
        scale: [s.x, s.y, s.z],
        radius: e.radius,
        halfLength: e.halfLength,
      },
    })
  }
  const cp = camera.position, cq = camera.quaternion
  return {
    image: { width: w, height: h, ts: Date.now() },
    camera: {
      position: [cp.x, cp.y, cp.z],
      quaternion: [cq.x, cq.y, cq.z, cq.w],
      fov: camera.fov,
      aspect: camera.aspect,
      near: camera.near,
      far: camera.far,
    },
    annotations,
  }
}

async function snapshot(): Promise<void> {
  // ensure canvas reflects latest scene state
  renderFrame()
  const labels = buildLabels()
  const ts = labels.image.ts
  await downloadPng(canvas, `eggbelt_${ts}.png`)
  downloadJson(labels, `eggbelt_${ts}.json`)
}

let recorder: MediaRecorder | null = null
let recordedChunks: Blob[] = []
let recordedMime = 'video/webm'
let recordingStart = 0

function startRecording(): void {
  if (recorder) return
  recordedChunks = []
  const stream = canvas.captureStream(params.targetFps)
  const tryMimes = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ]
  recordedMime = tryMimes.find((m) => MediaRecorder.isTypeSupported(m)) ?? 'video/webm'
  recorder = new MediaRecorder(stream, { mimeType: recordedMime })
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) recordedChunks.push(e.data)
  }
  recorder.onstop = () => {
    const blob = new Blob(recordedChunks, { type: recordedMime })
    downloadBlob(blob, `eggbelt_${Date.now()}.webm`)
    recorder = null
    recordedChunks = []
  }
  recordingStart = Date.now()
  recorder.start(1000) // emit chunks every 1s
}

function stopRecording(): void {
  if (recorder && recorder.state !== 'inactive') {
    recorder.stop()
  }
}

// ---------------- input + resize ----------------
addEventListener('keydown', (e) => {
  if (e.key === 'h' || e.key === 'H') document.body.classList.toggle('hide-ui')
})
addEventListener('resize', applyRenderSize)
applyRenderSize()

// ---------------- loop ----------------
const statsEl = document.getElementById('stats') as HTMLElement
const PHYSICS_DT = 1 / 60
let last = performance.now()
let fpsAccum = 0
let fpsCount = 0
let physicsAccum = 0
let renderAccum = 0
let simT = 0
const flickerSeed = Math.random() * 1000

// auto-orbit phase offsets
const orbitPhase = {
  az1: Math.random() * 1000,
  az2: Math.random() * 1000,
  el:  Math.random() * 1000,
  d:   Math.random() * 1000,
}

// physics step at fixed PHYSICS_DT — independent of render fps
function physicsStep(dt: number): void {
  tickSpawner(dt)
  driveEggs(dt)
  world.timestep = dt
  world.step()
  for (const e of eggs) {
    const tt = e.body.translation()
    const r = e.body.rotation()
    e.mesh.position.set(tt.x, tt.y, tt.z)
    e.mesh.quaternion.set(r.x, r.y, r.z, r.w)
  }
}

// per-render visual updates (lights, texture scroll). dt = render period.
function visualStep(dt: number): void {
  simT += dt
  const t = simT

  let az = params.keyAzimuth
  let el = params.keyElevation
  let dist = params.keyDistance
  if (params.lightAutoOrbit) {
    const s = params.lightOrbitSpeed
    const slow = t * 0.05 * s
    az += Math.sin(slow + orbitPhase.az1) * 0.55 + Math.sin(slow * 2.7 + orbitPhase.az2) * 0.25
    el += Math.sin(slow * 1.3 + orbitPhase.el) * 0.25
    dist += Math.sin(slow * 0.8 + orbitPhase.d) * 1.4
    el = Math.max(0.1, Math.min(Math.PI / 2 - 0.05, el))
    dist = Math.max(1.5, Math.min(11, dist))
  }
  applyLightAngle(az, el, dist)

  const fk = 1 + (
    Math.sin(t * 9 + flickerSeed) * 0.3 +
    Math.sin(t * 23 + flickerSeed * 1.7) * 0.2 +
    (Math.random() - 0.5) * 0.4
  ) * params.flicker
  keyLight.intensity = params.keyIntensity * fk
  keyLight2.intensity = params.keyIntensity * 0.6 * (2 - fk)

  const scroll = (params.beltSpeed * dt * params.flowDirection) / beltSet.repeatScale
  beltSet.map.offset.y = (beltSet.map.offset.y + scroll) % 1
  beltSet.normalMap.offset.y = beltSet.map.offset.y
  if (beltSet.roughnessMap) beltSet.roughnessMap.offset.y = beltSet.map.offset.y
}

function renderFrame(): void {
  filterPass.uniforms.uTime.value = simT
  if (params.filterEnabled) composer.render()
  else renderer.render(scene, camera)
  drawOverlay()
}

function drawOverlay(): void {
  const w = overlayCanvas.width
  const h = overlayCanvas.height
  overlayCtx.clearRect(0, 0, w, h)
  if (!params.showBboxes && !params.showObbs) return

  for (const e of eggs) {
    e.mesh.updateMatrixWorld(true)
    if (params.showBboxes) {
      const aabb = computeAabb(e.verts, e.mesh, camera, w, h)
      if (aabb) {
        overlayCtx.strokeStyle = 'rgba(0,255,140,0.9)'
        overlayCtx.lineWidth = 1
        overlayCtx.strokeRect(aabb.x + 0.5, aabb.y + 0.5, aabb.w, aabb.h)
      }
    }
    if (params.showObbs) {
      const obb = computeObb(e.verts, e.mesh, camera, w, h)
      if (obb) {
        overlayCtx.save()
        overlayCtx.translate(obb.cx, obb.cy)
        overlayCtx.rotate(obb.angle)
        overlayCtx.strokeStyle = 'rgba(255,180,0,0.9)'
        overlayCtx.lineWidth = 1
        overlayCtx.strokeRect(-obb.w / 2, -obb.h / 2, obb.w, obb.h)
        overlayCtx.restore()
      }
    }
  }
}

function loop(now: number): void {
  requestAnimationFrame(loop)
  const elapsed = Math.min((now - last) / 1000, 0.1)
  last = now

  // physics: step at fixed PHYSICS_DT, decoupled from render fps
  physicsAccum += elapsed
  let steps = 0
  while (physicsAccum >= PHYSICS_DT && steps < 12) {
    physicsStep(PHYSICS_DT)
    physicsAccum -= PHYSICS_DT
    steps++
  }
  if (steps >= 12) physicsAccum = 0 // cap catch-up to avoid spiral

  // render: snapshot at targetFps
  const renderPeriod = 1 / Math.max(1, params.targetFps)
  renderAccum += elapsed
  if (renderAccum >= renderPeriod) {
    visualStep(renderAccum)
    renderFrame()
    renderAccum = renderAccum % renderPeriod

    fpsAccum += renderPeriod
    fpsCount++
    if (fpsAccum > 0.5) {
      const fps = fpsCount / fpsAccum
      fpsAccum = 0
      fpsCount = 0
      statsEl.textContent = `eggs ${eggs.length} · ${fps.toFixed(0)} fps`
    }
  }
}
requestAnimationFrame(loop)
