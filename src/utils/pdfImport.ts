/**
 * Importa PDF (lazy pdfjs-dist): cada página vira um canvas com fundo transparente.
 * Não pinta branco — PDFs com fundo branco próprio continuam brancos (trim só remove alpha).
 */

/** DPI padrão de rasterização das páginas. */
export const PDF_IMPORT_DPI = 300
/** Lado máximo do canvas da página (px) — evita OOM. */
export const PDF_MAX_SIDE_PX = 8000
/** Área máxima (px²) do canvas da página. */
export const PDF_MAX_AREA_PX = 64_000_000

export function isPdfFile(f: File): boolean {
  return f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
}

export interface PdfPageCanvas {
  name: string
  canvas: HTMLCanvasElement
  width: number
  height: number
  dpi: number
  /** true quando o DPI foi reduzido pelo limite de canvas */
  capped: boolean
}

type PdfjsModule = typeof import('pdfjs-dist')
let pdfjsPromise: Promise<PdfjsModule> | null = null

async function loadPdfjs(): Promise<PdfjsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const [lib, worker] = await Promise.all([
        import('pdfjs-dist'),
        // ?url → asset com hash, resolvido relativo ao base './' (GitHub Pages ok)
        import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
      ])
      lib.GlobalWorkerOptions.workerSrc = worker.default
      return lib
    })().catch((e) => {
      pdfjsPromise = null
      throw e
    })
  }
  return pdfjsPromise
}

export async function loadPdfAsCanvases(
  file: File,
  dpi = PDF_IMPORT_DPI,
  onPage?: (page: number, total: number) => void,
): Promise<{ pages: PdfPageCanvas[]; failures: string[] }> {
  if (!file || file.size === 0) throw new Error('arquivo vazio')
  let pdfjs: PdfjsModule
  try {
    pdfjs = await loadPdfjs()
  } catch {
    throw new Error('não foi possível carregar o leitor de PDF')
  }
  const data = new Uint8Array(await file.arrayBuffer())
  const task = pdfjs.getDocument({ data })
  let doc
  try {
    doc = await task.promise
  } catch (e) {
    const name = (e as { name?: string })?.name
    if (name === 'PasswordException') throw new Error('PDF protegido por senha')
    throw new Error('PDF inválido ou corrompido')
  }
  const pages: PdfPageCanvas[] = []
  const failures: string[] = []
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      onPage?.(n, doc.numPages)
      const label = `${file.name} p${n}`
      try {
        const page = await doc.getPage(n)
        const base = page.getViewport({ scale: 1 }) // 72 pt/in
        let scale = dpi / 72
        const w0 = base.width * scale
        const h0 = base.height * scale
        const k = Math.min(
          1,
          PDF_MAX_SIDE_PX / Math.max(w0, h0),
          Math.sqrt(PDF_MAX_AREA_PX / Math.max(1, w0 * h0)),
        )
        scale *= k
        const vp = page.getViewport({ scale })
        const w = Math.max(1, Math.floor(vp.width))
        const h = Math.max(1, Math.floor(vp.height))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        if (canvas.width !== w || canvas.height !== h) {
          throw new Error(`canvas ${w}×${h} px rejeitado (memória)`)
        }
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('canvas 2D indisponível')
        ctx.clearRect(0, 0, w, h)
        await page.render({
          canvas,
          canvasContext: ctx,
          viewport: vp,
          background: 'rgba(0,0,0,0)',
        }).promise
        page.cleanup()
        pages.push({
          name: label,
          canvas,
          width: w,
          height: h,
          dpi: Math.round(scale * 72),
          capped: k < 1,
        })
      } catch (e) {
        failures.push(`${label}: ${e instanceof Error ? e.message : 'falha ao renderizar página'}`)
      }
    }
  } finally {
    void task.destroy()
  }
  return { pages, failures }
}
