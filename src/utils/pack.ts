import { MaxRectsPacker, type Rectangle } from 'maxrects-packer'
import type {
  ArtItem,
  PackedPlacement,
  PackedSheet,
  PackMode,
  SheetConfig,
} from '../types'
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

function finalizeSheet(
  sheetW: number,
  sheetH: number,
  placements: PackedPlacement[],
  skipPreview: boolean,
  sheets: PackedSheet[],
): void {
  if (placements.length === 0) return
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

/**
 * Agrupa por arte em fileiras (group_rows) ou colunas (group_cols).
 * Não mistura artIds na mesma fileira/coluna; cada arte começa em strip nova.
 */
function packGrouped(
  validArts: ArtItem[],
  validSizes: ArtPrintSize[],
  config: SheetConfig,
  mode: 'group_rows' | 'group_cols',
  skipPreview: boolean,
): PackedSheet[] {
  const sheetW = roundPx(cmToPx(config.widthCm, config.dpi))
  const sheetH = roundPx(cmToPx(config.heightCm, config.dpi))
  const marginPx = roundPx(mmToPx(config.marginMm, config.dpi))
  const gapPx = roundPx(mmToPx(config.gapMm, config.dpi))
  const usableW = Math.max(1, sheetW - 2 * marginPx)
  const usableH = Math.max(1, sheetH - 2 * marginPx)

  const sheets: PackedSheet[] = []
  let placements: PackedPlacement[] = []
  // cursor along the strip axis (Y for rows, X for cols) and within-strip progress
  let stripPos = 0 // cursorY (rows) or cursorX (cols) — start of current strip
  let along = 0 // rowX (rows) or colY (cols) — progress inside current strip

  const isRows = mode === 'group_rows'

  const newSheet = () => {
    finalizeSheet(sheetW, sheetH, placements, skipPreview, sheets)
    placements = []
    stripPos = 0
    along = 0
  }

  for (let i = 0; i < validArts.length; i++) {
    const art = validArts[i]
    const ps = validSizes[i]
    const qty = Math.max(0, Math.floor(art.quantity) || 0)
    if (qty === 0) continue

    const artW = ps.widthPx
    const artH = ps.heightPx
    // Primary dimension of the strip (height for rows, width for cols)
    const stripSize = isRows ? artH : artW
    const pieceAlong = isRows ? artW : artH
    const usableAlong = isRows ? usableW : usableH
    const usableCross = isRows ? usableH : usableW

    // If this art's strip doesn't fit in remaining cross-axis space → new sheet
    // (previous art always advanced stripPos so we never sit beside its leftover)
    if (stripPos + stripSize > usableCross) {
      newSheet()
    }

    for (let q = 0; q < qty; q++) {
      // Wrap within same art when strip is full along the primary axis
      if (along + pieceAlong > usableAlong) {
        stripPos += stripSize + gapPx
        along = 0
      }

      // Need new sheet if strip no longer fits
      if (stripPos + stripSize > usableCross) {
        newSheet()
      }

      const x = isRows ? along : stripPos
      const y = isRows ? stripPos : along

      placements.push({
        artId: art.id,
        name: art.name,
        x: marginPx + x,
        y: marginPx + y,
        width: artW,
        height: artH,
        rotated: ps.rotated,
        source: art.trimmedCanvas,
      })

      along += pieceAlong + gapPx
    }

    // After art finishes: advance to a fresh strip for the next art
    stripPos += stripSize + gapPx
    along = 0
  }

  finalizeSheet(sheetW, sheetH, placements, skipPreview, sheets)
  return sheets
}

function packMaxRects(
  validArts: ArtItem[],
  validSizes: ArtPrintSize[],
  config: SheetConfig,
  skipPreview: boolean,
  errors: string[],
): PackedSheet[] {
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

  if (rects.length === 0) return []

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

    finalizeSheet(sheetW, sheetH, placements, skipPreview, sheets)
  }

  return sheets
}

/**
 * Empacota artes em folhas.
 * - packMode maxrects: MaxRects (multi-bin), pode misturar artes
 * - packMode group_rows / group_cols: agrupa por arte em fileiras/colunas
 * - Área útil = folha − 2×margem; gap entre peças
 * - Rotação 90° é por arte (ArtItem.rotate90)
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

  const mode: PackMode = config.packMode ?? 'maxrects'

  let sheets: PackedSheet[]
  if (mode === 'group_rows' || mode === 'group_cols') {
    sheets = packGrouped(validArts, validSizes, config, mode, skipPreview)
  } else {
    sheets = packMaxRects(validArts, validSizes, config, skipPreview, errors)
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
