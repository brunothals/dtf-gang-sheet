import JSZip from 'jszip'
import { saveAs } from 'file-saver'
import type { PackedPlacement, PackedSheet } from '../types'
import { renderSheetCanvas, renderSheetStrip } from './pack'

/** Limite seguro por dimensão (fallback se o probe falhar). */
const FALLBACK_MAX_DIM = 8192
/** Área máxima tentada em canvas único. */
const SAFE_MAX_AREA = 67_000_000
/** Altura alvo de cada faixa no render em tiles. */
const STRIP_HEIGHT = 2048

let cachedMaxDim: number | null = null

/** Detecta o maior lado de canvas que o browser aceita (até 16384). */
export function getMaxCanvasDimension(): number {
  if (cachedMaxDim != null) return cachedMaxDim
  const candidates = [16384, 8192, 4096]
  for (const n of candidates) {
    try {
      const c = document.createElement('canvas')
      c.width = n
      c.height = 1
      if (c.width === n && c.height === 1) {
        const ctx = c.getContext('2d')
        if (ctx) {
          cachedMaxDim = n
          return n
        }
      }
    } catch {
      /* tenta menor */
    }
  }
  cachedMaxDim = FALLBACK_MAX_DIM
  return cachedMaxDim
}

function injectPhysChunk(png: ArrayBuffer, dpi: number): Blob {
  const ppm = Math.round(dpi / 0.0254)
  const bytes = new Uint8Array(png)

  if (
    bytes[0] !== 0x89 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x4e ||
    bytes[3] !== 0x47
  ) {
    return new Blob([png], { type: 'image/png' })
  }

  let offset = 8
  const view = new DataView(png)

  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset)
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7],
    )
    if (type === 'IHDR') {
      const insertAt = offset + 8 + length + 4
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
  const data = new Uint8Array(9)
  const dv = new DataView(data.buffer)
  dv.setUint32(0, ppm)
  dv.setUint32(4, ppm)
  data[8] = 1

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

function canvasToPngBuffer(canvas: HTMLCanvasElement): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (!b) {
          reject(new Error('Falha ao gerar PNG'))
          return
        }
        void b.arrayBuffer().then(resolve, reject)
      },
      'image/png',
    )
  })
}

function needsTiledRender(widthPx: number, heightPx: number): boolean {
  const maxDim = getMaxCanvasDimension()
  if (widthPx > maxDim || heightPx > maxDim) return true
  if (widthPx * heightPx > SAFE_MAX_AREA) return true
  return false
}

function tryCreateCanvas(width: number, height: number): boolean {
  try {
    const c = document.createElement('canvas')
    c.width = width
    c.height = height
    if (c.width !== width || c.height !== height) return false
    return !!c.getContext('2d', { alpha: true })
  } catch {
    return false
  }
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type)
  const chunk = new Uint8Array(4 + 4 + data.length + 4)
  const view = new DataView(chunk.buffer)
  view.setUint32(0, data.length)
  chunk.set(typeBytes, 4)
  chunk.set(data, 8)
  const crcInput = new Uint8Array(4 + data.length)
  crcInput.set(typeBytes, 0)
  crcInput.set(data, 4)
  view.setUint32(8 + data.length, crc32(crcInput))
  return chunk
}

/**
 * Renderiza um tile (clipX, clipY, tileW, tileH) da folha.
 * Desenha só placements que intersectam o retângulo.
 */
function renderTile(
  sheetW: number,
  clipX: number,
  clipY: number,
  tileW: number,
  tileH: number,
  placements: PackedPlacement[],
): HTMLCanvasElement {
  // Se clipX===0 e tileW===sheetW, reutiliza strip otimizado
  if (clipX === 0 && tileW === sheetW) {
    return renderSheetStrip(sheetW, clipY, tileH, placements)
  }

  const canvas = document.createElement('canvas')
  canvas.width = tileW
  canvas.height = tileH
  const ctx = canvas.getContext('2d', { alpha: true })
  if (!ctx) throw new Error('Canvas 2D indisponível (tile)')
  ctx.clearRect(0, 0, tileW, tileH)

  const clipRight = clipX + tileW
  const clipBottom = clipY + tileH

  for (const p of placements) {
    if (p.x + p.width <= clipX || p.x >= clipRight) continue
    if (p.y + p.height <= clipY || p.y >= clipBottom) continue

    ctx.save()
    const srcW = p.source.width
    const srcH = p.source.height
    if (p.rotated) {
      const exact = srcW === p.height && srcH === p.width
      ctx.imageSmoothingEnabled = !exact
      if (!exact) {
        try {
          ctx.imageSmoothingQuality = 'high'
        } catch {
          /* ok */
        }
      }
      ctx.translate(p.x - clipX + p.width, p.y - clipY)
      ctx.rotate(Math.PI / 2)
      ctx.drawImage(p.source, 0, 0, p.height, p.width)
    } else {
      const exact = srcW === p.width && srcH === p.height
      ctx.imageSmoothingEnabled = !exact
      if (!exact) {
        try {
          ctx.imageSmoothingQuality = 'high'
        } catch {
          /* ok */
        }
      }
      ctx.drawImage(p.source, p.x - clipX, p.y - clipY, p.width, p.height)
    }
    ctx.restore()
  }

  return canvas
}

/**
 * Monta um PNG único via faixas: cada faixa vira um IDAT (PNG permite vários),
 * sem manter a folha inteira em memória.
 */
async function encodePngStreamingStrips(
  width: number,
  height: number,
  placements: PackedPlacement[],
  dpi: number,
): Promise<Blob> {
  const maxDim = getMaxCanvasDimension()
  if (width > maxDim) {
    // Largura maior que o canvas — ZIP de tiles (ainda qualidade nativa)
    throw new Error('WIDTH_EXCEEDS_CANVAS')
  }

  const stripH = Math.max(1, Math.min(STRIP_HEIGHT, maxDim, Math.floor(SAFE_MAX_AREA / Math.max(1, width))))

  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = new Uint8Array(13)
  const ihdrView = new DataView(ihdr.buffer)
  ihdrView.setUint32(0, width)
  ihdrView.setUint32(4, height)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const ppm = Math.round(dpi / 0.0254)
  const physData = new Uint8Array(9)
  const physView = new DataView(physData.buffer)
  physView.setUint32(0, ppm)
  physView.setUint32(4, ppm)
  physData[8] = 1

  const parts: Uint8Array[] = [
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('pHYs', physData),
  ]

  // Adler-32 acumulado do stream zlib (raw filtrado)
  let adlerA = 1
  let adlerB = 0
  const updateAdler = (buf: Uint8Array) => {
    for (let i = 0; i < buf.length; i++) {
      adlerA = (adlerA + buf[i]) % 65521
      adlerB = (adlerB + adlerA) % 65521
    }
  }

  // zlib: um único stream deflate espalhado em vários IDAT.
  // Estratégia simples e robusta: cada faixa = um zlib completo NÃO — PNG exige
  // um único stream zlib concatenado. Então comprimimos cada faixa como blocos
  // deflate "stored" ou usamos CompressionStream por faixa e... isso quebraria
  // o stream.
  //
  // Abordagem correta sem guardar tudo: comprimir o raw inteiro por faixa com
  // deflate Store (sem compressão) emitindo blocos, e um único zlib header no
  // início + adler no fim. Qualidade PNG intacta; arquivo maior, mas OK.

  // Header zlib (CMF/FLG) — método deflate, janela 32k, check bits
  const zlibHeader = new Uint8Array([0x78, 0x01])
  parts.push(pngChunk('IDAT', zlibHeader))

  for (let y = 0; y < height; y += stripH) {
    const h = Math.min(stripH, height - y)
    const stripCanvas = renderTile(width, 0, y, width, h, placements)
    const ctx = stripCanvas.getContext('2d', { alpha: true })
    if (!ctx) throw new Error('Canvas 2D indisponível (faixa)')
    const img = ctx.getImageData(0, 0, width, h)

    // Filtrar linhas (filter None) e emitir como blocos stored do deflate
    const rowSize = 1 + width * 4
    const filtered = new Uint8Array(rowSize * h)
    for (let row = 0; row < h; row++) {
      const destOff = row * rowSize
      filtered[destOff] = 0
      const srcOff = row * width * 4
      filtered.set(img.data.subarray(srcOff, srcOff + width * 4), destOff + 1)
    }
    updateAdler(filtered)

    // Particionar em blocos stored ≤ 65535
    let offset = 0
    while (offset < filtered.length) {
      const end = Math.min(offset + 65535, filtered.length)
      const len = end - offset
      const isLast = y + h >= height && end >= filtered.length
      const block = new Uint8Array(5 + len)
      block[0] = isLast ? 0x01 : 0x00
      block[1] = len & 0xff
      block[2] = (len >>> 8) & 0xff
      block[3] = ~len & 0xff
      block[4] = (~len >>> 8) & 0xff
      block.set(filtered.subarray(offset, end), 5)
      parts.push(pngChunk('IDAT', block))
      offset = end
    }
  }

  // Adler-32 trailer do zlib
  const adlerFooter = new Uint8Array(4)
  new DataView(adlerFooter.buffer).setUint32(0, ((adlerB << 16) | adlerA) >>> 0)
  parts.push(pngChunk('IDAT', adlerFooter))
  parts.push(pngChunk('IEND', new Uint8Array(0)))

  // Concatena
  let total = 0
  for (const p of parts) total += p.length
  const out = new Uint8Array(total)
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return new Blob([out], { type: 'image/png' })
}

/** ZIP de faixas/tiles em qualidade nativa — só se um PNG único for inviável. */
async function renderMultiFileZipFallback(
  widthPx: number,
  heightPx: number,
  placements: PackedPlacement[],
  dpi: number,
): Promise<Blob> {
  const zip = new JSZip()
  const maxDim = getMaxCanvasDimension()
  const tileW = Math.min(widthPx, maxDim)
  const tileH = Math.max(1, Math.min(STRIP_HEIGHT, maxDim, Math.floor(SAFE_MAX_AREA / tileW)))

  let idx = 0
  for (let y = 0; y < heightPx; y += tileH) {
    const h = Math.min(tileH, heightPx - y)
    for (let x = 0; x < widthPx; x += tileW) {
      const w = Math.min(tileW, widthPx - x)
      const tile = renderTile(widthPx, x, y, w, h, placements)
      const buf = await canvasToPngBuffer(tile)
      const blob = injectPhysChunk(buf, dpi)
      const name =
        widthPx <= maxDim
          ? `faixa-${String(++idx).padStart(2, '0')}-y${y}.png`
          : `tile-${String(++idx).padStart(2, '0')}-x${x}-y${y}.png`
      zip.file(name, blob)
    }
  }
  zip.file(
    'LEIA-ME.txt',
    `Folha ${widthPx}×${heightPx} px (~${dpi} DPI) excedeu o limite de canvas do navegador.\n` +
      `As faixas/tiles estão em qualidade nativa (PNG sem perda).\n` +
      `Una-as na ordem (Y crescente; se houver X, da esquerda para a direita) em um editor.\n`,
  )
  return zip.generateAsync({ type: 'blob' })
}

async function renderTiledPng(
  widthPx: number,
  heightPx: number,
  placements: PackedPlacement[],
  dpi: number,
): Promise<Blob> {
  try {
    return await encodePngStreamingStrips(widthPx, heightPx, placements, dpi)
  } catch (e) {
    console.warn('PNG em faixas falhou, usando ZIP de tiles:', e)
    return renderMultiFileZipFallback(widthPx, heightPx, placements, dpi)
  }
}

function isZipBlob(blob: Blob): boolean {
  return (
    blob.type === 'application/zip' ||
    blob.type.includes('zip') ||
    blob.type === 'application/x-zip-compressed'
  )
}

export async function sheetToPngBlob(
  sheet: PackedSheet,
  dpi: number,
  placements?: PackedPlacement[],
): Promise<Blob> {
  const pls = placements ?? sheet.placements
  const { widthPx, heightPx } = sheet

  if (!needsTiledRender(widthPx, heightPx) && tryCreateCanvas(widthPx, heightPx)) {
    try {
      const canvas = renderSheetCanvas(widthPx, heightPx, pls)
      const buf = await canvasToPngBuffer(canvas)
      return injectPhysChunk(buf, dpi)
    } catch {
      /* tiled */
    }
  }

  return renderTiledPng(widthPx, heightPx, pls, dpi)
}

export async function downloadSheetPng(
  sheet: PackedSheet,
  dpi: number,
  filename?: string,
): Promise<void> {
  const blob = await sheetToPngBlob(sheet, dpi)
  const base = filename ?? `folha-${sheet.index + 1}.png`
  // Detecta ZIP pelo magic PK
  let name = base
  const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer())
  if ((head[0] === 0x50 && head[1] === 0x4b) || isZipBlob(blob)) {
    name = base.replace(/\.png$/i, '') + '-faixas.zip'
  }
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
    const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer())
    const nestedZip = head[0] === 0x50 && head[1] === 0x4b
    if (nestedZip) {
      zip.file(
        `folha-${String(sheet.index + 1).padStart(2, '0')}-faixas.zip`,
        blob,
      )
    } else {
      zip.file(`folha-${String(sheet.index + 1).padStart(2, '0')}.png`, blob)
    }
  }
  const content = await zip.generateAsync({ type: 'blob' })
  saveAs(content, zipName)
}
