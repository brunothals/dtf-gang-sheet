/** Conversão consistente: px = cm * dpi / 2.54 */

import type { ArtItem, SheetConfig } from '../types'

export function cmToPx(cm: number, dpi: number): number {
  return (cm * dpi) / 2.54
}

export function mmToPx(mm: number, dpi: number): number {
  return (mm * dpi) / 25.4
}

export function pxToCm(px: number, dpi: number): number {
  return (px * 2.54) / dpi
}

export function roundPx(n: number): number {
  return Math.max(1, Math.round(n))
}

/**
 * Modo "lado maior": o maior lado da arte (após trim) vira maxSideCm;
 * o outro lado proporcional.
 */
export function computePrintSizeCm(
  trimmedW: number,
  trimmedH: number,
  maxSideCm: number,
): { widthCm: number; heightCm: number } {
  if (trimmedW <= 0 || trimmedH <= 0) {
    return { widthCm: maxSideCm, heightCm: maxSideCm }
  }
  if (trimmedW >= trimmedH) {
    return {
      widthCm: maxSideCm,
      heightCm: (trimmedH / trimmedW) * maxSideCm,
    }
  }
  return {
    widthCm: (trimmedW / trimmedH) * maxSideCm,
    heightCm: maxSideCm,
  }
}

/**
 * DPI nativo por arte: densidade tal que o retângulo impresso (cm) tenha
 * pelo menos tantos pixels quanto o canvas de origem (trimmed), sem downscale.
 *
 * Usa dimensões de impressão alinhadas aos eixos do PNG (antes do swap rotate90).
 * Rotação 90° só troca eixos no packing; a densidade necessária é a mesma.
 *
 * effectiveDpi = max(wPx/widthCm, hPx/heightCm) * 2.54
 */
export function artNativeDpi(art: ArtItem, maxSideCm: number): number {
  const wPx = art.trimmedWidthPx
  const hPx = art.trimmedHeightPx
  if (wPx <= 0 || hPx <= 0) return 0
  const { widthCm, heightCm } = computePrintSizeCm(wPx, hPx, maxSideCm)
  if (widthCm <= 0 || heightCm <= 0) return 0
  return Math.max(wPx / widthCm, hPx / heightCm) * 2.54
}

/**
 * DPI de exportação nativo da folha = max(effectiveDpi) sobre artes com qty ≥ 1.
 * Sem artes ativas → 300.
 */
export function computeNativeExportDpi(
  arts: ArtItem[],
  config: Pick<SheetConfig, 'maxSideCm'>,
): number {
  let maxDpi = 0
  for (const art of arts) {
    const qty = Math.max(0, Math.floor(art.quantity) || 0)
    if (qty < 1) continue
    const maxSide = art.maxSideCmOverride ?? config.maxSideCm
    maxDpi = Math.max(maxDpi, artNativeDpi(art, maxSide))
  }
  if (maxDpi <= 0) return 300
  // ceil garante que nunca fiquemos abaixo do 1:1 por arredondamento
  return Math.max(72, Math.ceil(maxDpi))
}

/**
 * DPI efetivo para packing/export:
 * - useNativeDpi (padrão): nativo das artes
 * - senão: dpi forçado do config
 */
export function resolveExportDpi(arts: ArtItem[], config: SheetConfig): number {
  if (config.useNativeDpi !== false) {
    return computeNativeExportDpi(arts, config)
  }
  const forced = Number(config.dpi)
  return Number.isFinite(forced) && forced > 0 ? forced : 300
}
