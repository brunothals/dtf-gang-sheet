import { MaxRectsPacker, type Rectangle } from 'maxrects-packer'
import type {
  ArtItem,
  PackedPlacement,
  PackedSheet,
  PackMode,
  SheetConfig,
} from '../types'
import { MAX_AUTO_HEIGHT_CM } from '../types'
import { cmToPx, computePrintSizeCm, mmToPx, pxToCm, roundPx } from './units'

/** Lado máximo do preview na UI (px) — exportação usa resolução nativa. */
const PREVIEW_MAX_SIDE = 1400

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
  const grow = config.sheetGrowMode === 'auto_height'
  const heightCmLimit = grow ? MAX_AUTO_HEIGHT_CM : config.heightCm
  const sheetH = roundPx(cmToPx(heightCmLimit, config.dpi))
  const marginPx = roundPx(mmToPx(config.marginMm, config.dpi))
  const usableW = sheetW - 2 * marginPx
  const usableH = sheetH - 2 * marginPx

  let error: string | undefined
  // Fit check uses the (possibly swapped) print size — packer never mixes orientations
  if (!(widthPx <= usableW && heightPx <= usableH)) {
    if (grow) {
      error = `Não cabe na largura do rolo (${config.widthCm} cm, margem ${config.marginMm} mm) ou excede ${MAX_AUTO_HEIGHT_CM} cm de altura. Tamanho impresso: ${widthCm.toFixed(2)}×${heightCm.toFixed(2)} cm.`
    } else {
      error = `Não cabe na folha (${config.widthCm}×${config.heightCm} cm com margem ${config.marginMm} mm). Tamanho impresso: ${widthCm.toFixed(2)}×${heightCm.toFixed(2)} cm.`
    }
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
  /**
   * Gera previewUrl só para as primeiras N folhas (evita OOM com muitas folhas).
   * Folhas além disso ficam com previewUrl vazio (lazy / sob demanda na UI).
   */
  maxPreviewSheets?: number
}

export function buildPreviewUrl(
  sheetW: number,
  sheetH: number,
  placements: PackedPlacement[],
): string {
  try {
    if (sheetW <= 0 || sheetH <= 0) return ''
    const scale = Math.min(1, PREVIEW_MAX_SIDE / sheetW, PREVIEW_MAX_SIDE / sheetH)
    const pw = Math.max(1, Math.round(sheetW * scale))
    const ph = Math.max(1, Math.round(sheetH * scale))
    // Nunca toDataURL da folha em resolução nativa — sempre limita PREVIEW_MAX_SIDE
    const scaled =
      scale < 1
        ? placements.map((p) => ({
            ...p,
            x: p.x * scale,
            y: p.y * scale,
            width: Math.max(1, p.width * scale),
            height: Math.max(1, p.height * scale),
          }))
        : placements
    const canvas = renderSheetCanvas(pw, ph, scaled)
    return canvas.toDataURL('image/png')
  } catch (e) {
    console.warn('Preview da folha falhou (memória/limite do canvas):', e)
    return ''
  }
}

interface FinalizeOpts {
  skipPreview: boolean
  maxPreviewSheets: number
}

function finalizeSheet(
  sheetW: number,
  sheetH: number,
  placements: PackedPlacement[],
  opts: FinalizeOpts,
  sheets: PackedSheet[],
): void {
  if (placements.length === 0) return
  const wantPreview =
    !opts.skipPreview && sheets.length < opts.maxPreviewSheets
  const previewUrl = wantPreview ? buildPreviewUrl(sheetW, sheetH, placements) : ''
  sheets.push({
    index: sheets.length,
    widthPx: sheetW,
    heightPx: sheetH,
    placements,
    previewUrl,
  })
}

/**
 * Grade (shelf packing, fileiras alinhadas): coloca cópias esquerda→direita
 * em fileiras de mesma baseline (altura da fileira = max das peças nela).
 * gapXMm entre peças; gapYMm entre fileiras. Sem rotação livre.
 *
 * First-fit com adiamento: se a próxima peça da lista não cabe na fileira
 * atual (nem em largura restante nem em altura a partir da baseline), procura
 * a *primeira* peça restante que caiba nesse vão — mantém fileiras retas e
 * preenche o canto inferior-direito antes de abrir Folha N+1. Só cria nova
 * folha quando nenhuma peça restante cabe na fileira atual nem numa nova
 * fileira alinhada na mesma folha. Não enfia peças em “buracos” no meio da
 * folha (sem free-rect caótico).
 */
function packGrade(
  validArts: ArtItem[],
  validSizes: ArtPrintSize[],
  config: SheetConfig,
  opts: FinalizeOpts,
): PackedSheet[] {
  const sheetW = roundPx(cmToPx(config.widthCm, config.dpi))
  const sheetH = roundPx(cmToPx(config.heightCm, config.dpi))
  const marginPx = roundPx(mmToPx(config.marginMm, config.dpi))
  const gapXMm = config.gapXMm ?? config.gapMm
  const gapYMm = config.gapYMm ?? config.gapMm
  const gapXPx = roundPx(mmToPx(gapXMm, config.dpi))
  const gapYPx = roundPx(mmToPx(gapYMm, config.dpi))
  const usableW = Math.max(1, sheetW - 2 * marginPx)
  const usableH = Math.max(1, sheetH - 2 * marginPx)

  type Piece = {
    artId: string
    name: string
    width: number
    height: number
    rotated: boolean
    source: HTMLCanvasElement
  }
  const pieces: Piece[] = []
  for (let i = 0; i < validArts.length; i++) {
    const art = validArts[i]
    const ps = validSizes[i]
    const qty = Math.max(0, Math.floor(art.quantity) || 0)
    for (let q = 0; q < qty; q++) {
      pieces.push({
        artId: art.id,
        name: art.name,
        width: ps.widthPx,
        height: ps.heightPx,
        rotated: ps.rotated,
        source: art.trimmedCanvas,
      })
    }
  }

  if (pieces.length === 0) return []

  const sheets: PackedSheet[] = []
  let remaining = pieces

  const fitsOnRow = (
    piece: Piece,
    cursorX: number,
    cursorY: number,
  ): boolean => {
    if (piece.width > usableW) return false
    if (cursorY + piece.height > usableH) return false
    if (cursorX === 0) return true
    return cursorX + piece.width <= usableW
  }

  while (remaining.length > 0) {
    const placements: PackedPlacement[] = []
    let cursorX = 0
    let cursorY = 0
    let rowHeight = 0
    const queue = remaining.slice()
    remaining = []

    const place = (piece: Piece) => {
      placements.push({
        artId: piece.artId,
        name: piece.name,
        x: marginPx + cursorX,
        y: marginPx + cursorY,
        width: piece.width,
        height: piece.height,
        rotated: piece.rotated,
        source: piece.source,
      })
      cursorX += piece.width + gapXPx
      if (piece.height > rowHeight) rowHeight = piece.height
    }

    // Fill this sheet: always prefer current row leftover, then a new aligned row.
    while (queue.length > 0) {
      let idx = queue.findIndex((p) => fitsOnRow(p, cursorX, cursorY))
      if (idx >= 0) {
        place(queue.splice(idx, 1)[0])
        continue
      }

      // No remaining piece fits this row — try one new aligned row below.
      if (rowHeight > 0) {
        const nextRowY = cursorY + rowHeight + gapYPx
        idx = queue.findIndex(
          (p) =>
            p.width <= usableW &&
            nextRowY + p.height <= usableH,
        )
        if (idx >= 0) {
          cursorY = nextRowY
          cursorX = 0
          rowHeight = 0
          place(queue.splice(idx, 1)[0])
          continue
        }
      }

      // Nothing else fits on this sheet with neat shelf rows.
      break
    }

    remaining = queue

    if (placements.length === 0) {
      // Safety: empty sheet + leftover (should not happen for valid arts).
      // Force the head piece onto its own sheet to avoid an infinite loop.
      const piece = remaining.shift()
      if (!piece) break
      cursorX = 0
      cursorY = 0
      rowHeight = 0
      place(piece)
    }

    finalizeSheet(sheetW, sheetH, placements, opts, sheets)
  }

  return sheets
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
  opts: FinalizeOpts,
): PackedSheet[] {
  const sheetW = roundPx(cmToPx(config.widthCm, config.dpi))
  const sheetH = roundPx(cmToPx(config.heightCm, config.dpi))
  const marginPx = roundPx(mmToPx(config.marginMm, config.dpi))
  // Dual gaps: fallback to gapMm when gapX/gapY absent (configs antigas)
  const gapXMm = config.gapXMm ?? config.gapMm
  const gapYMm = config.gapYMm ?? config.gapMm
  const gapXPx = roundPx(mmToPx(gapXMm, config.dpi))
  const gapYPx = roundPx(mmToPx(gapYMm, config.dpi))
  const usableW = Math.max(1, sheetW - 2 * marginPx)
  const usableH = Math.max(1, sheetH - 2 * marginPx)

  const sheets: PackedSheet[] = []
  let placements: PackedPlacement[] = []
  // cursor along the strip axis (Y for rows, X for cols) and within-strip progress
  let stripPos = 0 // cursorY (rows) or cursorX (cols) — start of current strip
  let along = 0 // rowX (rows) or colY (cols) — progress inside current strip

  const isRows = mode === 'group_rows'
  // group_rows: gapX between items in a row, gapY between rows
  // group_cols: gapY between items in a column, gapX between columns
  const gapAlongPx = isRows ? gapXPx : gapYPx
  const gapCrossPx = isRows ? gapYPx : gapXPx

  const newSheet = () => {
    finalizeSheet(sheetW, sheetH, placements, opts, sheets)
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

    // New sheet only if this art's strip cannot fit in remaining cross-axis space
    // (still fill the sheet — do not open Folha N+1 while a strip still fits)
    if (stripPos + stripSize > usableCross) {
      newSheet()
    }

    for (let q = 0; q < qty; q++) {
      // Wrap within same art when strip is full along the primary axis
      if (along > 0 && along + pieceAlong > usableAlong) {
        const nextStrip = stripPos + stripSize + gapCrossPx
        if (nextStrip + stripSize <= usableCross) {
          // Next strip still fits on this sheet — fill before new sheet
          stripPos = nextStrip
          along = 0
        } else {
          // No remaining strip room for this piece → Folha N+1
          newSheet()
        }
      }

      // Safety: if somehow strip still doesn't fit (e.g. after newSheet), reset already done
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

      along += pieceAlong + gapAlongPx
    }

    // After art finishes: next art starts on a fresh strip (same art stays together).
    // Do not open a new sheet here — next art checks whether its strip still fits.
    if (qty > 0) {
      stripPos += stripSize + gapCrossPx
      along = 0
    }
  }

  finalizeSheet(sheetW, sheetH, placements, opts, sheets)
  return sheets
}

function packMaxRects(
  validArts: ArtItem[],
  validSizes: ArtPrintSize[],
  config: SheetConfig,
  opts: FinalizeOpts,
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

    finalizeSheet(sheetW, sheetH, placements, opts, sheets)
  }

  return sheets
}


/** Bounding box das peças colocadas (coordenadas da folha). */
export function getPlacementsBBox(
  placements: PackedPlacement[],
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (placements.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of placements) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x + p.width)
    maxY = Math.max(maxY, p.y + p.height)
  }
  return { minX, minY, maxX, maxY }
}

/**
 * Retângulo de recorte = bbox das peças expandido por marginPx,
 * limitado à folha. Usado no export "Recortar espaços vazios".
 */
export function getCropRect(
  sheetW: number,
  sheetH: number,
  placements: PackedPlacement[],
  marginPx: number,
): { x: number; y: number; width: number; height: number } | null {
  const bbox = getPlacementsBBox(placements)
  if (!bbox) return null
  const x = Math.max(0, Math.floor(bbox.minX - marginPx))
  const y = Math.max(0, Math.floor(bbox.minY - marginPx))
  const right = Math.min(sheetW, Math.ceil(bbox.maxX + marginPx))
  const bottom = Math.min(sheetH, Math.ceil(bbox.maxY + marginPx))
  const width = Math.max(1, right - x)
  const height = Math.max(1, bottom - y)
  return { x, y, width, height }
}

/** Desloca placements para origem (0,0) relativa ao crop. */
export function shiftPlacements(
  placements: PackedPlacement[],
  offsetX: number,
  offsetY: number,
): PackedPlacement[] {
  return placements.map((p) => ({
    ...p,
    x: p.x - offsetX,
    y: p.y - offsetY,
  }))
}

function sheetUtilizationPct(
  placements: PackedPlacement[],
  widthPx: number,
  heightPx: number,
): number {
  if (widthPx <= 0 || heightPx <= 0 || placements.length === 0) return 0
  let area = 0
  for (const p of placements) area += p.width * p.height
  return Math.min(100, (area / (widthPx * heightPx)) * 100)
}

/**
 * Após packing em bin alto: reduz altura da folha ao conteúdo + margem inferior
 * e anexa métricas usedHeight / aproveitamento.
 */
function shrinkAutoHeightSheet(
  sheet: PackedSheet,
  config: SheetConfig,
  marginPx: number,
  opts: FinalizeOpts,
): { sheet: PackedSheet; overflow: boolean } {
  const bbox = getPlacementsBBox(sheet.placements)
  if (!bbox) {
    return { sheet, overflow: false }
  }
  const usedBottom = bbox.maxY + marginPx
  const usedHeightPx = Math.max(1, Math.ceil(usedBottom))
  const usedHeightCm = pxToCm(usedHeightPx, config.dpi)
  const overflow = usedHeightCm > MAX_AUTO_HEIGHT_CM + 0.05

  const widthPx = sheet.widthPx
  const heightPx = overflow
    ? roundPx(cmToPx(MAX_AUTO_HEIGHT_CM, config.dpi))
    : usedHeightPx

  const placements = sheet.placements
  // Re-gera preview na altura encolhida (só se a 1ª folha pediu preview)
  const wantPreview = !opts.skipPreview && sheet.index < opts.maxPreviewSheets
  const previewUrl = wantPreview
    ? buildPreviewUrl(widthPx, heightPx, placements)
    : ''

  return {
    overflow,
    sheet: {
      ...sheet,
      widthPx,
      heightPx,
      placements,
      previewUrl,
      usedHeightPx,
      usedHeightCm: Math.round(usedHeightCm * 10) / 10,
      utilizationPct:
        Math.round(sheetUtilizationPct(placements, widthPx, heightPx) * 10) / 10,
    },
  }
}

/**
 * Empacota artes em folhas.
 * - packMode maxrects: MaxRects (multi-bin), pode misturar artes
 * - packMode grade: shelf first-fit (fileiras alinhadas; adianta peça menor no vão antes de Folha N+1)
 * - packMode group_rows / group_cols: agrupa por arte em fileiras/colunas
 * - sheetGrowMode auto_height: largura fixa, altura cresce (1 tira, máx. MAX_AUTO_HEIGHT_CM)
 * - Área útil = folha − 2×margem; maxrects usa gapMm; grade/grupos usam gapXMm/gapYMm
 * - Rotação 90° é por arte (ArtItem.rotate90)
 */
export function packArts(
  arts: ArtItem[],
  config: SheetConfig,
  options?: PackArtsOptions,
): { sheets: PackedSheet[]; errors: string[]; printSizes: ArtPrintSize[] } {
  const opts: FinalizeOpts = {
    skipPreview: options?.skipPreview === true,
    maxPreviewSheets:
      options?.maxPreviewSheets == null
        ? Number.POSITIVE_INFINITY
        : Math.max(0, options.maxPreviewSheets),
  }
  const grow = config.sheetGrowMode === 'auto_height'
  const packConfig: SheetConfig = grow
    ? { ...config, heightCm: MAX_AUTO_HEIGHT_CM }
    : config

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

  const mode: PackMode = packConfig.packMode ?? 'maxrects'
  const marginPx = roundPx(mmToPx(packConfig.marginMm, packConfig.dpi))

  let sheets: PackedSheet[]
  if (mode === 'grade') {
    sheets = packGrade(validArts, validSizes, packConfig, opts)
  } else if (mode === 'group_rows' || mode === 'group_cols') {
    sheets = packGrouped(validArts, validSizes, packConfig, mode, opts)
  } else {
    sheets = packMaxRects(validArts, validSizes, packConfig, opts, errors)
  }

  if (grow) {
    if (sheets.length === 0) {
      return { sheets: [], errors, printSizes }
    }
    if (sheets.length > 1) {
      errors.push(
        `Folha sob medida: o conteúdo não cabe em ${MAX_AUTO_HEIGHT_CM} cm de altura ` +
          `(geraria ${sheets.length} tiras). Reduza quantidades, tamanho das artes ou aumente a largura.`,
      )
      // Ainda assim mostra a 1ª tira encolhida para o usuário ver o progresso
      const first = shrinkAutoHeightSheet(sheets[0], packConfig, marginPx, opts)
      return { sheets: [first.sheet], errors, printSizes }
    }
    const shrunk = shrinkAutoHeightSheet(sheets[0], packConfig, marginPx, opts)
    if (shrunk.overflow) {
      errors.push(
        `Folha sob medida: altura usada (${shrunk.sheet.usedHeightCm?.toFixed(1)} cm) ` +
          `excede o limite de ${MAX_AUTO_HEIGHT_CM} cm.`,
      )
    }
    return { sheets: [shrunk.sheet], errors, printSizes }
  }

  return { sheets, errors, printSizes }
}

/** Aplica smoothing só quando há reamostragem; 1:1 fica nítido. */
function applyDrawSmoothing(
  ctx: CanvasRenderingContext2D,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): void {
  const exact = srcW === dstW && srcH === dstH
  if (exact) {
    ctx.imageSmoothingEnabled = false
    return
  }
  ctx.imageSmoothingEnabled = true
  try {
    ctx.imageSmoothingQuality = 'high'
  } catch {
    /* Safari antigo */
  }
}

export function renderSheetCanvas(
  widthPx: number,
  heightPx: number,
  placements: PackedPlacement[],
): HTMLCanvasElement {
  const w = Math.max(1, Math.round(widthPx))
  const h = Math.max(1, Math.round(heightPx))
  const canvas = document.createElement('canvas')
  try {
    canvas.width = w
    canvas.height = h
  } catch {
    throw new Error(
      `Não foi possível criar canvas da folha (${w}×${h} px). Reduza o DPI ou o tamanho.`,
    )
  }
  if (canvas.width !== w || canvas.height !== h) {
    throw new Error(
      `Canvas da folha rejeitado (${w}×${h} px). Reduza o DPI ou o tamanho.`,
    )
  }
  const ctx = canvas.getContext('2d', { alpha: true })
  if (!ctx) throw new Error('Canvas 2D indisponível')
  ctx.clearRect(0, 0, w, h)

  for (const p of placements) {
    ctx.save()
    if (p.rotated) {
      // Rotação 90° horário: origem no canto, depois translate
      // drawImage destino pré-rotação: (p.height × p.width) ← source (w × h)
      applyDrawSmoothing(ctx, p.source.width, p.source.height, p.height, p.width)
      ctx.translate(p.x + p.width, p.y)
      ctx.rotate(Math.PI / 2)
      ctx.drawImage(p.source, 0, 0, p.height, p.width)
    } else {
      applyDrawSmoothing(ctx, p.source.width, p.source.height, p.width, p.height)
      ctx.drawImage(p.source, p.x, p.y, p.width, p.height)
    }
    ctx.restore()
  }

  return canvas
}

/**
 * Desenha só as peças que intersectam a faixa [clipY, clipY+clipH) no canvas
 * de destino (largura = sheetW, altura = clipH). Coordenadas Y locais = sheetY − clipY.
 */
export function renderSheetStrip(
  sheetW: number,
  clipY: number,
  clipH: number,
  placements: PackedPlacement[],
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = sheetW
  canvas.height = clipH
  const ctx = canvas.getContext('2d', { alpha: true })
  if (!ctx) throw new Error('Canvas 2D indisponível')
  ctx.clearRect(0, 0, sheetW, clipH)

  const clipBottom = clipY + clipH

  for (const p of placements) {
    if (p.y + p.height <= clipY || p.y >= clipBottom) continue
    ctx.save()
    if (p.rotated) {
      applyDrawSmoothing(ctx, p.source.width, p.source.height, p.height, p.width)
      ctx.translate(p.x + p.width, p.y - clipY)
      ctx.rotate(Math.PI / 2)
      ctx.drawImage(p.source, 0, 0, p.height, p.width)
    } else {
      applyDrawSmoothing(ctx, p.source.width, p.source.height, p.width, p.height)
      ctx.drawImage(p.source, p.x, p.y - clipY, p.width, p.height)
    }
    ctx.restore()
  }

  return canvas
}
