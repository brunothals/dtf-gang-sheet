import JSZip from 'jszip'
import { saveAs } from 'file-saver'
import type { PackedPlacement, PackedSheet } from '../types'
import { renderSheetCanvas } from './pack'

/** Injeta chunk pHYs (pixels por metro) para embutir DPI no PNG. */
function injectPhysChunk(png: ArrayBuffer, dpi: number): Blob {
  const ppm = Math.round(dpi / 0.0254) // pixels per meter
  const bytes = new Uint8Array(png)

  // PNG signature
  if (
    bytes[0] !== 0x89 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x4e ||
    bytes[3] !== 0x47
  ) {
    return new Blob([png], { type: 'image/png' })
  }

  // Encontrar fim do IHDR (após signature 8 + length 4 + type 4 + data 13 + crc 4 = 33)
  let offset = 8
  const view = new DataView(png)

  // Procurar IHDR
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset)
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7],
    )
    if (type === 'IHDR') {
      const insertAt = offset + 8 + length + 4 // após IHDR+CRC
      const phys = buildPhysChunk(ppm)
      const out = new Uint8Array(bytes.length + phys.length)
      out.set(bytes.subarray(0, insertAt), 0)
      out.set(phys, insertAt)
      out.set(bytes.subarray(insertAt), insertAt + phys.length)
      return new Blob([out], { type: 'image/png' })
    }
    if (type === 'IEND') break
    offset += 8 + length + 4
  }

  return new Blob([png], { type: 'image/png' })
}

function buildPhysChunk(ppm: number): Uint8Array {
  // pHYs: 4+4+1 = 9 bytes data
  const data = new Uint8Array(9)
  const dv = new DataView(data.buffer)
  dv.setUint32(0, ppm)
  dv.setUint32(4, ppm)
  data[8] = 1 // unit: meter

  const type = new TextEncoder().encode('pHYs')
  const crcInput = new Uint8Array(4 + 9)
  crcInput.set(type, 0)
  crcInput.set(data, 4)
  const crc = crc32(crcInput)

  const chunk = new Uint8Array(4 + 4 + 9 + 4)
  const cv = new DataView(chunk.buffer)
  cv.setUint32(0, 9)
  chunk.set(type, 4)
  chunk.set(data, 8)
  cv.setUint32(17, crc)
  return chunk
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c
  }
  return table
})()

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

export async function sheetToPngBlob(
  sheet: PackedSheet,
  dpi: number,
  placements?: PackedPlacement[],
): Promise<Blob> {
  const canvas = placements
    ? renderSheetCanvas(sheet.widthPx, sheet.heightPx, placements)
    : renderSheetCanvas(sheet.widthPx, sheet.heightPx, sheet.placements)

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Falha ao gerar PNG'))),
      'image/png',
    )
  })
  const buf = await blob.arrayBuffer()
  return injectPhysChunk(buf, dpi)
}

export async function downloadSheetPng(
  sheet: PackedSheet,
  dpi: number,
  filename?: string,
): Promise<void> {
  const blob = await sheetToPngBlob(sheet, dpi)
  const name = filename ?? `folha-${sheet.index + 1}.png`
  saveAs(blob, name)
}

export async function downloadAllSheetsZip(
  sheets: PackedSheet[],
  dpi: number,
  zipName = 'gang-sheets.zip',
): Promise<void> {
  const zip = new JSZip()
  for (const sheet of sheets) {
    const blob = await sheetToPngBlob(sheet, dpi)
    zip.file(`folha-${String(sheet.index + 1).padStart(2, '0')}.png`, blob)
  }
  const content = await zip.generateAsync({ type: 'blob' })
  saveAs(content, zipName)
}
