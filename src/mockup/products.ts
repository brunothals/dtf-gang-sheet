export type ProductId = 'prato' | 'copo' | 'taca' | 'tumbler'

export type ProductDef = {
  id: ProductId
  name: string
  /** Área de impressão em mm (largura × altura aproximada da arte) */
  printAreaMm: { width: number; height: number }
  description: string
  defaultColor: string
  /** Material hint for shading */
  material: 'porcelain' | 'plastic' | 'glass'
  /** Icon emoji for product cards */
  icon: string
}

export const PRODUCTS: ProductDef[] = [
  {
    id: 'prato',
    name: 'Prato',
    printAreaMm: { width: 180, height: 180 },
    description: 'Disco plano — arte no centro',
    defaultColor: '#f5f0e8',
    material: 'porcelain',
    icon: '🍽️',
  },
  {
    id: 'copo',
    name: 'Copo',
    printAreaMm: { width: 220, height: 90 },
    description: 'Cilindro — arte envolve a lateral',
    defaultColor: '#ffffff',
    material: 'porcelain',
    icon: '☕',
  },
  {
    id: 'taca',
    name: 'Taça',
    printAreaMm: { width: 200, height: 70 },
    description: 'Taça — arte na faixa do bojo',
    defaultColor: '#e8f4fc',
    material: 'glass',
    icon: '🥂',
  },
  {
    id: 'tumbler',
    name: 'Tumbler',
    printAreaMm: { width: 240, height: 140 },
    description: 'Copo alto — arte envolve a lateral',
    defaultColor: '#1a1a1a',
    material: 'plastic',
    icon: '🥤',
  },
]

export function getProduct(id: ProductId): ProductDef {
  const p = PRODUCTS.find((x) => x.id === id)
  if (!p) throw new Error(`Produto desconhecido: ${id}`)
  return p
}
