import { useEffect, useImperativeHandle, useRef, forwardRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js'
import type { ProductId, ArtSizeCm } from './products'
import { getProduct } from './products'
import { buildProduct } from './productMeshes'

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
const HDRI_URL = `${import.meta.env.BASE_URL}hdr/studio_small_03_1k.hdr`

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
    if (!mesh.isMesh) return
    mesh.geometry?.dispose()
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const m of mats) {
      if (!m) continue
      const std = m as THREE.MeshStandardMaterial
      for (const key of ['map', 'roughnessMap', 'metalnessMap', 'normalMap', 'aoMap'] as const) {
        const tex = std[key]
        if (tex && !tex.userData?.shared) tex.dispose()
      }
      m.dispose()
    }
  })
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
    const faceY = (product.userData.printCenterY ?? 0.85) + 0.04
    const px = transform.offsetXCm
    const pz = -transform.offsetYCm
    if (artTex) {
      const geo = new THREE.PlaneGeometry(artW, artH)
      const mat = new THREE.MeshPhysicalMaterial({
        map: artTex,
        transparent: true,
        roughness: 0.4,
        metalness: 0,
        clearcoat: 0.25,
        clearcoatRoughness: 0.35,
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

  const theta = artW / radius
  const segs = Math.max(32, Math.ceil(64 * (theta / Math.PI)))
  const thetaStart = Math.PI / 2 - theta / 2
  const patchR = radius + 0.05

  if (artTex) {
    const geo = new THREE.CylinderGeometry(patchR, patchR, artH, segs, 1, true, thetaStart, theta)
    const mat = new THREE.MeshPhysicalMaterial({
      map: artTex,
      transparent: true,
      roughness: 0.38,
      metalness: 0.02,
      clearcoat: 0.2,
      clearcoatRoughness: 0.4,
      depthWrite: false,
      side: THREE.FrontSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.y = centerY
    mesh.rotation.y = -transform.offsetXCm / radius
    mesh.name = 'printArea'
    decalGroup.add(mesh)
  }

  if (showGuide) {
    const gGeo = new THREE.CylinderGeometry(
      patchR + 0.02,
      patchR + 0.02,
      artH,
      segs,
      1,
      true,
      thetaStart,
      theta,
    )
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

function frameDistance(productId: ProductId): number {
  const p = getProduct(productId)
  if (productId === 'prato') return 26
  if (productId === 'garrafa_termica') return 28
  return Math.max(14, p.heightCm * 1.7 + p.diameterCm * 0.8)
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
    softboxMats: THREE.MeshBasicMaterial[]
    animId: number
    lastProductId?: ProductId
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
      const targetY = s.productRoot?.userData.targetY ?? getProduct(productId).heightCm / 2
      const dist = frameDistance(productId)
      s.controls.target.set(0, targetY, 0)
      if (angle === 'frente') {
        s.camera.position.set(0, targetY + (productId === 'prato' ? 8 : 1.2), dist * 0.95)
      } else {
        s.camera.position.set(
          dist * 0.55,
          targetY + (productId === 'prato' ? dist * 0.45 : dist * 0.18),
          dist * 0.7,
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

    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 250)
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
    renderer.toneMappingExposure = 1.08
    mount.appendChild(renderer.domElement)

    const pmrem = new THREE.PMREMGenerator(renderer)
    pmrem.compileEquirectangularShader()

    // Fallback RoomEnvironment immediately; upgrade to HDRI when loaded
    const room = new RoomEnvironment()
    const roomTex = pmrem.fromScene(room, 0.04).texture
    scene.environment = roomTex
    room.dispose()

    new RGBELoader().load(
      HDRI_URL,
      (hdr) => {
        const envMap = pmrem.fromEquirectangular(hdr).texture
        hdr.dispose()
        if (scene.environment && scene.environment !== envMap) {
          scene.environment.dispose()
        }
        scene.environment = envMap
        scene.environmentIntensity = 0.85
      },
      undefined,
      () => {
        /* keep RoomEnvironment fallback */
      },
    )

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.07
    controls.minDistance = 6
    controls.maxDistance = 60
    controls.maxPolarAngle = Math.PI * 0.495
    controls.target.set(0, 4.5, 0)

    // Soft studio lights (key + fill + rim + bounce)
    scene.add(new THREE.AmbientLight(0xffffff, 0.22))
    const key = new THREE.DirectionalLight(0xfff5ea, 1.55)
    key.position.set(9, 18, 7)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.camera.near = 1
    key.shadow.camera.far = 60
    key.shadow.camera.left = -22
    key.shadow.camera.right = 22
    key.shadow.camera.top = 22
    key.shadow.camera.bottom = -22
    key.shadow.bias = -0.00015
    key.shadow.normalBias = 0.02
    scene.add(key)

    const fill = new THREE.DirectionalLight(0xd6e4ff, 0.55)
    fill.position.set(-12, 9, -3)
    scene.add(fill)

    const rim = new THREE.DirectionalLight(0xffffff, 0.45)
    rim.position.set(-2, 12, -14)
    scene.add(rim)

    const bounce = new THREE.DirectionalLight(0xfff8f0, 0.25)
    bounce.position.set(0, -4, 6)
    scene.add(bounce)

    // Softbox panels (subtle visible reflections for glass/metal)
    const softboxMats: THREE.MeshBasicMaterial[] = []
    const makeSoftbox = (w: number, h: number, intensity: number, pos: THREE.Vector3, lookAt: THREE.Vector3) => {
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(1, 1, 1),
        transparent: true,
        opacity: intensity,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
      softboxMats.push(mat)
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat)
      panel.position.copy(pos)
      panel.lookAt(lookAt)
      panel.renderOrder = -1
      scene.add(panel)
    }
    makeSoftbox(14, 10, 0.55, new THREE.Vector3(12, 14, 8), new THREE.Vector3(0, 5, 0))
    makeSoftbox(10, 8, 0.35, new THREE.Vector3(-11, 10, -6), new THREE.Vector3(0, 5, 0))
    makeSoftbox(16, 6, 0.25, new THREE.Vector3(0, 16, -8), new THREE.Vector3(0, 5, 0))

    // Ground contact shadow + subtle reflective floor
    const groundGeo = new THREE.CircleGeometry(36, 64)
    const groundMat = new THREE.ShadowMaterial({ opacity: 0.38 })
    const ground = new THREE.Mesh(groundGeo, groundMat)
    ground.rotation.x = -Math.PI / 2
    ground.position.y = 0
    ground.receiveShadow = true
    scene.add(ground)

    const floorMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(backgroundColor).multiplyScalar(0.95),
      roughness: 0.55,
      metalness: 0.02,
      clearcoat: 0.15,
      clearcoatRoughness: 0.5,
      envMapIntensity: 0.35,
    })
    const floor = new THREE.Mesh(new THREE.CircleGeometry(32, 64), floorMat)
    floor.rotation.x = -Math.PI / 2
    floor.position.y = -0.015
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
      softboxMats,
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
        for (const m of st.softboxMats) m.dispose()
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
      const m = floor.material as THREE.MeshPhysicalMaterial
      m.color = new THREE.Color(backgroundColor).multiplyScalar(0.95)
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

    const targetY = product.userData.targetY ?? getProduct(productId).heightCm / 2
    s.controls.target.set(0, targetY, 0)
    root.userData.productId = productId
    if (s.lastProductId !== productId) {
      const dist = frameDistance(productId)
      s.camera.position.set(
        dist * 0.55,
        targetY + (productId === 'prato' ? dist * 0.42 : dist * 0.16),
        dist * 0.72,
      )
      s.lastProductId = productId
    }
    s.controls.update()
  }, [productId, colors, artImage, artSizeCm, transform, showGuide, frosting])

  return <div ref={mountRef} className={className} />
})

export default MockupCanvas
