import * as THREE from 'three'
import type { ProductId } from './products'

/** Shared brushed-steel roughness (horizontal lines) — created once, disposed with scene teardown via disposeObject maps. */
let brushedRoughnessCache: THREE.CanvasTexture | null = null

export function getBrushedRoughnessMap(): THREE.CanvasTexture {
  if (brushedRoughnessCache) return brushedRoughnessCache
  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#808080'
  ctx.fillRect(0, 0, size, size)
  for (let y = 0; y < size; y++) {
    const v = 110 + Math.floor(Math.random() * 40) + (y % 3 === 0 ? 18 : 0)
    ctx.fillStyle = `rgb(${v},${v},${v})`
    ctx.fillRect(0, y, size, 1)
    if (Math.random() > 0.97) {
      const bright = 160 + Math.floor(Math.random() * 50)
      ctx.fillStyle = `rgb(${bright},${bright},${bright})`
      ctx.fillRect(0, y, size, 1)
    }
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(2, 6)
  tex.anisotropy = 8
  tex.needsUpdate = true
  tex.userData.shared = true
  brushedRoughnessCache = tex
  return tex
}

export function porcelainMaterial(
  color: string,
  opts: { map?: THREE.Texture | null; roughness?: number; clearcoat?: number } = {},
) {
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(color),
    roughness: opts.roughness ?? 0.22,
    metalness: 0.0,
    clearcoat: opts.clearcoat ?? 0.72,
    clearcoatRoughness: 0.12,
    sheen: 0.18,
    sheenRoughness: 0.45,
    sheenColor: new THREE.Color('#fff8f0'),
    reflectivity: 0.55,
    map: opts.map ?? null,
    side: THREE.FrontSide,
  })
}

export function glassMaterial(tint: string, frosting: number, thickness = 0.32) {
  const c = new THREE.Color(tint)
  const rough = 0.025 + frosting * 0.58
  return new THREE.MeshPhysicalMaterial({
    color: c.clone().lerp(new THREE.Color('#ffffff'), 0.35),
    roughness: rough,
    metalness: 0,
    transmission: Math.max(0.04, 0.94 - frosting * 0.75),
    thickness,
    ior: 1.52,
    transparent: true,
    opacity: 1,
    attenuationColor: c,
    attenuationDistance: 1.8 + frosting * 2.5,
    specularIntensity: 1,
    envMapIntensity: 1.15,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
}

export function metalMaterial(
  color: string,
  opts: { roughness?: number; metalness?: number; painted?: boolean } = {},
) {
  const painted = opts.painted ?? false
  const hex = color.toLowerCase()
  const isBrightMetal =
    hex === '#c5c9ce' || hex === '#b76e79' || hex.includes('c5c9') || hex.includes('b76e')
  const useBrush = !painted && isBrightMetal
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(color),
    roughness: opts.roughness ?? (useBrush ? 0.32 : painted ? 0.48 : 0.38),
    metalness: opts.metalness ?? (painted ? 0.35 : 0.92),
    clearcoat: painted ? 0.35 : 0.15,
    clearcoatRoughness: painted ? 0.35 : 0.4,
    roughnessMap: useBrush ? getBrushedRoughnessMap() : null,
    anisotropy: useBrush ? 0.65 : 0,
    anisotropyRotation: 0, // brushed along U (horizontal around cylinder after lathe UV)
    envMapIntensity: 1.2,
    side: THREE.FrontSide,
  })
}

function addLathe(
  group: THREE.Group,
  points: THREE.Vector2[],
  mat: THREE.Material,
  segments = 128,
  cast = true,
) {
  const mesh = new THREE.Mesh(new THREE.LatheGeometry(points, segments), mat)
  mesh.castShadow = cast
  mesh.receiveShadow = true
  group.add(mesh)
  return mesh
}

/** Copo americano Nadir-like: dual shell, carved ridge bands, thick base, lip chamfer */
export function buildCopoAmericano(colors: Record<string, string>, frosting: number): THREE.Group {
  const group = new THREE.Group()
  const tint = colors.glass ?? '#e8f4fc'
  const wall = 0.3
  const outerMat = glassMaterial(tint, frosting, wall)
  const innerMat = glassMaterial(tint, Math.min(1, frosting + 0.04), wall * 0.85)
  innerMat.side = THREE.BackSide

  // Outer profile Ø6.7 → r≈3.35; H 9.3 — classic mid ridge stack
  const outer: THREE.Vector2[] = [
    new THREE.Vector2(0.01, 0.0),
    new THREE.Vector2(2.85, 0.0),
    new THREE.Vector2(3.0, 0.12),
    new THREE.Vector2(3.08, 0.45),
    new THREE.Vector2(3.1, 1.15),
    // carved ridges (outward then back)
    new THREE.Vector2(3.12, 1.55),
    new THREE.Vector2(3.38, 1.72),
    new THREE.Vector2(3.4, 1.95),
    new THREE.Vector2(3.14, 2.12),
    new THREE.Vector2(3.38, 2.32),
    new THREE.Vector2(3.42, 2.55),
    new THREE.Vector2(3.15, 2.72),
    new THREE.Vector2(3.4, 2.92),
    new THREE.Vector2(3.44, 3.15),
    new THREE.Vector2(3.16, 3.32),
    new THREE.Vector2(3.42, 3.52),
    new THREE.Vector2(3.45, 3.75),
    new THREE.Vector2(3.18, 3.92),
    new THREE.Vector2(3.22, 4.6),
    new THREE.Vector2(3.26, 6.0),
    new THREE.Vector2(3.3, 7.8),
    new THREE.Vector2(3.33, 8.9),
    // lip chamfer
    new THREE.Vector2(3.36, 9.18),
    new THREE.Vector2(3.42, 9.28),
    new THREE.Vector2(3.38, 9.3),
    new THREE.Vector2(3.2, 9.3),
  ]
  addLathe(group, outer, outerMat, 160)

  const inner: THREE.Vector2[] = [
    new THREE.Vector2(3.2 - wall * 0.55, 9.28),
    new THREE.Vector2(3.28 - wall, 9.15),
    new THREE.Vector2(3.22 - wall, 8.0),
    new THREE.Vector2(3.12 - wall, 5.5),
    new THREE.Vector2(3.05 - wall, 3.5),
    new THREE.Vector2(2.95 - wall, 1.4),
    new THREE.Vector2(2.82 - wall, 0.55),
    new THREE.Vector2(0.01, 0.42),
  ]
  addLathe(group, inner, innerMat, 96, false)

  // Thick solid-feeling base plug (slightly denser glass)
  const baseMat = glassMaterial(tint, Math.min(1, frosting + 0.12), 0.8)
  baseMat.transmission = Math.max(0.02, 0.55 - frosting * 0.4)
  baseMat.depthWrite = true
  const base = new THREE.Mesh(new THREE.CylinderGeometry(2.88, 2.95, 0.38, 64), baseMat)
  base.position.y = 0.19
  base.castShadow = true
  group.add(base)

  group.userData.printRadius = 3.28
  group.userData.printCenterY = 5.2
  group.userData.targetY = 4.65
  return group
}

type MugOpts = {
  height: number
  rimR: number
  baseR: number
  belly: number
  wall: number
  handleThick: number
  handleOut: number
  printRadius: number
  printCenterY: number
  targetY: number
  doubleWallHint?: boolean
}

function buildMugBody(colors: Record<string, string>, opts: MugOpts): THREE.Group {
  const group = new THREE.Group()
  const bodyCol = colors.body ?? '#f7f4ef'
  const handleCol = colors.handle ?? bodyCol
  const interiorCol = colors.interior ?? '#ffffff'

  const bodyMat = porcelainMaterial(bodyCol, { roughness: 0.2, clearcoat: 0.78 })
  const handleMat = porcelainMaterial(handleCol, { roughness: 0.24, clearcoat: 0.7 })
  const interiorMat = porcelainMaterial(interiorCol, { roughness: 0.38, clearcoat: 0.35 })

  const H = opts.height
  const rim = opts.rimR
  const base = opts.baseR
  const belly = opts.belly
  const mid = H * 0.48

  const outer: THREE.Vector2[] = [
    new THREE.Vector2(0.01, 0.0),
    new THREE.Vector2(base * 0.92, 0.0),
    new THREE.Vector2(base, 0.12),
    new THREE.Vector2(base + 0.08, 0.35),
    new THREE.Vector2(base + belly * 0.35, H * 0.18),
    new THREE.Vector2(base + belly, mid),
    new THREE.Vector2(rim - 0.05, H * 0.82),
    new THREE.Vector2(rim, H - 0.18),
    // thick lip
    new THREE.Vector2(rim + 0.06, H - 0.04),
    new THREE.Vector2(rim + 0.02, H),
    new THREE.Vector2(rim - opts.wall * 0.35, H),
  ]
  addLathe(group, outer, bodyMat, 128)

  const w = opts.wall
  const inner: THREE.Vector2[] = [
    new THREE.Vector2(rim - w * 0.4, H - 0.02),
    new THREE.Vector2(rim - w, H - 0.15),
    new THREE.Vector2(rim - w - 0.05, H * 0.75),
    new THREE.Vector2(base + belly - w, mid),
    new THREE.Vector2(base - w * 0.4, H * 0.2),
    new THREE.Vector2(base - w * 0.55, 0.45),
    new THREE.Vector2(0.01, 0.38),
  ]
  addLathe(group, inner, interiorMat, 96, false)

  // Optional subtle outer second wall lip (double-wall espresso look)
  if (opts.doubleWallHint) {
    const shell: THREE.Vector2[] = [
      new THREE.Vector2(rim + 0.08, H * 0.12),
      new THREE.Vector2(rim + 0.18, H * 0.35),
      new THREE.Vector2(rim + 0.14, H * 0.7),
      new THREE.Vector2(rim + 0.05, H - 0.2),
    ]
    const shellMat = porcelainMaterial(bodyCol, { roughness: 0.28, clearcoat: 0.65 })
    addLathe(group, shell, shellMat, 64, false)
  }

  // Handle C-curve on +X
  const ht = opts.handleThick
  const out = opts.handleOut
  const yTop = H * 0.78
  const yBot = H * 0.28
  const attachR = rim - 0.15
  const handleCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(attachR, yTop, 0),
    new THREE.Vector3(attachR + out * 0.45, yTop + ht * 0.15, 0),
    new THREE.Vector3(attachR + out, (yTop + yBot) * 0.55, 0),
    new THREE.Vector3(attachR + out * 0.85, yBot + (yTop - yBot) * 0.15, 0),
    new THREE.Vector3(attachR + out * 0.35, yBot - ht * 0.05, 0),
    new THREE.Vector3(attachR, yBot, 0),
  ])
  const handle = new THREE.Mesh(
    new THREE.TubeGeometry(handleCurve, 80, ht, 20, false),
    handleMat,
  )
  handle.castShadow = true
  group.add(handle)

  for (const t of [0, 1]) {
    const p = handleCurve.getPoint(t)
    const cap = new THREE.Mesh(new THREE.SphereGeometry(ht * 1.05, 20, 16), handleMat)
    cap.position.copy(p)
    cap.castShadow = true
    group.add(cap)
  }

  group.userData.printRadius = opts.printRadius
  group.userData.printCenterY = opts.printCenterY
  group.userData.targetY = opts.targetY
  return group
}

/** Caneca café ~325 ml */
export function buildXicaraCafe(colors: Record<string, string>): THREE.Group {
  return buildMugBody(colors, {
    height: 9.5,
    rimR: 4.1,
    baseR: 3.45,
    belly: 0.35,
    wall: 0.32,
    handleThick: 0.44,
    handleOut: 2.15,
    printRadius: 4.0,
    printCenterY: 5.0,
    targetY: 4.75,
  })
}

/** Xícara chá ~200 ml — smaller, thinner handle */
export function buildXicaraCha(colors: Record<string, string>): THREE.Group {
  return buildMugBody(colors, {
    height: 7.2,
    rimR: 3.6,
    baseR: 3.05,
    belly: 0.28,
    wall: 0.28,
    handleThick: 0.32,
    handleOut: 1.75,
    printRadius: 3.5,
    printCenterY: 3.8,
    targetY: 3.6,
  })
}

/** Compact double-wall / espresso-style mug */
export function buildXicaraDuplaFace(colors: Record<string, string>): THREE.Group {
  return buildMugBody(colors, {
    height: 6.5,
    rimR: 3.2,
    baseR: 2.85,
    belly: 0.18,
    wall: 0.35,
    handleThick: 0.3,
    handleOut: 1.55,
    printRadius: 3.15,
    printCenterY: 3.4,
    targetY: 3.25,
    doubleWallHint: true,
  })
}

/** Ceramic plate with rim lip + well + foot ring (~Ø20 cm) */
export function buildPrato(colors: Record<string, string>): THREE.Group {
  const group = new THREE.Group()
  const plateCol = colors.plate ?? '#f5f0e8'
  const rimCol = colors.rim ?? plateCol
  const plateMat = porcelainMaterial(plateCol, { roughness: 0.26, clearcoat: 0.65 })
  const rimMat = porcelainMaterial(rimCol, { roughness: 0.22, clearcoat: 0.75 })

  const profile: THREE.Vector2[] = [
    new THREE.Vector2(0.01, 0.62),
    new THREE.Vector2(3.5, 0.6),
    new THREE.Vector2(6.2, 0.58),
    new THREE.Vector2(7.4, 0.7),
    new THREE.Vector2(8.3, 1.05),
    new THREE.Vector2(9.1, 1.55),
    new THREE.Vector2(9.7, 1.9),
    new THREE.Vector2(10.0, 2.05),
    // rim lip
    new THREE.Vector2(10.05, 2.12),
    new THREE.Vector2(10.0, 2.05),
    new THREE.Vector2(9.95, 1.75),
    new THREE.Vector2(9.6, 1.25),
    new THREE.Vector2(8.6, 0.7),
    new THREE.Vector2(7.2, 0.35),
    new THREE.Vector2(5.5, 0.18),
    // foot ring
    new THREE.Vector2(4.2, 0.15),
    new THREE.Vector2(3.85, 0.55),
    new THREE.Vector2(3.7, 0.55),
    new THREE.Vector2(3.55, 0.12),
    new THREE.Vector2(0.01, 0.1),
  ]
  addLathe(group, profile, plateMat, 160)

  if (rimCol.toLowerCase() !== plateCol.toLowerCase()) {
    const rimProfile: THREE.Vector2[] = [
      new THREE.Vector2(8.8, 1.45),
      new THREE.Vector2(9.5, 1.85),
      new THREE.Vector2(9.95, 2.08),
      new THREE.Vector2(10.05, 2.12),
      new THREE.Vector2(10.0, 1.95),
      new THREE.Vector2(9.4, 1.55),
      new THREE.Vector2(8.9, 1.35),
    ]
    addLathe(group, rimProfile, rimMat, 96)
  }

  group.userData.printRadius = 0
  group.userData.printCenterY = 0.85
  group.userData.targetY = 1.1
  group.userData.isFlat = true
  return group
}

/** Steel tumbler ~500 ml with lid + silicone base ring */
export function buildGarrafaTermica(colors: Record<string, string>): THREE.Group {
  const group = new THREE.Group()
  const bodyCol = colors.body ?? '#c5c9ce'
  const lidCol = colors.lid ?? '#2a2a2c'
  const baseCol = colors.base ?? '#1a1a1a'

  const hex = bodyCol.toLowerCase()
  const painted =
    hex === '#1c1c1e' ||
    hex === '#f2f2f0' ||
    hex === '#1e3a5f' ||
    hex === '#3d4f3a' ||
    (!hex.includes('c5c9') && !hex.includes('b76e') && hex !== '#c5c9ce' && hex !== '#b76e79')

  const bodyMat = metalMaterial(bodyCol, { painted })
  const lidMat = metalMaterial(lidCol, {
    painted: true,
    roughness: 0.42,
    metalness: 0.55,
  })
  const ringMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(baseCol),
    roughness: 0.82,
    metalness: 0.05,
    clearcoat: 0.1,
  })

  // Body: slight taper, Ø≈7.2 at mid, H body ~17 before lid
  const bodyH = 17.2
  const rBot = 3.45
  const rMid = 3.6
  const rTop = 3.35
  const outer: THREE.Vector2[] = [
    new THREE.Vector2(0.01, 0.35),
    new THREE.Vector2(rBot - 0.15, 0.35),
    new THREE.Vector2(rBot, 0.55),
    new THREE.Vector2(rBot + 0.05, 1.2),
    new THREE.Vector2(rMid, bodyH * 0.45),
    new THREE.Vector2(rMid - 0.05, bodyH * 0.75),
    new THREE.Vector2(rTop, bodyH - 0.15),
    new THREE.Vector2(rTop - 0.05, bodyH),
    new THREE.Vector2(rTop - 0.25, bodyH),
  ]
  addLathe(group, outer, bodyMat, 128)

  // Inner cavity (darker)
  const innerMat = metalMaterial('#2a2a2e', { painted: true, roughness: 0.55, metalness: 0.4 })
  const inner: THREE.Vector2[] = [
    new THREE.Vector2(rTop - 0.28, bodyH - 0.05),
    new THREE.Vector2(rTop - 0.35, bodyH * 0.7),
    new THREE.Vector2(rMid - 0.4, bodyH * 0.4),
    new THREE.Vector2(rBot - 0.45, 1.0),
    new THREE.Vector2(0.01, 0.85),
  ]
  addLathe(group, inner, innerMat, 64, false)

  // Silicone-ish base ring
  const baseRing = new THREE.Mesh(
    new THREE.TorusGeometry(rBot - 0.25, 0.22, 16, 64),
    ringMat,
  )
  baseRing.rotation.x = Math.PI / 2
  baseRing.position.y = 0.22
  baseRing.castShadow = true
  group.add(baseRing)

  const basePad = new THREE.Mesh(new THREE.CylinderGeometry(rBot - 0.35, rBot - 0.3, 0.2, 48), ringMat)
  basePad.position.y = 0.12
  basePad.castShadow = true
  group.add(basePad)

  // Lid assembly
  const lidY = bodyH
  const lidBody = new THREE.Mesh(
    new THREE.CylinderGeometry(rTop + 0.08, rTop + 0.12, 1.35, 64),
    lidMat,
  )
  lidBody.position.y = lidY + 0.68
  lidBody.castShadow = true
  group.add(lidBody)

  // Thread suggestion — thin rings
  const threadMat = metalMaterial(lidCol, { painted: true, roughness: 0.5, metalness: 0.45 })
  for (let i = 0; i < 4; i++) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(rTop + 0.1, 0.045, 10, 48),
      threadMat,
    )
    ring.rotation.x = Math.PI / 2
    ring.position.y = lidY + 0.25 + i * 0.22
    group.add(ring)
  }

  // Cap top dome / sip button
  const capTop = new THREE.Mesh(new THREE.SphereGeometry(rTop * 0.55, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), lidMat)
  capTop.position.y = lidY + 1.35
  capTop.castShadow = true
  group.add(capTop)

  const button = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55, 0.6, 0.25, 32),
    metalMaterial('#3a3a3c', { painted: true, roughness: 0.35, metalness: 0.7 }),
  )
  button.position.y = lidY + 1.55
  button.castShadow = true
  group.add(button)

  // Overall height ~20 cm
  group.userData.printRadius = 3.55
  group.userData.printCenterY = 10.5
  group.userData.targetY = 10.0
  return group
}

export function buildProduct(
  productId: ProductId,
  colors: Record<string, string>,
  frosting: number,
): THREE.Group {
  switch (productId) {
    case 'copo_americano':
      return buildCopoAmericano(colors, frosting)
    case 'xicara_cafe':
      return buildXicaraCafe(colors)
    case 'xicara_cha':
      return buildXicaraCha(colors)
    case 'xicara_dupla_face':
      return buildXicaraDuplaFace(colors)
    case 'prato':
      return buildPrato(colors)
    case 'garrafa_termica':
      return buildGarrafaTermica(colors)
    default:
      return buildCopoAmericano(colors, frosting)
  }
}
