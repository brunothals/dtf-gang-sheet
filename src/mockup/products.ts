export type ProductId = 'copo_americano' | 'xicara_cafe' | 'prato'

export type ArtSizeCm = { width: number; height: number }

export type ColorPartDef = {
  id: string
  label: string
  default: string
}

export type ProductDef = {
  id: ProductId
  name: string
  description: string
  icon: string
  material: 'glass' | 'porcelain'
  /** Outer diameter (cm) — used for scale reference */
  diameterCm: number
  /** Overall height (cm); plates use rim height */
  heightCm: number
  /** Default UV DTF art size on the product */
  defaultArtSizeCm: ArtSizeCm
  /** Max recommended art size (for clamps / guides) */
  maxArtSizeCm: ArtSizeCm
  /** Default vertical center of the print (cm from product bottom / plate face) */
  printCenterYCm: number
  colorParts: ColorPartDef[]
}

/** Presets de tamanho da arte em cm (UV DTF — adesivo, não wrap) */
export const ART_SIZE_PRESETS: { id: string; label: string; size: ArtSizeCm | null }[] = [
  { id: '5x5', label: '5×5 cm', size: { width: 5, height: 5 } },
  { id: '6x6', label: '6×6 cm', size: { width: 6, height: 6 } },
  { id: '7x5', label: '7×5 cm', size: { width: 7, height: 5 } },
  { id: '8x8', label: '8×8 cm', size: { width: 8, height: 8 } },
  { id: '10x10', label: '10×10 cm', size: { width: 10, height: 10 } },
  { id: 'custom', label: 'Personalizado', size: null },
]

/** Presets de cor para xícara / prato */
export const CERAMIC_COLOR_PRESETS: { id: string; label: string; hex: string }[] = [
  { id: 'branco', label: 'Branco', hex: '#f7f4ef' },
  { id: 'preto', label: 'Preto', hex: '#1a1a1a' },
  { id: 'vermelho', label: 'Vermelho', hex: '#b91c1c' },
  { id: 'azul', label: 'Azul', hex: '#1e3a8a' },
  { id: 'bege', label: 'Bege', hex: '#d4c4a8' },
]

/** Tons de vidro para copo americano */
export const GLASS_TINT_PRESETS: { id: string; label: string; hex: string }[] = [
  { id: 'cristal', label: 'Cristal', hex: '#e8f4fc' },
  { id: 'fumaca', label: 'Fumaça', hex: '#6b7280' },
  { id: 'azul', label: 'Azul', hex: '#3b82c4' },
  { id: 'ambar', label: 'Âmbar', hex: '#c47a3b' },
]

export const PRODUCTS: ProductDef[] = [
  {
    id: 'copo_americano',
    name: 'Copo americano',
    description:
      'Copo americano ~190 ml (Ø 6,7 × H 9,3 cm). Arte UV DTF frontal em tamanho real — tipicamente 6×6 ou 7×5 cm.',
    icon: '🥃',
    material: 'glass',
    diameterCm: 6.7,
    heightCm: 9.3,
    defaultArtSizeCm: { width: 6, height: 6 },
    maxArtSizeCm: { width: 8, height: 7 },
    printCenterYCm: 5.2,
    colorParts: [
      { id: 'glass', label: 'Tom do vidro', default: '#e8f4fc' },
    ],
  },
  {
    id: 'xicara_cafe',
    name: 'Xícara de café',
    description:
      'Xícara cerâmica ~325 ml com alça. Decal frontal no corpo — padrão 8×8 cm.',
    icon: '☕',
    material: 'porcelain',
    diameterCm: 8.2,
    heightCm: 9.5,
    defaultArtSizeCm: { width: 8, height: 8 },
    maxArtSizeCm: { width: 10, height: 8 },
    printCenterYCm: 5.0,
    colorParts: [
      { id: 'body', label: 'Corpo', default: '#f7f4ef' },
      { id: 'handle', label: 'Alça', default: '#f7f4ef' },
      { id: 'interior', label: 'Interior', default: '#ffffff' },
    ],
  },
  {
    id: 'prato',
    name: 'Prato',
    description:
      'Prato de sobremesa/jantar (~Ø 22 cm) com borda e poço. Arte centralizada na face — padrão 10×10 cm.',
    icon: '🍽️',
    material: 'porcelain',
    diameterCm: 22,
    heightCm: 2.2,
    defaultArtSizeCm: { width: 10, height: 10 },
    maxArtSizeCm: { width: 14, height: 14 },
    printCenterYCm: 0.85,
    colorParts: [
      { id: 'plate', label: 'Prato', default: '#f5f0e8' },
      { id: 'rim', label: 'Borda', default: '#f5f0e8' },
    ],
  },
]

export function getProduct(id: ProductId): ProductDef {
  const p = PRODUCTS.find((x) => x.id === id)
  if (!p) throw new Error(`Produto desconhecido: ${id}`)
  return p
}

export function defaultColorsFor(id: ProductId): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of getProduct(id).colorParts) {
    out[part.id] = part.default
  }
  return out
}
