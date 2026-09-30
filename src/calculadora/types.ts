export type FolhaPreset = {
  label: string
  w: number
  h: number
  cost: number
}

export type ArtInput = {
  id: string
  name: string
  origW: number
  origH: number
  qty: number
  color: string
}

export type ArtDef = {
  origW: number
  origH: number
  idx: number
  color: string
  name: string
  qty: number
}

export type PlaceItem = {
  origW: number
  origH: number
  idx: number
}

export type PlacedRect = {
  x: number
  y: number
  w: number
  h: number
  idx: number
  rotated: boolean
}

export type FolhaInfo = {
  w: number
  h: number
  label: string
  cost: number
}

export type SheetPack = {
  sheetIndex: number
  placed: PlacedRect[]
  heightCm: number
}

export type CalcResult = {
  mode: 'normal' | 'inv'
  folha: FolhaInfo
  arts: ArtDef[]
  placed: PlacedRect[]
  sheets: SheetPack[]
  aprov: number
  esp: number
  s2w: number
  s2h: number
  s2Color: string
  s2Placed: number
  requested: number
  missing: number
  rotCount: number
  useRot: boolean
}

export type SavedOrder = {
  id: string
  createdAt: string
  client: string
  ad: string
  sheet: string
  requested: number
  placed: number
  summary: string
  orcamento: string
}

export type BestFit = {
  total: number
  rotated: boolean
  aw: number
  ah: number
  cols: number
  rows: number
}

export const COLORS = [
  '#a78bfa',
  '#22c55e',
  '#f97316',
  '#38bdf8',
  '#f43f5e',
  '#c084fc',
  '#fbbf24',
  '#34d399',
  '#f472b6',
  '#60a5fa',
]

export const FOLHAS_PAD: FolhaPreset[] = [
  { label: '29 x 21 cm', w: 29, h: 21, cost: 39 },
  { label: '29 x 42 cm', w: 29, h: 42, cost: 49.9 },
  { label: '29 x 50 cm', w: 29, h: 50, cost: 65.9 },
  { label: '29 x 100 cm', w: 29, h: 100, cost: 99 },
]

export const ORDERS_KEY = 'dtfuv_orders_v1'
export const SHEET_WIDTH_CM = 29
