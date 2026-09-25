export type ProductId =
  | 'copo_americano'
  | 'xicara_cafe'
  | 'prato'
  | 'xicara_cha'
  | 'xicara_dupla_face'
  | 'garrafa_termica'

export type ArtSizeCm = { width: number; height: number }

export type MaterialKind = 'glass' | 'porcelain' | 'metal'

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
  material: MaterialKind
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
  { id: '7x12', label: '7×12 cm', size: { width: 7, height: 12 } },
  { id: '8x8', label: '8×8 cm', size: { width: 8, height: 8 } },
  { id: '8x15', label: '8×15 cm', size: { width: 8, height: 15 } },
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

/** Cores do corpo da garrafa térmica (aço / pintura) */
export const METAL_COLOR_PRESETS: { id: string; label: string; hex: string }[] = [
  { id: 'prata', label: 'Prata escovado', hex: '#c5c9ce' },
  { id: 'preto', label: 'Preto fosco', hex: '#1c1c1e' },
  { id: 'branco', label: 'Branco', hex: '#f2f2f0' },
  { id: 'azul', label: 'Azul petróleo', hex: '#1e3a5f' },
  { id: 'verde', label: 'Verde musgo', hex: '#3d4f3a' },
  { id: 'rose', label: 'Rose gold', hex: '#b76e79' },
]

export const PRODUCTS: ProductDef[] = [
  {
    id: 'copo_americano',
    name: 'Copo americano',
    description:
      'Copo americano ~190 ml (Ø 6,7 × H 9,3 cm), paredes de vidro espessas e frisos Nadir. Arte UV DTF frontal — tipicamente 6×6 ou 7×5 cm.',
    icon: '🥃',
    material: 'glass',
    diameterCm: 6.7,
    heightCm: 9.3,
    defaultArtSizeCm: { width: 6, height: 6 },
    maxArtSizeCm: { width: 8, height: 7 },
    printCenterYCm: 5.2,
    colorParts: [{ id: 'glass', label: 'Tom do vidro', default: '#e8f4fc' }],
  },
  {
    id: 'xicara_cafe',
    name: 'Caneca / café',
    description:
      'Caneca cerâmica ~325 ml com alça. Decal frontal no corpo — padrão 8×8 cm.',
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
    id: 'xicara_cha',
    name: 'Xícara de chá',
    description:
      'Xícara menor ~200 ml (Ø 7,2 × H 7,2 cm), alça fina. Arte frontal — padrão 6×6 cm.',
    icon: '🍵',
    material: 'porcelain',
    diameterCm: 7.2,
    heightCm: 7.2,
    defaultArtSizeCm: { width: 6, height: 6 },
    maxArtSizeCm: { width: 8, height: 6 },
    printCenterYCm: 3.8,
    colorParts: [
      { id: 'body', label: 'Corpo', default: '#f7f4ef' },
      { id: 'handle', label: 'Alça', default: '#f7f4ef' },
      { id: 'interior', label: 'Interior', default: '#ffffff' },
    ],
  },
  {
    id: 'xicara_dupla_face',
    name: 'Xícara dupla face',
    description:
      'Caneca compacta ~6,5 cm (estilo espresso / parede dupla). Ideal para artes pequenas — padrão 5×5 cm. Decal frontal (adesivo UV).',
    icon: '🧁',
    material: 'porcelain',
    diameterCm: 6.4,
    heightCm: 6.5,
    defaultArtSizeCm: { width: 5, height: 5 },
    maxArtSizeCm: { width: 7, height: 5.5 },
    printCenterYCm: 3.4,
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
      'Prato de sobremesa/jantar (~Ø 20 cm) com borda, poço e pé. Arte centralizada na face — padrão 10×10 cm.',
    icon: '🍽️',
    material: 'porcelain',
    diameterCm: 20,
    heightCm: 2.2,
    defaultArtSizeCm: { width: 10, height: 10 },
    maxArtSizeCm: { width: 14, height: 14 },
    printCenterYCm: 0.85,
    colorParts: [
      { id: 'plate', label: 'Prato', default: '#f5f0e8' },
      { id: 'rim', label: 'Borda', default: '#f5f0e8' },
    ],
  },
  {
    id: 'garrafa_termica',
    name: 'Garrafa térmica',
    description:
      'Copo térmico aço ~500 ml (Ø 7,2 × H 20 cm) com tampa. Arte frontal — padrão 7×12 cm.',
    icon: '🧴',
    material: 'metal',
    diameterCm: 7.2,
    heightCm: 20,
    defaultArtSizeCm: { width: 7, height: 12 },
    maxArtSizeCm: { width: 9, height: 15 },
    printCenterYCm: 10.5,
    colorParts: [
      { id: 'body', label: 'Corpo', default: '#c5c9ce' },
      { id: 'lid', label: 'Tampa', default: '#2a2a2c' },
      { id: 'base', label: 'Base', default: '#1a1a1a' },
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
