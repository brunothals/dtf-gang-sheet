import { useEffect, useImperativeHandle, useRef, forwardRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { ProductId } from './products'
import { getProduct } from './products'

export type ArtTransform = {
  scale: number
  offsetX: number
  offsetY: number
  rotationDeg: number
  flipH: boolean
  flipV: boolean
}

export type MockupCanvasHandle = {
  /** Render at given pixel size and return PNG data URL (or null) */
  capture: (width: number, height: number) => string | null
  setViewAngle: (angle: 'frente' | 'tresquartos') => void
}

type Props = {
  productId: ProductId
  productColor: string
  backgroundColor: string
  artImage: HTMLImageElement | null
  transform: ArtTransform
  className?: string
}

const TEX_SIZE = 1024

function bakeArtTexture(
  art: HTMLImageElement | null,
  transform: ArtTransform,
  aspectW: number,
  aspectH: number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  // Match print-area aspect so UV mapping looks correct
  const maxSide = TEX_SIZE
  if (aspectW >= aspectH) {
    canvas.width = maxSide
    canvas.height = Math.max(64, Math.round(maxSide * (aspectH / aspectW)))
  } else {
    canvas.height = maxSide
    canvas.width = Math.max(64, Math.round(maxSide * (aspectW / aspectH)))
  }
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  if (!art) return canvas

  const cx = canvas.width / 2
  const cy = canvas.height / 2
  ctx.save()
  ctx.translate(cx + transform.offsetX * (canvas.width / 2), cy + transform.offsetY * (canvas.height / 2))
  ctx.rotate((transform.rotationDeg * Math.PI) / 180)
  ctx.scale(
    (transform.flipH ? -1 : 1) * transform.scale,
    (transform.flipV ? -1 : 1) * transform.scale,
  )

  // Fit art inside canvas while preserving aspect
  const artAspect = art.naturalWidth / art.naturalHeight
  const boxAspect = canvas.width / canvas.height
  let dw: number
  let dh: number
  if (artAspect > boxAspect) {
    dw = canvas.width * 0.85
    dh = dw / artAspect
  } else {
    dh = canvas.height * 0.85
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

function materialFor(
  productId: ProductId,
  color: string,
  opts: { map?: THREE.Texture | null; transparent?: boolean; opacity?: number; roughness?: number; metalness?: number } = {},
): THREE.MeshStandardMaterial {
  const product = getProduct(productId)
  let roughness = 0.45
  let metalness = 0.05
  if (product.material === 'porcelain') {
    roughness = 0.35
    metalness = 0.02
  } else if (product.material === 'plastic') {
    roughness = 0.55
    metalness = 0.08
  } else if (product.material === 'glass') {
    roughness = 0.12
    metalness = 0.15
  }
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: opts.roughness ?? roughness,
    metalness: opts.metalness ?? metalness,
    map: opts.map ?? null,
    transparent: opts.transparent ?? !!opts.map,
    opacity: opts.opacity ?? 1,
    side: THREE.FrontSide,
  })
}

function buildProduct(
  productId: ProductId,
  productColor: string,
  artTex: THREE.CanvasTexture | null,
): THREE.Group {
  const group = new THREE.Group()

  if (productId === 'prato') {
    // Flat plate with raised rim
    const radius = 1.35
    const bodyGeo = new THREE.CylinderGeometry(radius * 0.92, radius, 0.08, 64)
    const bodyMat = materialFor(productId, productColor, { roughness: 0.32 })
    const body = new THREE.Mesh(bodyGeo, bodyMat)
    body.castShadow = true
    body.receiveShadow = true
    group.add(body)

    const rimGeo = new THREE.TorusGeometry(radius * 0.96, 0.06, 16, 64)
    const rim = new THREE.Mesh(rimGeo, bodyMat.clone())
    rim.rotation.x = Math.PI / 2
    rim.position.y = 0.05
    rim.castShadow = true
    group.add(rim)

    // Art disc on top (slightly above surface)
    if (artTex) {
      const artGeo = new THREE.CircleGeometry(radius * 0.72, 64)
      const artMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: artTex,
        transparent: true,
        roughness: 0.4,
        metalness: 0.02,
        depthWrite: false,
      })
      const artMesh = new THREE.Mesh(artGeo, artMat)
      artMesh.rotation.x = -Math.PI / 2
      artMesh.position.y = 0.045
      artMesh.name = 'printArea'
      group.add(artMesh)
    }
  } else if (productId === 'copo') {
    const rTop = 0.55
    const rBot = 0.48
    const h = 1.35
    const sideGeo = new THREE.CylinderGeometry(rTop, rBot, h, 64, 1, true)
    // Remap UVs: full wrap horizontally, vertical use mid band
    const uv = sideGeo.attributes.uv
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i)
      const v = uv.getY(i)
      // Keep u; compress v slightly into print band
      uv.setXY(i, u, 0.15 + v * 0.7)
    }
    const bodyMat = materialFor(productId, productColor, { roughness: 0.38 })
    const solidGeo = new THREE.CylinderGeometry(rTop - 0.01, rBot - 0.01, h - 0.02, 64)
    const solid = new THREE.Mesh(solidGeo, bodyMat)
    solid.castShadow = true
    solid.receiveShadow = true
    group.add(solid)

    if (artTex) {
      const sideMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: artTex,
        transparent: true,
        roughness: 0.38,
        metalness: 0.02,
        depthWrite: false,
      })
      const side = new THREE.Mesh(sideGeo, sideMat)
      side.name = 'printArea'
      side.castShadow = true
      group.add(side)
    } else {
      sideGeo.dispose()
    }

    // Bottom
    const bot = new THREE.Mesh(
      new THREE.CircleGeometry(rBot, 48),
      bodyMat.clone(),
    )
    bot.rotation.x = Math.PI / 2
    bot.position.y = -h / 2
    group.add(bot)

    // Rim
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(rTop, 0.025, 12, 48),
      bodyMat.clone(),
    )
    rim.rotation.x = Math.PI / 2
    rim.position.y = h / 2
    group.add(rim)

    group.position.y = h / 2
  } else if (productId === 'tumbler') {
    const rTop = 0.52
    const rBot = 0.48
    const h = 1.9
    const bodyMat = materialFor(productId, productColor, { roughness: 0.58, metalness: 0.1 })
    const solidGeo = new THREE.CylinderGeometry(rTop - 0.012, rBot - 0.012, h - 0.02, 64)
    const solid = new THREE.Mesh(solidGeo, bodyMat)
    solid.castShadow = true
    solid.receiveShadow = true
    group.add(solid)

    const sideGeo = new THREE.CylinderGeometry(rTop, rBot, h, 64, 1, true)
    if (artTex) {
      const sideMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: artTex,
        transparent: true,
        roughness: 0.55,
        metalness: 0.08,
        depthWrite: false,
      })
      const side = new THREE.Mesh(sideGeo, sideMat)
      side.name = 'printArea'
      group.add(side)
    } else {
      sideGeo.dispose()
    }

    const lid = new THREE.Mesh(
      new THREE.CylinderGeometry(rTop * 0.95, rTop * 0.98, 0.12, 48),
      materialFor(productId, '#333333', { roughness: 0.4 }),
    )
    lid.position.y = h / 2 + 0.02
    group.add(lid)

    const bot = new THREE.Mesh(new THREE.CircleGeometry(rBot, 48), bodyMat.clone())
    bot.rotation.x = Math.PI / 2
    bot.position.y = -h / 2
    group.add(bot)

    group.position.y = h / 2
  } else {
    // Taça — lathe bowl + stem + print band
    const pts: THREE.Vector2[] = []
    // Bowl profile (x=radius, y=height)
    pts.push(new THREE.Vector2(0.02, 0))
    pts.push(new THREE.Vector2(0.06, 0.35)) // stem
    pts.push(new THREE.Vector2(0.08, 0.55))
    pts.push(new THREE.Vector2(0.22, 0.62)) // bowl start
    pts.push(new THREE.Vector2(0.55, 0.95))
    pts.push(new THREE.Vector2(0.62, 1.25))
    pts.push(new THREE.Vector2(0.58, 1.45)) // rim
    const latheGeo = new THREE.LatheGeometry(pts, 64)
    const glassMat = materialFor(productId, productColor, {
      roughness: 0.1,
      metalness: 0.2,
      transparent: true,
      opacity: 0.55,
    })
    glassMat.side = THREE.DoubleSide
    const glass = new THREE.Mesh(latheGeo, glassMat)
    glass.castShadow = true
    group.add(glass)

    // Frosted print band around bowl
    const bandH = 0.55
    const bandY = 1.0
    const bandR = 0.58
    const bandGeo = new THREE.CylinderGeometry(bandR, bandR * 0.92, bandH, 64, 1, true)
    if (artTex) {
      const bandMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: artTex,
        transparent: true,
        roughness: 0.45,
        metalness: 0.05,
        side: THREE.DoubleSide,
      })
      const band = new THREE.Mesh(bandGeo, bandMat)
      band.position.y = bandY
      band.name = 'printArea'
      group.add(band)
    } else {
      bandGeo.dispose()
    }

    // Base disc
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.3, 0.05, 48),
      materialFor(productId, productColor, { roughness: 0.15, metalness: 0.25, opacity: 0.7, transparent: true }),
    )
    base.position.y = 0.025
    group.add(base)
  }

  return group
}

const MockupCanvas = forwardRef<MockupCanvasHandle, Props>(function MockupCanvas(
  { productId, productColor, backgroundColor, artImage, transform, className },
  ref,
) {
  const mountRef = useRef<HTMLDivElement>(null)
  const stateRef = useRef<{
    renderer: THREE.WebGLRenderer
    scene: THREE.Scene
    camera: THREE.PerspectiveCamera
    controls: OrbitControls
    productGroup: THREE.Group | null
    artTex: THREE.CanvasTexture | null
    ground: THREE.Mesh
    animId: number
  } | null>(null)

  useImperativeHandle(ref, () => ({
    capture(width: number, height: number) {
      const s = stateRef.current
      const mount = mountRef.current
      if (!s || !mount) return null

      const prevW = s.renderer.domElement.width
      const prevH = s.renderer.domElement.height
      const prevPixel = s.renderer.getPixelRatio()

      s.renderer.setPixelRatio(1)
      s.renderer.setSize(width, height, false)
      s.camera.aspect = width / height
      s.camera.updateProjectionMatrix()
      s.controls.update()
      s.renderer.render(s.scene, s.camera)
      const url = s.renderer.domElement.toDataURL('image/png')

      // Restore
      const rect = mount.getBoundingClientRect()
      s.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      s.renderer.setSize(rect.width, rect.height, false)
      s.camera.aspect = rect.width / Math.max(rect.height, 1)
      s.camera.updateProjectionMatrix()
      // silence unused
      void prevW
      void prevH
      void prevPixel
      return url
    },
    setViewAngle(angle) {
      const s = stateRef.current
      if (!s) return
      if (angle === 'frente') {
        s.camera.position.set(0, 1.4, 3.2)
      } else {
        s.camera.position.set(2.4, 1.8, 2.6)
      }
      s.controls.target.set(0, 0.7, 0)
      s.controls.update()
    },
  }))

  // Init scene once
  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(backgroundColor)

    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100)
    camera.position.set(2.4, 1.8, 2.6)

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.outputColorSpace = THREE.SRGBColorSpace
    mount.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.minDistance = 1.5
    controls.maxDistance = 8
    controls.maxPolarAngle = Math.PI * 0.49
    controls.target.set(0, 0.7, 0)

    // Lights — soft studio
    const ambient = new THREE.AmbientLight(0xffffff, 0.45)
    scene.add(ambient)
    const key = new THREE.DirectionalLight(0xfff5e6, 1.15)
    key.position.set(3, 5, 2)
    key.castShadow = true
    key.shadow.mapSize.set(1024, 1024)
    key.shadow.camera.near = 0.5
    key.shadow.camera.far = 20
    key.shadow.camera.left = -4
    key.shadow.camera.right = 4
    key.shadow.camera.top = 4
    key.shadow.camera.bottom = -4
    scene.add(key)
    const fill = new THREE.DirectionalLight(0xc8d8ff, 0.45)
    fill.position.set(-3, 2, -1)
    scene.add(fill)
    const rim = new THREE.DirectionalLight(0xffffff, 0.25)
    rim.position.set(0, 3, -4)
    scene.add(rim)

    // Ground shadow catcher
    const groundGeo = new THREE.CircleGeometry(3.5, 64)
    const groundMat = new THREE.ShadowMaterial({ opacity: 0.28 })
    const ground = new THREE.Mesh(groundGeo, groundMat)
    ground.rotation.x = -Math.PI / 2
    ground.position.y = 0
    ground.receiveShadow = true
    scene.add(ground)

    // Soft floor disc for color context
    const floorGeo = new THREE.CircleGeometry(3.2, 64)
    const floorMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(backgroundColor).multiplyScalar(0.92),
      roughness: 0.9,
      metalness: 0,
    })
    const floor = new THREE.Mesh(floorGeo, floorMat)
    floor.rotation.x = -Math.PI / 2
    floor.position.y = -0.002
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
      productGroup: null,
      artTex: null,
      ground,
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
        if (st.productGroup) {
          st.scene.remove(st.productGroup)
          disposeObject(st.productGroup)
        }
        if (st.artTex) st.artTex.dispose()
        st.controls.dispose()
        st.renderer.dispose()
        if (st.renderer.domElement.parentNode === mount) {
          mount.removeChild(st.renderer.domElement)
        }
      }
      stateRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- init once
  }, [])

  // Background color
  useEffect(() => {
    const s = stateRef.current
    if (!s) return
    s.scene.background = new THREE.Color(backgroundColor)
    const floor = s.ground.userData.floor as THREE.Mesh | undefined
    if (floor) {
      const m = floor.material as THREE.MeshStandardMaterial
      m.color = new THREE.Color(backgroundColor).multiplyScalar(0.92)
    }
  }, [backgroundColor])

  // Rebuild product + art when inputs change
  useEffect(() => {
    const s = stateRef.current
    if (!s) return

    if (s.productGroup) {
      s.scene.remove(s.productGroup)
      disposeObject(s.productGroup)
      s.productGroup = null
    }
    if (s.artTex) {
      s.artTex.dispose()
      s.artTex = null
    }

    const product = getProduct(productId)
    const baked = bakeArtTexture(
      artImage,
      transform,
      product.printAreaMm.width,
      product.printAreaMm.height,
    )
    const tex = new THREE.CanvasTexture(baked)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = s.renderer.capabilities.getMaxAnisotropy()
    tex.wrapS = THREE.ClampToEdgeWrapping
    tex.wrapT = THREE.ClampToEdgeWrapping
    // Cylinders need RepeatWrapping for seamless feel; art is already baked full-width
    if (productId !== 'prato') {
      tex.wrapS = THREE.RepeatWrapping
    }
    tex.needsUpdate = true
    s.artTex = tex

    const group = buildProduct(productId, productColor, tex)
    s.scene.add(group)
    s.productGroup = group
  }, [productId, productColor, artImage, transform])

  return <div ref={mountRef} className={className} />
})

export default MockupCanvas
