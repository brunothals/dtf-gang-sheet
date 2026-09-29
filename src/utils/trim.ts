/**
 * Recorta PNG ao bounding box do alpha (ignora bordas transparentes / quase transparentes).
 * Mantém fundo transparente.
 *
 * O limiar `alphaThreshold` (t) ignora pixels com alpha < t. Assim, “poeira” de borda
 * com alpha=1 não impede o corte quando t ≥ 2 (padrão recomendado: 8). Não remove
 * fundo branco opaco — só alpha.
 */

/** Aviso se a arte original exceder este lado (px). Mantém canvas completo para export. */
export const IMPORT_WARN_MAX_SIDE_PX = 8000

/** Lado máximo do thumbnail na lista de artes (não afeta packing/export). */
export const THUMBNAIL_MAX_SIDE = 160

function createCanvas(w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  try {
    canvas.width = Math.max(1, Math.round(w))
    canvas.height = Math.max(1, Math.round(h))
  } catch {
    throw new Error(
      `Não foi possível criar canvas ${w}×${h} px (memória ou limite do navegador).`,
    )
  }
  if (canvas.width !== Math.max(1, Math.round(w)) || canvas.height !== Math.max(1, Math.round(h))) {
    throw new Error(
      `Canvas ${w}×${h} px rejeitado pelo navegador (dimensão ou memória).`,
    )
  }
  return canvas
}

export async function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.decoding = 'async'
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error(`Falha ao carregar: ${file.name}`))
      img.src = url
    })
    return img
  } finally {
    URL.revokeObjectURL(url)
  }
}

function imageToCanvas(source: CanvasImageSource, w: number, h: number): HTMLCanvasElement {
  const canvas = createCanvas(w, h)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D indisponível')
  ctx.clearRect(0, 0, w, h)
  ctx.drawImage(source, 0, 0)
  return canvas
}

/**
 * Gera dataURL pequeno para a lista (nunca toDataURL da arte em resolução plena).
 */
export function makeThumbnailDataUrl(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  maxSide = THUMBNAIL_MAX_SIDE,
): string {
  try {
    const sw = Math.max(1, srcW)
    const sh = Math.max(1, srcH)
    const scale = Math.min(1, maxSide / sw, maxSide / sh)
    const tw = Math.max(1, Math.round(sw * scale))
    const th = Math.max(1, Math.round(sh * scale))
    const canvas = createCanvas(tw, th)
    const ctx = canvas.getContext('2d')
    if (!ctx) return ''
    ctx.clearRect(0, 0, tw, th)
    ctx.imageSmoothingEnabled = true
    try {
      ctx.imageSmoothingQuality = 'medium'
    } catch {
      /* ok */
    }
    ctx.drawImage(source, 0, 0, sw, sh, 0, 0, tw, th)
    return canvas.toDataURL('image/png')
  } catch {
    return ''
  }
}

/** Carrega PNG como canvas original (sem corte). */
export async function loadPngAsCanvas(file: File): Promise<{
  name: string
  canvas: HTMLCanvasElement
  width: number
  height: number
  warnLarge?: boolean
}> {
  if (!file || file.size === 0) {
    throw new Error(`Arquivo vazio: ${file?.name ?? '(sem nome)'}`)
  }
  const img = await loadImageFromFile(file)
  const w = img.naturalWidth
  const h = img.naturalHeight
  if (w <= 0 || h <= 0) {
    throw new Error(`PNG sem dimensões válidas: ${file.name}`)
  }
  const canvas = imageToCanvas(img, w, h)
  return {
    name: file.name,
    canvas,
    width: w,
    height: h,
    warnLarge: w > IMPORT_WARN_MAX_SIDE_PX || h > IMPORT_WARN_MAX_SIDE_PX,
  }
}

export function trimToAlphaBounds(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  alphaThreshold = 8,
): { canvas: HTMLCanvasElement; width: number; height: number } {
  const probe = createCanvas(srcW, srcH)
  const pctx = probe.getContext('2d', { willReadFrequently: true })
  if (!pctx) throw new Error('Canvas 2D indisponível')
  pctx.clearRect(0, 0, srcW, srcH)
  pctx.drawImage(source, 0, 0)

  const { data } = pctx.getImageData(0, 0, srcW, srcH)
  const t = Math.max(0, Math.min(255, Math.round(alphaThreshold)))

  let minX = srcW
  let minY = srcH
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < srcH; y++) {
    for (let x = 0; x < srcW; x++) {
      const a = data[(y * srcW + x) * 4 + 3]
      if (a >= t) {
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }

  // Arte totalmente transparente → canvas 1×1 vazio
  if (maxX < minX || maxY < minY) {
    const empty = createCanvas(1, 1)
    return { canvas: empty, width: 1, height: 1 }
  }

  const w = maxX - minX + 1
  const h = maxY - minY + 1
  const out = createCanvas(w, h)
  const octx = out.getContext('2d')
  if (!octx) throw new Error('Canvas 2D indisponível')
  octx.clearRect(0, 0, w, h)
  octx.drawImage(probe, minX, minY, w, h, 0, 0, w, h)
  return { canvas: out, width: w, height: h }
}

/**
 * Aplica (ou não) o corte ao canvas original.
 * Com trim desligado, devolve o próprio original (sem cópia).
 * Com trim ligado, usa trimToAlphaBounds (pixels com alpha < threshold são ignorados).
 */
export function applyTrim(
  original: HTMLCanvasElement,
  enabled: boolean,
  alphaThreshold: number,
): { canvas: HTMLCanvasElement; width: number; height: number } {
  if (!enabled) {
    return {
      canvas: original,
      width: original.width,
      height: original.height,
    }
  }
  return trimToAlphaBounds(original, original.width, original.height, alphaThreshold)
}

/** @deprecated Prefer loadPngAsCanvas + applyTrim; mantido para compat. */
export async function processPngFile(
  file: File,
  alphaThreshold: number,
): Promise<{
  name: string
  canvas: HTMLCanvasElement
  width: number
  height: number
  originalCanvas: HTMLCanvasElement
  originalWidth: number
  originalHeight: number
}> {
  const loaded = await loadPngAsCanvas(file)
  const trimmed = trimToAlphaBounds(
    loaded.canvas,
    loaded.width,
    loaded.height,
    alphaThreshold,
  )
  return {
    name: loaded.name,
    canvas: trimmed.canvas,
    width: trimmed.width,
    height: trimmed.height,
    originalCanvas: loaded.canvas,
    originalWidth: loaded.width,
    originalHeight: loaded.height,
  }
}
