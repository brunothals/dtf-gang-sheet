import { saveAs } from 'file-saver'
import type { MockupCanvasHandle } from './MockupCanvas'

export type ExportPreset = {
  id: string
  label: string
  width: number
  height: number
}

export const EXPORT_PRESETS: ExportPreset[] = [
  { id: 'quad1080', label: 'Quadrado 1080', width: 1080, height: 1080 },
  { id: 'ml1200', label: 'ML 1200×1600', width: 1200, height: 1600 },
  { id: 'alta2048', label: 'Alta 2048', width: 2048, height: 2048 },
]

export function downloadMockupPng(
  canvas: MockupCanvasHandle | null,
  preset: ExportPreset,
  filenameBase = 'mockup-dtf',
): boolean {
  if (!canvas) return false
  const dataUrl = canvas.capture(preset.width, preset.height)
  if (!dataUrl) return false

  // Convert data URL → Blob for FileSaver
  const comma = dataUrl.indexOf(',')
  const b64 = dataUrl.slice(comma + 1)
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  const blob = new Blob([bytes], { type: 'image/png' })
  saveAs(blob, `${filenameBase}-${preset.width}x${preset.height}.png`)
  return true
}
