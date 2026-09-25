export interface SheetPreset {
  id: string
  label: string
  widthCm: number
  heightCm: number
}

/** Modo de montagem das peças na folha. */
export type PackMode = 'maxrects' | 'group_rows' | 'group_cols'

export interface SheetConfig {
  widthCm: number
  heightCm: number
  marginMm: number
  gapMm: number
  /**
   * Legacy flag (kept for backward compat). Unused by the packer —
   * rotation is per-art via ArtItem.rotate90.
   */
  allowRotation: boolean
  /**
   * maxrects = aproveitar espaço (MaxRects, pode misturar artes).
   * group_rows / group_cols = agrupar por arte em fileiras/colunas (recorte com tesoura).
   */
  packMode: PackMode
  dpi: number
  maxSideCm: number
  /** Cortar bordas transparentes (alpha bbox) */
  trimEnabled: boolean
  alphaThreshold: number
}

export interface ArtItem {
  id: string
  name: string
  /** Canvas original (sem corte), mantido para reprocessar */
  originalCanvas: HTMLCanvasElement
  originalWidthPx: number
  originalHeightPx: number
  /** Canvas ativo para packing/preview/export (cortado ou original) */
  trimmedCanvas: HTMLCanvasElement
  trimmedWidthPx: number
  trimmedHeightPx: number
  thumbnailUrl: string
  quantity: number
  /** Optional override; null = use global maxSideCm */
  maxSideCmOverride: number | null
  /**
   * Se true, todas as cópias desta arte são impressas giradas 90°
   * (largura/altura trocadas). Nunca misturar orientações da mesma arte.
   */
  rotate90: boolean
  error?: string
}

export interface PackedPlacement {
  artId: string
  name: string
  x: number
  y: number
  width: number
  height: number
  rotated: boolean
  source: HTMLCanvasElement
}

export interface PackedSheet {
  index: number
  widthPx: number
  heightPx: number
  placements: PackedPlacement[]
  previewUrl: string
}

export const SHEET_PRESETS: SheetPreset[] = [
  { id: '29x21', label: '29 × 21 cm', widthCm: 29, heightCm: 21 },
  { id: '29x42', label: '29 × 42 cm', widthCm: 29, heightCm: 42 },
  { id: '29x50', label: '29 × 50 cm', widthCm: 29, heightCm: 50 },
  { id: '29x100', label: '29 × 100 cm', widthCm: 29, heightCm: 100 },
  { id: 'custom', label: 'Personalizado', widthCm: 29, heightCm: 42 },
]

export const DEFAULT_CONFIG: SheetConfig = {
  widthCm: 29,
  heightCm: 42,
  marginMm: 5,
  gapMm: 3,
  allowRotation: false,
  packMode: 'maxrects',
  dpi: 300,
  maxSideCm: 5,
  trimEnabled: true,
  alphaThreshold: 8,
}
