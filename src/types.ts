export interface SheetPreset {
  id: string
  label: string
  widthCm: number
  heightCm: number
  /** Agrupamento no seletor (optgroup). */
  group?: string
}

/** Modo de montagem das peças na folha. */
export type PackMode = 'maxrects' | 'group_rows' | 'group_cols'

export interface SheetConfig {
  widthCm: number
  heightCm: number
  marginMm: number
  /**
   * Gap único usado pelo modo maxrects (aproveitar espaço).
   * Nos modos em grupo, prefira gapXMm / gapYMm.
   */
  gapMm: number
  /**
   * Espaçamento horizontal (mm) — entre peças na fileira (group_rows)
   * ou entre colunas (group_cols).
   */
  gapXMm: number
  /**
   * Espaçamento entre linhas (group_rows) ou entre peças na coluna (group_cols).
   */
  gapYMm: number
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
  /**
   * DPI usado quando useNativeDpi=false (forçar DPI avançado).
   * Com qualidade nativa, o DPI efetivo vem das artes importadas.
   */
  dpi: number
  /**
   * Se true (padrão), empacota e exporta no DPI nativo das PNGs
   * (sem reduzir qualidade). Se false, usa `dpi` forçado.
   */
  useNativeDpi: boolean
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

/** Presets de folha (ML + rolo DTF + papel). Labels em Largura × Altura cm. */
export const SHEET_PRESETS: SheetPreset[] = [
  // Mercado Livre / DTF UV comum
  { id: '29x21', label: '29 × 21 cm', widthCm: 29, heightCm: 21, group: 'Mercado Livre' },
  { id: '29x42', label: '29 × 42 cm', widthCm: 29, heightCm: 42, group: 'Mercado Livre' },
  { id: '29x50', label: '29 × 50 cm', widthCm: 29, heightCm: 50, group: 'Mercado Livre' },
  { id: '29x100', label: '29 × 100 cm', widthCm: 29, heightCm: 100, group: 'Mercado Livre' },
  // Rolo DTF (inspirado no Organizador Nesting)
  { id: 'rolo-60x40', label: 'Rolo DTF 60 × 40 cm (L×A)', widthCm: 60, heightCm: 40, group: 'Rolo DTF' },
  { id: 'rolo-90x60', label: 'Rolo DTF 90 × 60 cm (L×A)', widthCm: 90, heightCm: 60, group: 'Rolo DTF' },
  { id: 'rolo-120x80', label: 'Rolo DTF 120 × 80 cm (L×A)', widthCm: 120, heightCm: 80, group: 'Rolo DTF' },
  { id: 'rolo-150x100', label: 'Rolo DTF 150 × 100 cm (L×A)', widthCm: 150, heightCm: 100, group: 'Rolo DTF' },
  // Papel ISO
  { id: 'a4', label: 'A4 — 21 × 29,7 cm (L×A)', widthCm: 21, heightCm: 29.7, group: 'Papel' },
  { id: 'a3', label: 'A3 — 29,7 × 42 cm (L×A)', widthCm: 29.7, heightCm: 42, group: 'Papel' },
  { id: 'a2', label: 'A2 — 42 × 59,4 cm (L×A)', widthCm: 42, heightCm: 59.4, group: 'Papel' },
  { id: 'a1', label: 'A1 — 59,4 × 84,1 cm (L×A)', widthCm: 59.4, heightCm: 84.1, group: 'Papel' },
  { id: 'custom', label: 'Personalizado', widthCm: 29, heightCm: 42, group: 'Outro' },
]

export const DEFAULT_CONFIG: SheetConfig = {
  widthCm: 29,
  heightCm: 42,
  marginMm: 5,
  gapMm: 3,
  gapXMm: 1,
  gapYMm: 1,
  allowRotation: false,
  packMode: 'maxrects',
  dpi: 300,
  useNativeDpi: true,
  maxSideCm: 5,
  trimEnabled: true,
  alphaThreshold: 8,
}

/**
 * Garante gapXMm/gapYMm a partir de gapMm quando configs antigas não têm os campos.
 */
export function normalizeSheetConfig(partial: Partial<SheetConfig> & Pick<SheetConfig, 'widthCm' | 'heightCm'>): SheetConfig {
  const base = { ...DEFAULT_CONFIG, ...partial }
  const fallbackGap = base.gapMm ?? DEFAULT_CONFIG.gapMm
  if (partial.gapXMm == null) base.gapXMm = fallbackGap
  if (partial.gapYMm == null) base.gapYMm = fallbackGap
  return base
}
