import { MaxRectsPacker, type Rectangle } from 'maxrects-packer'
import type { ArtItem, PackedPlacement, PackedSheet, SheetConfig } from '../types'
import { cmToPx, computePrintSizeCm, mmToPx, roundPx } from './units'

export interface ArtPrintSize {
  artId: string
  name: string
  widthCm: number
  heightCm: number
  widthPx: number
  heightPx: number
  source: HTMLCanvasElement
  rotated: boolean
  error?: string
}

export function getArtPrintSize(art: ArtItem, config: SheetConfig): ArtPrintSize {
  const maxSide = art.maxSideCmOverride ?? config.maxSideCm
  let { widthCm, heightCm } = computePrintSizeCm(
    art.trimmedWidthPx,
    art.trimmedHeightPx,
    maxSide,
  )

  // Per-art 90°: swap printed dimensions for ALL copies of this art
  const rotated = !!art.rotate90
  if (rotated) {
    ;[widthCm, heightCm] = [heightCm, widthCm]
  }

  const widthPx = roundPx(cmToPx(widthCm, config.dpi))
  const heightPx = roundPx(cmToPx(heightCm, config.dpi))

  const sheetW = roundPx(cmToPx(config.widthCm, config.dpi))
  const sheetH = roundPx(cmToPx(config.heightCm, config.dpi))
  const marginPx = roundPx(mmToPx(config.marginMm, config.dpi))
  const usableW = sheetW - 2 * marginPx
  const usableH = sheetH - 2 * marginPx

  let error: string | undefined
  // Fit check uses the (possibly swapped) print size — packer never mixes orientations
  if (!(widthPx <= usableW && heightPx <= usableH)) {
    error = `Não cabe na folha (${config.widthCm}×${config.heightCm} cm com margem ${config.marginMm} mm). Tamanho impresso: ${widthCm.toFixed(2)}×${heightCm.toFixed(2)} cm.`
  }

  return {
    artId: art.id,
    name: art.name,
    widthCm,
    heightCm,
    widthPx,
    heightPx,
    source: art.trimmedCanvas,
    rotated,
    error,
  }
}

interface PackRect {
  width: number
  height: number
  artId: string
  name: string
  source: HTMLCanvasElement
  printW: number
  printH: number
  rotated: boolean
}

export interface PackArtsOptions {
  /** Se true, não renderiza canvas/preview (só posições + contagem de folhas). */
  skipPreview?: boolean
}

/**
 * Empacota artes em folhas com MaxRects (multi-bin).
 * - Área útil = folha − 2×margem
 * - padding do packer = gap (espaçamento visual entre peças)
 * - Rotação 90° é por arte (ArtItem.rotate90); MaxRects nunca gira sozinho
 */
export function packArts(
  arts: ArtItem[],
  config: SheetConfig,
  options?: PackArtsOptions,
): { sheets: PackedSheet[]; errors: string[]; printSizes: ArtPrintSize[] } {
  const skipPreview = options?.skipPreview === true
  const printSizes = arts.map((a) => getArtPrintSize(a, config))
  const errors: string[] = []

  for (const ps of printSizes) {
    if (ps.error) {
      errors.push(`${ps.name}: ${ps.error}`)
    }
  }

  const validArts = arts.filter((_, i) => !printSizes[i].error)
  const validSizes = printSizes.filter((p) => !p.error)

  if (validArts.length === 0) {
    return { sheets: [], errors, printSizes }
  }

  const sheetW = roundPx(cmToPx(config.widthCm, config.dpi))
  const sheetH = roundPx(cmToPx(config.heightCm, config.dpi))
  const marginPx = roundPx(mmToPx(config.marginMm, config.dpi))
  const gapPx = roundPx(mmToPx(config.gapMm, config.dpi))
  const usableW = Math.max(1, sheetW - 2 * marginPx)
  const usableH = Math.max(1, sheetH - 2 * marginPx)

  const rects: PackRect[] = []
  for (let i = 0; i < validArts.length; i++) {
    const art = validArts[i]
    const ps = validSizes[i]
    const qty = Math.max(0, Math.floor(art.quantity) || 0)
    for (let q = 0; q < qty; q++) {
      rects.push({
        width: ps.widthPx,
        height: ps.heightPx,
        artId: art.id,
        name: art.name,
        source: art.trimmedCanvas,
        printW: ps.widthPx,
        printH: ps.heightPx,
        rotated: ps.rotated,
      })
    }
  }

  if (rects.length === 0) {
    return { sheets: [], errors, printSizes }
  }

  // Never let MaxRects mix orientations within/across copies — orientation is intentional per art
  const packer = new MaxRectsPacker<Rectangle & PackRect>(usableW, usableH, gapPx, {
    smart: false,
    pot: false,
    square: false,
    allowRotation: false,
    border: 0,
  })

  packer.addArray(rects as unknown as (Rectangle & PackRect)[])

  const sheets: PackedSheet[] = []

  for (let bi = 0; bi < packer.bins.length; bi++) {
    const bin = packer.bins[bi]
    // Bin oversized = peça que não coube (já filtramos, mas por segurança)
    const oversized = bin.rects.some((r) => (r as Rectangle).oversized)
    if (oversized) {
      for (const r of bin.rects) {
        if ((r as Rectangle).oversized) {
          const data = r as Rectangle & PackRect
          errors.push(
            `${data.name ?? 'Arte'}: não coube na área útil da folha (oversized).`,
          )
        }
      }
      continue
    }

    const placements: PackedPlacement[] = bin.rects.map((r) => {
      const data = r as Rectangle & PackRect
      return {
        artId: data.artId,
        name: data.name,
        x: marginPx + r.x,
        y: marginPx + r.y,
        width: data.printW,
        height: data.printH,
        rotated: data.rotated,
        source: data.source,
      }
    })

    let previewUrl = ''
    if (!skipPreview) {
      const canvas = renderSheetCanvas(sheetW, sheetH, placements)
      previewUrl = canvas.toDataURL('image/png')
    }

    sheets.push({
      index: sheets.length,
      widthPx: sheetW,
      heightPx: sheetH,
      placements,
      previewUrl,
    })
  }

  return { sheets, errors, printSizes }
}

export function renderSheetCanvas(
  widthPx: number,
  heightPx: number,
  placements: PackedPlacement[],
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = widthPx
  canvas.height = heightPx
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D indisponível')
  ctx.clearRect(0, 0, widthPx, heightPx)

  for (const p of placements) {
    ctx.save()
    if (p.rotated) {
      // Rotação 90° horário: origem no canto, depois translate
      ctx.translate(p.x + p.width, p.y)
      ctx.rotate(Math.PI / 2)
      ctx.drawImage(p.source, 0, 0, p.height, p.width)
    } else {
      ctx.drawImage(p.source, p.x, p.y, p.width, p.height)
    }
    ctx.restore()
  }

  return canvas
}
