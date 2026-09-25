import { useEffect, useImperativeHandle, useRef, forwardRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import type { ProductId, ArtSizeCm } from './products'
import { getProduct } from './products'

/** 1 unidade Three.js = 1 cm */
export type ArtTransform = {
  /** Deslocamento horizontal em cm (positivo = direita do produto) */
  offsetXCm: number
  /** Deslocamento vertical em cm (positivo = sobe) */
  offsetYCm: number
  rotationDeg: number
  flipH: boolean
  flipV: boolean
}

export type MockupCanvasHandle = {
  capture: (width: number, height: number) => string | null
  setViewAngle: (angle: 'frente' | 'tresquartos') => void
}

type Props = {
  productId: ProductId
  colors: Record<string, string>
  backgroundColor: string
  artImage: HTMLImageElement | null
  artSizeCm: ArtSizeCm
  transform: ArtTransform
  showGuide?: boolean
  frosting?: number
  className?: string
}

const TEX_SIZE = 1024

function bakeArtTexture(
  art: HTMLImageElement | null,
  transform: ArtTransform,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = TEX_SIZE
  canvas.height = TEX_SIZE
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, TEX_SIZE, TEX_SIZE)
  if (!art) return canvas

  const cx = TEX_SIZE / 2
  const cy = TEX_SIZE / 2
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate((transform.rotationDeg * Math.PI) / 180)
  ctx.scale(transform.flipH ? -1 : 1, transform.flipV ? -1 : 1)

  const artAspect = art.naturalWidth / Math.max(art.naturalHeight, 1)
  let dw: number
  let dh: number
  if (artAspect >= 1) {
    dw = TEX_SIZE * 0.92
    dh = dw / artAspect
  } else {
    dh = TEX_SIZE * 0.92
    dw = dh * artAspect
  }
  ctx.drawImage(art, -dw / 2, -dh / 2, dw, dh)
  ctx.restore()
  return canvas
}

function disposeObject(obj: THREE.Object3D) {
  obj.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (mesh.isMesh) {
      mesh.geometry?.dispose()
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const m of mats) {
        if (!m) continue
        const std = m as THREE.MeshStandardMaterial
        if (std.map) std.map.dispose()
        m.dispose()
      }
    }
  })
}

function porcelainMaterial(color: string, opts: { map?: THREE.Texture | null; roughness?: number } = {}) {
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(color),
    roughness: opts.roughness ?? 0.28,
    metalness: 0.0,
    clearcoat: 0.55,
    clearcoatRoughness: 0.18,
    map: opts.map ?? null,
    side: THREE.FrontSide,
  })
}

function glassMaterial(tint: string, frosting: number) {
  const c = new THREE.Color(tint)
  const rough = 0.04 + frosting * 0.55
  return new THREE.MeshPhysicalMaterial({
    color: c,
    roughness: rough,
    metalness: 0,
    transmission: Math.max(0.05, 0.92 - frosting * 0.7),
    thickness: 0.45,
    ior: 1.5,
    transparent: true,
    opacity: 1,
    attenuationColor: c,
    attenuationDistance: 2.5,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
}

/** Copo americano Nadir-like: ridges/bands, slight taper, thick glass feel */
function buildCopoAmericano(colors: Record<string, string>, frosting: number): THREE.Group {
  const group = new THREE.Group()
  const tint = colors.glass ?? '#e8f4fc'
  const mat = glassMaterial(tint, frosting)

  // Profile: x = radius (cm), y = height from bottom (cm)
  // Ø 6.7 → r≈3.35; H 9.3; characteristic mid ridges
  const outer: THREE.Vector2[] = [
    new THREE.Vector2(0.01, 0.0),
    new THREE.Vector2(2.95, 0.0),
    new THREE.Vector2(3.05, 0.15),
    new THREE.Vector2(3.1, 0.55),
    new THREE.Vector2(3.12, 1.4),
    // ridge band 1
    new THREE.Vector2(3.28, 1.85),
    new THREE.Vector2(3.14, 2.15),
    // ridge band 2
    new THREE.Vector2(3.3, 2.55),
    new THREE.Vector2(3.15, 2.85),
    // ridge band 3
    new THREE.Vector2(3.32, 3.25),
    new THREE.Vector2(3.18, 3.55),
    new THREE.Vector2(3.22, 4.5),
    new THREE.Vector2(3.28, 6.2),
    new THREE.Vector2(3.32, 8.2),
    new THREE.Vector2(3.35, 9.15),
    new THREE.Vector2(3.38, 9.3), // rim lip
    new THREE.Vector2(3.2, 9.3),
  ]
  const outerGeo = new THREE.LatheGeometry(outer, 96)
  const outerMesh = new THREE.Mesh(outerGeo, mat)
  outerMesh.castShadow = true
  outerMesh.receiveShadow = true
  group.add(outerMesh)

  // Inner wall (hollow look)
  const wall = 0.18
  const inner: THREE.Vector2[] = [
    new THREE.Vector2(3.2 - wall, 9.25),
    new THREE.Vector2(3.12 - wall, 8.0),
    new THREE.Vector2(3.05 - wall, 4.5),
    new THREE.Vector2(2.95 - wall, 1.5),
    new THREE.Vector2(2.85 - wall, 0.35),
    new THREE.Vector2(0.01, 0.28),
  ]
  const innerMat = glassMaterial(tint, Math.min(1, frosting + 0.05))
  innerMat.side = THREE.BackSide
  const innerMesh = new THREE.Mesh(new THREE.LatheGeometry(inner, 64), innerMat)
  group.add(innerMesh)

  // Subtle bottom pad for contact shadow contact
  const foot = new THREE.Mesh(
    new THREE.CylinderGeometry(2.9, 2.95, 0.08, 48),
    glassMaterial(tint, frosting + 0.1),
  )
  foot.position.y = 0.04
  foot.castShadow = true
  group.add(foot)

  group.userData.printRadius = 3.25
  group.userData.printCenterY = 5.2
  group.userData.targetY = 4.65
  return group
}

/** Xícara cerâmica ~325 ml with handle */
function buildXicara(colors: Record<string, string>): THREE.Group {
  const group = new THREE.Group()
  const bodyCol = colors.body ?? '#f7f4ef'
  const handleCol = colors.handle ?? bodyCol
  const interiorCol = colors.interior ?? '#ffffff'

  const bodyMat = porcelainMaterial(bodyCol)
  const handleMat = porcelainMaterial(handleCol, { roughness: 0.32 })
  const interiorMat = porcelainMaterial(interiorCol, { roughness: 0.4 })

  // Outer body profile (cm): Ø≈8.2 → r≈4.1; H≈9.5
  const outer: THREE.Vector2[] = [
    new THREE.Vector2(0.01, 0.0),
    new THREE.Vector2(3.4, 0.0),
    new THREE.Vector2(3.55, 0.2),
    new THREE.Vector2(3.65, 0.7),
    new THREE.Vector2(3.8, 2.5),
    new THREE.Vector2(3.95, 5.0),
    new THREE.Vector2(4.05, 7.5),
    new THREE.Vector2(4.1, 9.2),
    new THREE.Vector2(4.15, 9.5), // rim
    new THREE.Vector2(3.95, 9.5),
  ]
  const body = new THREE.Mesh(new THREE.LatheGeometry(outer, 96), bodyMat)
  body.castShadow = true
  body.receiveShadow = true
  group.add(body)

  // Interior well
  const wall = 0.28
  const inner: THREE.Vector2[] = [
    new THREE.Vector2(3.95 - wall, 9.45),
    new THREE.Vector2(3.85 - wall, 7.0),
    new THREE.Vector2(3.6 - wall, 3.0),
    new THREE.Vector2(3.35 - wall, 0.55),
    new THREE.Vector2(0.01, 0.45),
  ]
  const interior = new THREE.Mesh(new THREE.LatheGeometry(inner, 64), interiorMat)
  group.add(interior)

  // Handle — tube along a C-curve on +X side
  const handleCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(3.9, 7.4, 0),
    new THREE.Vector3(5.4, 7.6, 0),
    new THREE.Vector3(6.1, 5.8, 0),
    new THREE.Vector3(5.9, 3.6, 0),
    new THREE.Vector3(5.2, 2.4, 0),
    new THREE.Vector3(3.85, 2.6, 0),
  ])
  const handleGeo = new THREE.TubeGeometry(handleCurve, 64, 0.42, 16, false)
  const handle = new THREE.Mesh(handleGeo, handleMat)
  handle.castShadow = true
  group.add(handle)

  // Handle end caps (soft blend into body)
  for (const t of [0, 1]) {
    const p = handleCurve.getPoint(t)
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.45, 16, 12), handleMat)
    cap.position.copy(p)
    group.add(cap)
  }

  group.userData.printRadius = 4.0
  group.userData.printCenterY = 5.0
  group.userData.targetY = 4.75
  return group
}

/** Ceramic plate with rim lip + slight concavity */
function buildPrato(colors: Record<string, string>): THREE.Group {
  const group = new THREE.Group()
  const plateCol = colors.plate ?? '#f5f0e8'
  const rimCol = colors.rim ?? plateCol
  const plateMat = porcelainMaterial(plateCol, { roughness: 0.3 })
  const rimMat = porcelainMaterial(rimCol, { roughness: 0.28 })

  // Cross-section: Ø 22 cm → r=11. Foot + well + rim.
  const profile: THREE.Vector2[] = [
    new THREE.Vector2(0.01, 0.55), // well center
    new THREE.Vector2(4.5, 0.52),
    new THREE.Vector2(7.0, 0.55),
    new THREE.Vector2(8.2, 0.75), // rise to rim
    new THREE.Vector2(9.2, 1.35),
    new THREE.Vector2(10.2, 1.85),
    new THREE.Vector2(10.8, 2.05), // rim top
    new THREE.Vector2(11.0, 1.95), // outer lip
    new THREE.Vector2(10.95, 1.55),
    new THREE.Vector2(10.5, 1.0),
    new THREE.Vector2(9.0, 0.45),
    new THREE.Vector2(7.5, 0.2), // underside
    new THREE.Vector2(5.5, 0.12),
    new THREE.Vector2(4.0, 0.25), // foot ring start
    new THREE.Vector2(3.6, 0.55),
    new THREE.Vector2(3.5, 0.15),
    new THREE.Vector2(0.01, 0.12),
  ]
  const body = new THREE.Mesh(new THREE.LatheGeometry(profile, 128), plateMat)
  body.castShadow = true
  body.receiveShadow = true
  group.add(body)

  // Slightly raised rim accent (optional separate color)
  if (rimCol.toLowerCase() !== plateCol.toLowerCase()) {
    const rimProfile: THREE.Vector2[] = [
      new THREE.Vector2(9.4, 1.55),
      new THREE.Vector2(10.3, 1.95),
      new THREE.Vector2(10.85, 2.08),
      new THREE.Vector2(11.0, 1.98),
      new THREE.Vector2(10.7, 1.7),
      new THREE.Vector2(9.6, 1.4),
    ]
    const rim = new THREE.Mesh(new THREE.LatheGeometry(rimProfile, 96), rimMat)
    rim.castShadow = true
    group.add(rim)
  }

  group.userData.printRadius = 0 // flat
  group.userData.printCenterY = 0.85
  group.userData.targetY = 1.1
  group.userData.isFlat = true
  return group
}

function buildProduct(productId: ProductId, colors: Record<string, string>, frosting: number): THREE.Group {
  if (productId === 'copo_americano') return buildCopoAmericano(colors, frosting)
  if (productId === 'xicara_cafe') return buildXicara(colors)
  return buildPrato(colors)
}

/**
 * UV DTF decal at true physical size (cm).
 * Curved products: partial cylinder patch with arc length = art width.
 * Plate: flat plane on the well face.
 */
function buildDecal(
  product: THREE.Group,
  artTex: THREE.CanvasTexture | null,
  artSize: ArtSizeCm,
  transform: ArtTransform,
  showGuide: boolean,
): THREE.Group {
  const decalGroup = new THREE.Group()
  const radius: number = product.userData.printRadius ?? 0
  const centerY: number = (product.userData.printCenterY ?? 5) + transform.offsetYCm
  const isFlat = !!product.userData.isFlat
  const artW = Math.max(0.5, artSize.width)
  const artH = Math.max(0.5, artSize.height)

  if (isFlat || radius < 0.1) {
    // Flat plate: offsets move in the plate plane (X / Z). Y stays on the well face.
    const faceY = (product.userData.printCenterY ?? 0.85) + 0.04
    const px = transform.offsetXCm
    const pz = -transform.offsetYCm
    if (artTex) {
      const geo = new THREE.PlaneGeometry(artW, artH)
      const mat = new THREE.MeshStandardMaterial({
        map: artTex,
        transparent: true,
        roughness: 0.45,
        metalness: 0,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.rotation.x = -Math.PI / 2
      mesh.position.set(px, faceY, pz)
      mesh.name = 'printArea'
      decalGroup.add(mesh)
    }

    if (showGuide) {
      const guide = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.PlaneGeometry(artW, artH)),
        new THREE.LineBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.45 }),
      )
      guide.rotation.x = -Math.PI / 2
      guide.position.set(px, faceY + 0.01, pz)
      decalGroup.add(guide)
    }
    return decalGroup
  }

  // Curved frontal patch: arc length = artW → theta = artW / radius
  const theta = artW / radius
  const segs = Math.max(24, Math.ceil(48 * (theta / Math.PI)))
  // Front faces +Z; thetaStart from +X CCW → center on +Z ⇒ π/2 − θ/2
  const thetaStart = Math.PI / 2 - theta / 2
  const patchR = radius + 0.06

  if (artTex) {
    const geo = new THREE.CylinderGeometry(patchR, patchR, artH, segs, 1, true, thetaStart, theta)
    const mat = new THREE.MeshStandardMaterial({
      map: artTex,
      transparent: true,
      roughness: 0.42,
      metalness: 0.02,
      depthWrite: false,
      side: THREE.FrontSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.y = centerY
    // Horizontal offset: rotate around Y (cm along circumference → radians)
    mesh.rotation.y = -transform.offsetXCm / radius
    mesh.name = 'printArea'
    decalGroup.add(mesh)
  }

  if (showGuide) {
    const gGeo = new THREE.CylinderGeometry(patchR + 0.02, patchR + 0.02, artH, segs, 1, true, thetaStart, theta)
    const edges = new THREE.EdgesGeometry(gGeo)
    gGeo.dispose()
    const guide = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.4 }),
    )
    guide.position.y = centerY
    guide.rotation.y = -transform.offsetXCm / radius
    decalGroup.add(guide)
  }

  return decalGroup
}

const MockupCanvas = forwardRef<MockupCanvasHandle, Props>(function MockupCanvas(
  {
    productId,
    colors,
    backgroundColor,
    artImage,
    artSizeCm,
    transform,
    showGuide = true,
    frosting = 0.08,
    className,
  },
  ref,
) {
  const mountRef = useRef<HTMLDivElement>(null)
  const stateRef = useRef<{
    renderer: THREE.WebGLRenderer
    scene: THREE.Scene
    camera: THREE.PerspectiveCamera
    controls: OrbitControls
    productRoot: THREE.Group | null
    artTex: THREE.CanvasTexture | null
    ground: THREE.Mesh
    pmrem: THREE.PMREMGenerator
    animId: number
  } | null>(null)

  useImperativeHandle(ref, () => ({
    capture(width: number, height: number) {
      const s = stateRef.current
      const mount = mountRef.current
      if (!s || !mount) return null

      s.renderer.setPixelRatio(1)
      s.renderer.setSize(width, height, false)
      s.camera.aspect = width / height
      s.camera.updateProjectionMatrix()
      s.controls.update()
      s.renderer.render(s.scene, s.camera)
      const url = s.renderer.domElement.toDataURL('image/png')

      const rect = mount.getBoundingClientRect()
      s.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      s.renderer.setSize(rect.width, rect.height, false)
      s.camera.aspect = rect.width / Math.max(rect.height, 1)
      s.camera.updateProjectionMatrix()
      return url
    },
    setViewAngle(angle) {
      const s = stateRef.current
      if (!s) return
      const targetY = s.productRoot?.userData.targetY ?? 4.5
      s.controls.target.set(0, targetY, 0)
      if (angle === 'frente') {
        s.camera.position.set(0, targetY + 1.5, productId === 'prato' ? 28 : 18)
      } else {
        s.camera.position.set(
          productId === 'prato' ? 16 : 11,
          targetY + (productId === 'prato' ? 14 : 4),
          productId === 'prato' ? 16 : 14,
        )
      }
      s.controls.update()
    },
  }))

  // Init scene once
  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(backgroundColor)

    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 200)
    camera.position.set(11, 8, 14)

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      preserveDrawingBuffer: true,
      alpha: false,
      powerPreference: 'high-performance',
    })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05
    mount.appendChild(renderer.domElement)

    const pmrem = new THREE.PMREMGenerator(renderer)
    const env = new RoomEnvironment()
    scene.environment = pmrem.fromScene(env, 0.04).texture
    env.dispose()

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.07
    controls.minDistance = 8
    controls.maxDistance = 50
    controls.maxPolarAngle = Math.PI * 0.495
    controls.target.set(0, 4.5, 0)

    // Soft studio lights
    scene.add(new THREE.AmbientLight(0xffffff, 0.35))
    const key = new THREE.DirectionalLight(0xfff6e8, 1.35)
    key.position.set(8, 16, 6)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.camera.near = 1
    key.shadow.camera.far = 50
    key.shadow.camera.left = -20
    key.shadow.camera.right = 20
    key.shadow.camera.top = 20
    key.shadow.camera.bottom = -20
    key.shadow.bias = -0.0002
    scene.add(key)
    const fill = new THREE.DirectionalLight(0xc9d7ff, 0.5)
    fill.position.set(-10, 8, -4)
    scene.add(fill)
    const rim = new THREE.DirectionalLight(0xffffff, 0.35)
    rim.position.set(0, 10, -12)
    scene.add(rim)

    // Ground contact shadow
    const groundGeo = new THREE.CircleGeometry(30, 64)
    const groundMat = new THREE.ShadowMaterial({ opacity: 0.32 })
    const ground = new THREE.Mesh(groundGeo, groundMat)
    ground.rotation.x = -Math.PI / 2
    ground.position.y = 0
    ground.receiveShadow = true
    scene.add(ground)

    const floorMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(backgroundColor).multiplyScalar(0.94),
      roughness: 0.92,
      metalness: 0,
    })
    const floor = new THREE.Mesh(new THREE.CircleGeometry(28, 64), floorMat)
    floor.rotation.x = -Math.PI / 2
    floor.position.y = -0.01
    floor.receiveShadow = true
    scene.add(floor)
    ground.userData.floor = floor

    const resize = () => {
      const rect = mount.getBoundingClientRect()
      const w = Math.max(rect.width, 1)
      const h = Math.max(rect.height, 1)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h, false)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(mount)

    stateRef.current = {
      renderer,
      scene,
      camera,
      controls,
      productRoot: null,
      artTex: null,
      ground,
      pmrem,
      animId: 0,
    }

    const tick = () => {
      const st = stateRef.current
      if (!st) return
      st.animId = requestAnimationFrame(tick)
      st.controls.update()
      st.renderer.render(st.scene, st.camera)
    }
    tick()

    return () => {
      ro.disconnect()
      const st = stateRef.current
      if (st) {
        cancelAnimationFrame(st.animId)
        if (st.productRoot) {
          st.scene.remove(st.productRoot)
          disposeObject(st.productRoot)
        }
        if (st.artTex) st.artTex.dispose()
        st.controls.dispose()
        st.pmrem.dispose()
        st.scene.environment?.dispose()
        st.renderer.dispose()
        if (st.renderer.domElement.parentNode === mount) {
          mount.removeChild(st.renderer.domElement)
        }
      }
      stateRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- init once
  }, [])

  useEffect(() => {
    const s = stateRef.current
    if (!s) return
    s.scene.background = new THREE.Color(backgroundColor)
    const floor = s.ground.userData.floor as THREE.Mesh | undefined
    if (floor) {
      const m = floor.material as THREE.MeshStandardMaterial
      m.color = new THREE.Color(backgroundColor).multiplyScalar(0.94)
    }
  }, [backgroundColor])

  // Rebuild product + decal
  useEffect(() => {
    const s = stateRef.current
    if (!s) return

    if (s.productRoot) {
      s.scene.remove(s.productRoot)
      disposeObject(s.productRoot)
      s.productRoot = null
    }
    if (s.artTex) {
      s.artTex.dispose()
      s.artTex = null
    }

    const root = new THREE.Group()
    const product = buildProduct(productId, colors, frosting)
    root.add(product)
    root.userData = { ...product.userData }

    let tex: THREE.CanvasTexture | null = null
    if (artImage) {
      const baked = bakeArtTexture(artImage, transform)
      tex = new THREE.CanvasTexture(baked)
      tex.colorSpace = THREE.SRGBColorSpace
      tex.anisotropy = s.renderer.capabilities.getMaxAnisotropy()
      tex.wrapS = THREE.ClampToEdgeWrapping
      tex.wrapT = THREE.ClampToEdgeWrapping
      tex.needsUpdate = true
      s.artTex = tex
    }

    const decal = buildDecal(product, tex, artSizeCm, transform, showGuide)
    root.add(decal)

    s.scene.add(root)
    s.productRoot = root

    // Frame camera when product changes
    const targetY = product.userData.targetY ?? getProduct(productId).heightCm / 2
    s.controls.target.set(0, targetY, 0)
    root.userData.productId = productId
    const meta = s as typeof s & { lastProductId?: ProductId }
    if (meta.lastProductId !== productId) {
      const dist = productId === 'prato' ? 26 : 16
      s.camera.position.set(
        dist * 0.55,
        targetY + (productId === 'prato' ? 12 : 3.2),
        dist * 0.75,
      )
      meta.lastProductId = productId
    }
    s.controls.update()
  }, [productId, colors, artImage, artSizeCm, transform, showGuide, frosting])

  return <div ref={mountRef} className={className} />
})

export default MockupCanvas
