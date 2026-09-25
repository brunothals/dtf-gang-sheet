/**
 * Recorta PNG ao bounding box do alpha (ignora bordas transparentes / quase transparentes).
 * Mantém fundo transparente.
 *
 * O limiar `alphaThreshold` (t) ignora pixels com alpha < t. Assim, “poeira” de borda
 * com alpha=1 não impede o corte quando t ≥ 2 (padrão recomendado: 8). Não remove
 * fundo branco opaco — só alpha.
 */

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
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D indisponível')
  ctx.clearRect(0, 0, w, h)
  ctx.drawImage(source, 0, 0)
  return canvas
}

/** Carrega PNG como canvas original (sem corte). */
export async function loadPngAsCanvas(file: File): Promise<{
  name: string
  canvas: HTMLCanvasElement
  width: number
  height: number
}> {
  const img = await loadImageFromFile(file)
  const w = img.naturalWidth
  const h = img.naturalHeight
  const canvas = imageToCanvas(img, w, h)
  return { name: file.name, canvas, width: w, height: h }
}

export function trimToAlphaBounds(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  alphaThreshold = 8,
): { canvas: HTMLCanvasElement; width: number; height: number } {
  const probe = document.createElement('canvas')
  probe.width = srcW
  probe.height = srcH
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
    const empty = document.createElement('canvas')
    empty.width = 1
    empty.height = 1
    return { canvas: empty, width: 1, height: 1 }
  }

  const w = maxX - minX + 1
  const h = maxY - minY + 1
  const out = document.createElement('canvas')
  out.width = w
  out.height = h
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
