import type { ArtItem, SheetConfig } from '../types'
import { getArtPrintSize, packArts } from './pack'

const MAX_QTY_CAP = 10_000
const FILL_LEFTOVER_MAX_ITERS = 500

/** Conta folhas sem gerar preview (rápido para busca binária / sobras). */
function sheetCount(arts: ArtItem[], config: SheetConfig): number {
  return packArts(arts, config, { skipPreview: true }).sheets.length
}

function artFits(art: ArtItem, config: SheetConfig): boolean {
  return !getArtPrintSize(art, config).error
}

/**
 * Maior quantidade de uma arte sozinha que ainda cabe em exatamente 1 folha.
 * Respeita tamanho (override/global), gap, margem e ArtItem.rotate90 via packArts.
 */
export function maxQtyOneArtOnOneSheet(art: ArtItem, config: SheetConfig): number {
  if (!artFits(art, config)) return 0

  const alone = (qty: number): ArtItem[] => [{ ...art, quantity: qty }]

  if (sheetCount(alone(1), config) !== 1) return 0

  let lo = 1
  let hi = 2
  while (hi <= MAX_QTY_CAP && sheetCount(alone(hi), config) === 1) {
    lo = hi
    hi *= 2
  }
  hi = Math.min(hi, MAX_QTY_CAP)

  let best = lo
  let left = lo
  let right = hi
  while (left <= right) {
    const mid = Math.floor((left + right) / 2)
    if (sheetCount(alone(mid), config) === 1) {
      best = mid
      left = mid + 1
    } else {
      right = mid - 1
    }
  }
  return best
}

/**
 * Maior Q tal que todas as artes (cada uma com quantity = Q) cabem em no máximo 1 folha.
 */
export function maxEqualQtyOnOneSheet(arts: ArtItem[], config: SheetConfig): number {
  const fitting = arts.filter((a) => artFits(a, config))
  if (fitting.length === 0) return 0

  const withQty = (qty: number): ArtItem[] =>
    fitting.map((a) => ({ ...a, quantity: qty }))

  // Q=0 → 0 folhas (ok); precisamos do maior Q com sheets.length <= 1
  if (sheetCount(withQty(1), config) > 1) return 0

  let lo = 1
  let hi = 2
  while (hi <= MAX_QTY_CAP && sheetCount(withQty(hi), config) <= 1) {
    lo = hi
    hi *= 2
  }
  hi = Math.min(hi, MAX_QTY_CAP)

  let best = lo
  let left = lo
  let right = hi
  while (left <= right) {
    const mid = Math.floor((left + right) / 2)
    if (sheetCount(withQty(mid), config) <= 1) {
      best = mid
      left = mid + 1
    } else {
      right = mid - 1
    }
  }
  return best
}

export interface FillLeftoverResult {
  arts: ArtItem[]
  added: number
  sheetsBefore: number
  sheetsAfter: number
}

/**
 * Adiciona cópias extras no espaço sobrando, sem aumentar o número de folhas.
 * Round-robin entre artes com quantity ≥ 1 (e que cabem no tamanho atual).
 * Respeita ArtItem.rotate90 ao medir o encaixe.
 */
export function fillLeftoverQuantities(
  arts: ArtItem[],
  config: SheetConfig,
): FillLeftoverResult {
  const sheetsBefore = sheetCount(arts, config)
  if (sheetsBefore === 0) {
    return { arts, added: 0, sheetsBefore: 0, sheetsAfter: 0 }
  }

  const candidateIds = arts
    .filter((a) => a.quantity >= 1 && artFits(a, config))
    .map((a) => a.id)

  if (candidateIds.length === 0) {
    return { arts, added: 0, sheetsBefore, sheetsAfter: sheetsBefore }
  }

  const next = arts.map((a) => ({ ...a }))
  const idToIndex = new Map(next.map((a, i) => [a.id, i]))
  let added = 0
  let rr = 0

  for (let iter = 0; iter < FILL_LEFTOVER_MAX_ITERS; iter++) {
    let progressed = false
    for (let t = 0; t < candidateIds.length; t++) {
      const cIdx = (rr + t) % candidateIds.length
      const artId = candidateIds[cIdx]
      const i = idToIndex.get(artId)
      if (i == null) continue

      next[i] = { ...next[i], quantity: next[i].quantity + 1 }
      if (sheetCount(next, config) <= sheetsBefore) {
        added++
        rr = (cIdx + 1) % candidateIds.length
        progressed = true
        break
      }
      next[i] = { ...next[i], quantity: next[i].quantity - 1 }
    }
    if (!progressed) break
  }

  const sheetsAfter = sheetCount(next, config)
  return { arts: next, added, sheetsBefore, sheetsAfter }
}
