import type { ArtDef, BestFit, PlaceItem, PlacedRect, SheetPack } from './types'
import { SHEET_WIDTH_CM } from './types'

/** Quantas artes de tamanho `size` cabem em `dim`, com espaçamento só ENTRE artes. */
export function countFit(dim: number, size: number, esp: number): number {
  if (size > dim + 0.001) return 0
  return 1 + Math.floor((dim - size) / (size + esp))
}

export function artFits(
  aw: number,
  ah: number,
  fw: number,
  fh: number,
  useRot: boolean,
): boolean {
  return (
    (aw <= fw + 0.001 && ah <= fh + 0.001) ||
    (useRot && ah <= fw + 0.001 && aw <= fh + 0.001)
  )
}

export function bestFit(
  aw: number,
  ah: number,
  fw: number,
  fh: number,
  esp: number,
  useRot: boolean,
): BestFit {
  const c0 = countFit(fw, aw, esp)
  const r0 = countFit(fh, ah, esp)
  const c1 = countFit(fw, ah, esp)
  const r1 = countFit(fh, aw, esp)
  const n0 = c0 * r0
  const n1 = useRot !== false && ah <= fw && aw <= fh ? c1 * r1 : 0
  if (n1 > n0) return { total: n1, rotated: true, aw: ah, ah: aw, cols: c1, rows: r1 }
  return { total: n0, rotated: false, aw, ah, cols: c0, rows: r0 }
}

type Rect = { x: number; y: number; w: number; h: number }

function intersects(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.w - 0.001 &&
    a.x + a.w > b.x + 0.001 &&
    a.y < b.y + b.h - 0.001 &&
    a.y + a.h > b.y + 0.001
  )
}

function contained(a: Rect, b: Rect): boolean {
  return (
    a.x >= b.x - 0.001 &&
    a.y >= b.y - 0.001 &&
    a.x + a.w <= b.x + b.w + 0.001 &&
    a.y + a.h <= b.y + b.h + 0.001
  )
}

function pruneFree(free: Rect[]): Rect[] {
  let out: Rect[] = []
  for (const r of free) {
    if (r.w <= 0.001 || r.h <= 0.001) continue
    const dup = out.some((o) => contained(r, o))
    if (!dup) {
      out = out.filter((o) => !contained(o, r)).concat([r])
    }
  }
  return out
}

function splitFree(free: Rect[], used: Rect): Rect[] {
  const next: Rect[] = []
  for (const r of free) {
    if (!intersects(r, used)) {
      next.push(r)
      continue
    }
    const rx2 = r.x + r.w
    const ry2 = r.y + r.h
    const ux2 = used.x + used.w
    const uy2 = used.y + used.h
    if (used.y > r.y) next.push({ x: r.x, y: r.y, w: r.w, h: used.y - r.y })
    if (uy2 < ry2) next.push({ x: r.x, y: uy2, w: r.w, h: ry2 - uy2 })
    if (used.x > r.x) next.push({ x: r.x, y: r.y, w: used.x - r.x, h: r.h })
    if (ux2 < rx2) next.push({ x: ux2, y: r.y, w: rx2 - ux2, h: r.h })
  }
  return pruneFree(next)
}

function variants(
  item: PlaceItem,
  fw: number,
  fh: number,
  useRot: boolean,
): Array<{ w: number; h: number; rotated: boolean }> {
  const out: Array<{ w: number; h: number; rotated: boolean }> = [
    { w: item.origW, h: item.origH, rotated: false },
  ]
  if (useRot && Math.abs(item.origW - item.origH) > 0.001) {
    out.push({ w: item.origH, h: item.origW, rotated: true })
  }
  return out.filter((v) => v.w <= fw + 0.001 && v.h <= fh + 0.001)
}

function placeWithSort(
  sorted: PlaceItem[],
  fw: number,
  fh: number,
  esp: number,
  useRot: boolean,
): PlacedRect[] {
  let free: Rect[] = [{ x: 0, y: 0, w: fw, h: fh }]
  const placed: PlacedRect[] = []

  for (const item of sorted) {
    const opts = variants(item, fw, fh, useRot)
    let best: { rect: Rect; opt: { w: number; h: number; rotated: boolean }; score: number } | null =
      null

    for (const r of free) {
      for (const opt of opts) {
        if (opt.w <= r.w + 0.001 && opt.h <= r.h + 0.001) {
          const shortSide = Math.min(r.w - opt.w, r.h - opt.h)
          const areaWaste = r.w * r.h - opt.w * opt.h
          const score = shortSide * 100000 + areaWaste + r.y * 10 + r.x
          if (!best || score < best.score) best = { rect: r, opt, score }
        }
      }
    }

    if (best) {
      const p: PlacedRect = {
        x: best.rect.x,
        y: best.rect.y,
        w: best.opt.w,
        h: best.opt.h,
        idx: item.idx,
        rotated: best.opt.rotated,
      }
      placed.push(p)
      const used: Rect = {
        x: p.x,
        y: p.y,
        w: p.w + (p.x + p.w < fw - 0.001 ? esp : 0),
        h: p.h + (p.y + p.h < fh - 0.001 ? esp : 0),
      }
      free = splitFree(free, used)
    }
  }
  return placed
}

const SORTERS: Array<(a: PlaceItem, b: PlaceItem) => number> = [
  (a, b) =>
    Math.max(b.origW, b.origH) - Math.max(a.origW, a.origH) ||
    b.origW * b.origH - a.origW * a.origH,
  (a, b) => b.origW * b.origH - a.origW * a.origH,
  (a, b) => b.origH - a.origH || b.origW - a.origW,
  (a, b) => b.origW - a.origW || b.origH - a.origH,
]

/** Empacota itens em uma única folha (algoritmo da Calculadora DTF UV 2). */
export function packArts(
  items: PlaceItem[],
  fw: number,
  fh: number,
  esp: number,
  useRot: boolean,
): PlacedRect[] {
  let best: PlacedRect[] = []
  for (const sorter of SORTERS) {
    const candidate = placeWithSort(items.slice().sort(sorter), fw, fh, esp, useRot)
    if (candidate.length > best.length) best = candidate
  }
  return best
}

/**
 * Empacota em múltiplas folhas do tamanho fixo até acomodar tudo
 * (ou até um limite de segurança).
 */
export function packOntoSheets(
  items: PlaceItem[],
  fw: number,
  fh: number,
  esp: number,
  useRot: boolean,
  maxSheets = 40,
): SheetPack[] {
  const remaining = items.slice()
  const sheets: SheetPack[] = []
  let guard = 0

  while (remaining.length > 0 && guard < maxSheets) {
    guard++
    const placed = packArts(remaining, fw, fh, esp, useRot)
    if (placed.length === 0) break

    // Remover da fila os itens colocados (por idx+ordem — usar matching 1:1)
    const used = new Map<number, number>()
    for (const p of placed) used.set(p.idx, (used.get(p.idx) || 0) + 1)

    const next: PlaceItem[] = []
    for (const item of remaining) {
      const n = used.get(item.idx) || 0
      if (n > 0) used.set(item.idx, n - 1)
      else next.push(item)
    }

    const usedH =
      placed.length === 0
        ? fh
        : Math.round((Math.max(...placed.map((p) => p.y + p.h)) + Number.EPSILON) * 10) / 10

    sheets.push({
      sheetIndex: sheets.length + 1,
      placed,
      heightCm: Math.min(fh, usedH),
    })
    remaining.length = 0
    remaining.push(...next)
  }

  return sheets
}

/** Encontra a menor altura (passo 0,5 cm) que comporta todos os itens em largura 29 cm. */
export function findIdealHeight(
  items: PlaceItem[],
  esp: number,
  useRot: boolean,
  arts: ArtDef[],
): number | null {
  const FW = SHEET_WIDTH_CM
  const minH = Math.max(
    ...arts.map((a) => {
      if (useRot && a.origH <= FW && a.origW > a.origH) return a.origW
      return a.origH
    }),
  )

  for (let h = minH; h <= 500; h += 0.5) {
    const pl = packArts(items.slice(), FW, h, esp, useRot)
    if (pl.length >= items.length) return Math.round(h * 10) / 10
  }
  return null
}

export function money(v: number): string {
  return `R$ ${(Number(v) || 0).toFixed(2).replace('.', ',')}`
}

export function fmtCm(n: number): string {
  return String(Number(n.toFixed(2))).replace('.', ',')
}
