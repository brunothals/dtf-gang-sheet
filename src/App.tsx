import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { saveAs } from 'file-saver'
import {
  DEFAULT_CONFIG,
  MAX_AUTO_HEIGHT_CM,
  type ArtItem,
  type PackedSheet,
  type PackMode,
  type SheetConfig,
} from './types'
import {
  applyTrim,
  IMPORT_WARN_MAX_SIDE_PX,
  loadPngAsCanvas,
  makeThumbnailDataUrl,
} from './utils/trim'
import { buildPreviewUrl, getArtPrintSize, packArts, scalePackedSheet } from './utils/pack'
import {
  fillLeftoverQuantities,
  maxEqualQtyOnOneSheet,
  maxQtyOneArtOnOneSheet,
} from './utils/fillSheet'
import {
  buildSheetFilename,
  buildZipFilename,
  downloadAllSheetsZip,
  downloadSheetPng,
} from './utils/exportPng'
import { isPdfFile, loadPdfAsCanvases, PDF_IMPORT_DPI } from './utils/pdfImport'
import { cmToPx, computeNativeExportDpi, resolveExportDpi, roundPx } from './utils/units'
import './App.css'

/** DPI máximo para packing/preview ao vivo (export reempacota no DPI escolhido). */
const PREVIEW_DPI_CAP = 150
/** Presets de qualidade do PNG exportado (preview permanece ≤ PREVIEW_DPI_CAP). */
const EXPORT_DPI_HIGH = 300
const EXPORT_DPI_FAST = 150
/** Debounce do packing ao vivo (ms). */
const PACK_DEBOUNCE_MS = 320
/** Quantas folhas geram previewUrl de uma vez (resto sob demanda). */
const MAX_LIVE_PREVIEW_SHEETS = 6

const LENGTH_OPTIONS: [string, string][] = [
  ['21', '21 cm'],
  ['42', '42 cm'],
  ['50', '50 cm'],
  ['100', '100 cm'],
  ['auto', 'Completar'],
  ['custom', 'Personalizado'],
]

/** Espaço guardado em mm, exibido em cm (0,3 cm = 3 mm). */
function mmToCmField(mm: number): number {
  return Math.round((mm / 10) * 100) / 100
}
function cmFieldToMm(v: string): number {
  const n = Number(String(v).replace(',', '.'))
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1000) / 100 : 0
}

type ExportQualityPreset = 'native' | 'high' | 'fast' | 'custom'

function getExportQuality(config: SheetConfig): ExportQualityPreset {
  if (config.useNativeDpi !== false) return 'native'
  if (config.dpi === EXPORT_DPI_HIGH) return 'high'
  if (config.dpi === EXPORT_DPI_FAST) return 'fast'
  return 'custom'
}

function applyExportQuality(
  config: SheetConfig,
  quality: ExportQualityPreset,
  nativeDpiFallback: number,
): SheetConfig {
  switch (quality) {
    case 'native':
      return { ...config, useNativeDpi: true }
    case 'high':
      return { ...config, useNativeDpi: false, dpi: EXPORT_DPI_HIGH }
    case 'fast':
      return { ...config, useNativeDpi: false, dpi: EXPORT_DPI_FAST }
    case 'custom':
      return {
        ...config,
        useNativeDpi: false,
        dpi:
          config.useNativeDpi !== false
            ? Math.max(72, Math.round(nativeDpiFallback) || EXPORT_DPI_HIGH)
            : config.dpi,
      }
  }
}

function exportQualityLabel(quality: ExportQualityPreset, dpi: number): string {
  switch (quality) {
    case 'native':
      return `Máxima (nativo ~${dpi})`
    case 'high':
      return 'Alta (300 DPI)'
    case 'fast':
      return 'Rápida (150 DPI)'
    case 'custom':
      return `Personalizado (${dpi} DPI)`
  }
}

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function buildArtItem(
  id: string,
  name: string,
  originalCanvas: HTMLCanvasElement,
  originalWidthPx: number,
  originalHeightPx: number,
  trimEnabled: boolean,
  alphaThreshold: number,
  quantity = 1,
  maxSideCmOverride: number | null = null,
  rotate90 = false,
): ArtItem {
  const trimmed = applyTrim(originalCanvas, trimEnabled, alphaThreshold)
  return {
    id,
    name,
    originalCanvas,
    originalWidthPx,
    originalHeightPx,
    trimmedCanvas: trimmed.canvas,
    trimmedWidthPx: trimmed.width,
    trimmedHeightPx: trimmed.height,
    // Thumbnail pequeno — nunca toDataURL da arte em resolução plena (OOM)
    thumbnailUrl: makeThumbnailDataUrl(trimmed.canvas, trimmed.width, trimmed.height),
    quantity,
    maxSideCmOverride,
    rotate90,
  }
}

function artDupKey(name: string, size: number): string {
  return `${name.toLowerCase()}::${size}`
}

function LazySheetPreview({
  sheet,
  alt,
}: {
  sheet: PackedSheet
  alt: string
}) {
  const [url, setUrl] = useState(sheet.previewUrl)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setUrl(sheet.previewUrl)
    setFailed(false)
  }, [sheet.previewUrl, sheet.index, sheet.widthPx, sheet.heightPx])

  useEffect(() => {
    if (url || failed) return
    let cancelled = false
    // Gera preview sob demanda (fora do packing em lote)
    const t = window.setTimeout(() => {
      try {
        const next = buildPreviewUrl(sheet.widthPx, sheet.heightPx, sheet.placements)
        if (!cancelled) {
          if (next) setUrl(next)
          else setFailed(true)
        }
      } catch {
        if (!cancelled) setFailed(true)
      }
    }, 50)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [url, failed, sheet])

  if (url) {
    return <img src={url} alt={alt} />
  }
  if (failed) {
    return (
      <p className="empty">Preview indisponível (folha muito grande ou falta de memória)</p>
    )
  }
  return <p className="empty">Gerando preview…</p>
}

export default function App() {

  const [config, setConfig] = useState<SheetConfig>({ ...DEFAULT_CONFIG })
  /** Comprimento: '21'|'42'|'50'|'100'|'auto' (completar)|'custom' */
  const [lengthChoice, setLengthChoice] = useState<string>('42')
  const [arts, setArts] = useState<ArtItem[]>([])
  const [sheets, setSheets] = useState<PackedSheet[]>([])
  const [packErrors, setPackErrors] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const [exporting, setExporting] = useState(false)
  /** Checkbox por arte (default marcado ao importar) — usado em Dividir iguais */
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({})
  /** Prefixo opcional nos arquivos exportados */
  const [clientName, setClientName] = useState('')
  /** Pular PNGs com mesmo nome+tamanho já na lista */
  const skipDuplicateNames = false
  /** Erro fatal de packing/preview (canvas OOM etc.) */
  const [packFatalError, setPackFatalError] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  /** artId → chave nome::tamanho para skip de duplicatas */
  const artDupKeyByIdRef = useRef<Map<string, string>>(new Map())

  // Evita re-trim na montagem inicial / só reprocessa quando trim ou limiar mudam
  const trimKeyRef = useRef(`${config.trimEnabled}:${config.alphaThreshold}`)

  useEffect(() => {
    const el = folderInputRef.current
    if (el) {
      el.setAttribute('webkitdirectory', '')
      el.setAttribute('directory', '')
    }
  }, [])

  // Novas artes entram selecionadas; remove ids órfãos
  useEffect(() => {
    setSelectedIds((prev) => {
      const next = { ...prev }
      let changed = false
      const live = new Set(arts.map((a) => a.id))
      for (const a of arts) {
        if (!(a.id in next)) {
          next[a.id] = true
          changed = true
        }
      }
      for (const id of Object.keys(next)) {
        if (!live.has(id)) {
          delete next[id]
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [arts])

  const updateConfig = useCallback(<K extends keyof SheetConfig>(key: K, value: SheetConfig[K]) => {
    setConfig((c) => ({ ...c, [key]: value }))
  }, [])

  /** Comprimento da folha: preset fixo, completar (sob medida) ou personalizado. */
  const onLengthChange = (v: string) => {
    setLengthChoice(v)
    if (v === 'auto') {
      setGrowMode('auto_height')
      return
    }
    setConfig((c) => ({
      ...c,
      sheetGrowMode: 'fixed',
      heightCm: v === 'custom' ? c.heightCm : Number(v),
    }))
  }

  // Reprocessar corte sem reimportar quando trim ou sensibilidade mudam
  useEffect(() => {
    const key = `${config.trimEnabled}:${config.alphaThreshold}`
    if (key === trimKeyRef.current) return
    trimKeyRef.current = key

    setArts((prev) => {
      if (prev.length === 0) return prev
      return prev.map((art) =>
        buildArtItem(
          art.id,
          art.name,
          art.originalCanvas,
          art.originalWidthPx,
          art.originalHeightPx,
          config.trimEnabled,
          config.alphaThreshold,
          art.quantity,
          art.maxSideCmOverride,
          art.rotate90,
        ),
      )
    })
  }, [config.trimEnabled, config.alphaThreshold])

  const importFiles = async (fileList: FileList | File[]) => {
    const all = Array.from(fileList)
    const files = all.filter(
      (f) =>
        f.size > 0 &&
        (f.type === 'image/png' || f.name.toLowerCase().endsWith('.png') || isPdfFile(f)),
    )
    const skippedNonPng = all.length - files.length
    if (files.length === 0) {
      setStatus(
        skippedNonPng > 0
          ? `Nenhum PNG/PDF válido (ignorados ${skippedNonPng} outros/vazios).`
          : 'Nenhum PNG ou PDF encontrado.',
      )
      if (fileInputRef.current) fileInputRef.current.value = ''
      if (folderInputRef.current) folderInputRef.current.value = ''
      return
    }
    setLoading(true)
    setStatus(`Processando ${files.length} arquivo(s)…`)
    const next: ArtItem[] = []
    const failures: string[] = []
    const largeWarns: string[] = []
    let anyCropped = false
    let skippedDup = 0
    let pdfPages = 0
    let pdfCapped = 0

    // Chaves já existentes + do lote atual
    const seen = new Set<string>()
    if (skipDuplicateNames) {
      for (const k of artDupKeyByIdRef.current.values()) seen.add(k)
    }

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      setStatus(`Processando ${i + 1}/${files.length}: ${file.name}`)
      const key = artDupKey(file.name, file.size)
      if (skipDuplicateNames && seen.has(key)) {
        skippedDup++
        continue
      }
      if (isPdfFile(file)) {
        try {
          const { pages, failures: pf } = await loadPdfAsCanvases(
            file,
            PDF_IMPORT_DPI,
            (pg, total) =>
              setStatus(`Processando ${i + 1}/${files.length}: ${file.name} (página ${pg}/${total})`),
          )
          failures.push(...pf)
          if (pages.length === 0 && pf.length === 0) {
            failures.push(`${file.name}: PDF sem páginas`)
          }
          for (const pg of pages) {
            const id = uid()
            const art = buildArtItem(
              id,
              pg.name,
              pg.canvas,
              pg.width,
              pg.height,
              config.trimEnabled,
              config.alphaThreshold,
            )
            if (
              config.trimEnabled &&
              (art.trimmedWidthPx !== art.originalWidthPx ||
                art.trimmedHeightPx !== art.originalHeightPx)
            ) {
              anyCropped = true
            }
            if (pg.capped) pdfCapped++
            pdfPages++
            next.push(art)
            artDupKeyByIdRef.current.set(id, `${key}::p${pg.name}`)
          }
          if (pages.length > 0) seen.add(key)
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          failures.push(`${file.name}: ${msg}`)
          console.warn('Falha ao importar PDF', file.name, e)
        }
        continue
      }
      try {
        const loaded = await loadPngAsCanvas(file)
        if (loaded.warnLarge) {
          largeWarns.push(
            `${loaded.name} (${loaded.width}×${loaded.height} px > ${IMPORT_WARN_MAX_SIDE_PX})`,
          )
        }
        const id = uid()
        const art = buildArtItem(
          id,
          loaded.name,
          loaded.canvas,
          loaded.width,
          loaded.height,
          config.trimEnabled,
          config.alphaThreshold,
        )
        if (
          config.trimEnabled &&
          (art.trimmedWidthPx !== art.originalWidthPx ||
            art.trimmedHeightPx !== art.originalHeightPx)
        ) {
          anyCropped = true
        }
        next.push(art)
        seen.add(key)
        artDupKeyByIdRef.current.set(id, key)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        failures.push(`${file.name}: ${msg}`)
        console.warn('Falha ao importar', file.name, e)
      }
    }

    if (next.length > 0) {
      setArts((prev) => [...prev, ...next])
      trimKeyRef.current = `${config.trimEnabled}:${config.alphaThreshold}`
    }

    const parts: string[] = []
    parts.push(`${next.length} ok`)
    if (failures.length > 0) {
      const detail = failures.slice(0, 3).join('; ')
      const more = failures.length > 3 ? ` (+${failures.length - 3})` : ''
      parts.push(`${failures.length} falharam: ${detail}${more}`)
    }
    if (skippedDup > 0) parts.push(`${skippedDup} duplicata(s) ignorada(s)`)
    if (skippedNonPng > 0) parts.push(`${skippedNonPng} não-PNG/PDF/vazio(s)`)
    if (pdfPages > 0) {
      parts.push(
        `${pdfPages} página(s) de PDF a ${PDF_IMPORT_DPI} DPI (fundo branco do PDF não é removido pelo corte)`,
      )
    }
    if (pdfCapped > 0) parts.push(`${pdfCapped} página(s) reduzida(s) pelo limite de memória`)
    if (anyCropped) parts.push('bordas transparentes cortadas')
    if (largeWarns.length > 0) {
      parts.push(
        `aviso: ${largeWarns.length} arte(s) > ${IMPORT_WARN_MAX_SIDE_PX}px (qualidade de export mantida)`,
      )
    }
    setStatus(parts.join(' · '))
    setLoading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (folderInputRef.current) folderInputRef.current.value = ''
  }

  const removeArt = (id: string) => {
    artDupKeyByIdRef.current.delete(id)
    setArts((prev) => prev.filter((a) => a.id !== id))
  }

  const clearArts = () => {
    setArts([])
    setSelectedIds({})
    setSheets([])
    setPackErrors([])
    setPackFatalError(null)
    setStatus('')
    artDupKeyByIdRef.current.clear()
  }

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const selectAllArts = () => {
    setSelectedIds(Object.fromEntries(arts.map((a) => [a.id, true])))
  }

  const clearSelection = () => {
    setSelectedIds(Object.fromEntries(arts.map((a) => [a.id, false])))
  }

  const handleEncherFolha = (id: string) => {
    const art = arts.find((a) => a.id === id)
    if (!art) return
    const dpi = resolveExportDpi(arts, config)
    const q = maxQtyOneArtOnOneSheet(art, { ...config, dpi })
    setArts((prev) => prev.map((a) => (a.id === id ? { ...a, quantity: q } : a)))
    setStatus(
      q > 0
        ? `Encher folha: "${art.name}" → ${q} peça(s) em 1 folha.`
        : `Encher folha: "${art.name}" não cabe na folha com o tamanho atual.`,
    )
  }

  const handleDividirIguais = () => {
    const selected = arts.filter((a) => selectedIds[a.id])
    const dpi = resolveExportDpi(arts, config)
    const cfg = { ...config, dpi }
    const fitting = selected.filter((a) => !getArtPrintSize(a, cfg).error)
    if (fitting.length === 0) {
      setStatus('Dividir iguais: selecione ao menos uma arte que caiba na folha.')
      return
    }
    const q = maxEqualQtyOnOneSheet(fitting, cfg)
    const ids = new Set(fitting.map((a) => a.id))
    setArts((prev) => prev.map((a) => (ids.has(a.id) ? { ...a, quantity: q } : a)))
    if (fitting.length === 1) {
      setStatus(
        q > 0
          ? `Dividir iguais: 1 arte → ${q} peça(s) (mesmo que Encher folha).`
          : 'Dividir iguais: a arte selecionada não cabe na folha.',
      )
    } else {
      setStatus(
        q > 0
          ? `Dividir iguais: ${fitting.length} artes → ${q} cada (1 folha).`
          : 'Dividir iguais: não cabe 1 de cada na mesma folha — reduza o tamanho ou a seleção.',
      )
    }
  }

  const handlePreencherSobras = () => {
    const dpi = resolveExportDpi(arts, config)
    const cfg = { ...config, dpi }
    const hasOrdered = arts.some(
      (a) => a.quantity >= 1 && !getArtPrintSize(a, cfg).error,
    )
    if (!hasOrdered) {
      setStatus('Sobras: defina primeiro as quantidades do pedido (≥ 1).')
      return
    }
    const result = fillLeftoverQuantities(arts, cfg)
    setArts(result.arts)
    if (result.sheetsBefore === 0) {
      setStatus('Sobras: nenhuma folha gerada ainda.')
    } else if (result.added === 0) {
      setStatus(`Sobras: sem espaço extra (folha ainda ${result.sheetsBefore}).`)
    } else {
      setStatus(
        `Sobras: +${result.added} peças (folha ainda ${result.sheetsAfter}).`,
      )
    }
  }

  const setQty = (id: string, qty: number) => {
    setArts((prev) =>
      prev.map((a) =>
        a.id === id ? { ...a, quantity: Math.max(0, Math.floor(qty) || 0) } : a,
      ),
    )
  }

  const setArtMaxSide = (id: string, value: string) => {
    setArts((prev) =>
      prev.map((a) => {
        if (a.id !== id) return a
        if (value === '' || value == null) {
          return { ...a, maxSideCmOverride: null }
        }
        const n = parseFloat(value)
        return {
          ...a,
          maxSideCmOverride: Number.isFinite(n) && n > 0 ? n : null,
        }
      }),
    )
  }

  const toggleRotate90 = (id: string) => {
    setArts((prev) =>
      prev.map((a) => (a.id === id ? { ...a, rotate90: !a.rotate90 } : a)),
    )
  }

  const handleRotateSelected = () => {
    const ids = new Set(arts.filter((a) => selectedIds[a.id]).map((a) => a.id))
    if (ids.size === 0) {
      setStatus('Girar 90°: marque ao menos uma arte.')
      return
    }
    setArts((prev) =>
      prev.map((a) => (ids.has(a.id) ? { ...a, rotate90: !a.rotate90 } : a)),
    )
    setStatus(`Girar 90°: ${ids.size} arte(s) alternada(s).`)
  }

  const downloadArtPng = (art: ArtItem) => {
    art.trimmedCanvas.toBlob((blob) => {
      if (!blob) return
      const base = art.name.replace(/\.png$/i, '')
      const suffix = config.trimEnabled ? '-cortada' : ''
      saveAs(blob, `${base}${suffix}.png`)
    }, 'image/png')
  }

  /** DPI efetivo do export: nativo das PNGs (padrão) ou forçado pelo preset. */
  const effectiveDpi = useMemo(
    () => resolveExportDpi(arts, config),
    [arts, config],
  )

  const nativeDpi = useMemo(
    () => computeNativeExportDpi(arts, config),
    [arts, config],
  )

  const exportQuality = useMemo(() => getExportQuality(config), [config])

  const setExportQuality = useCallback(
    (quality: ExportQualityPreset) => {
      setConfig((c) => applyExportQuality(c, quality, computeNativeExportDpi(arts, c)))
    },
    [arts],
  )

  /** Config de export — dpi nativo ou preset (nunca o DPI do preview). */
  const exportPackConfig = useMemo(
    () => ({ ...config, dpi: effectiveDpi }),
    [config, effectiveDpi],
  )

  /** DPI baixo só para packing + preview ao vivo (evita OOM ~780 DPI). */
  const previewDpi = useMemo(
    () => Math.min(effectiveDpi, PREVIEW_DPI_CAP),
    [effectiveDpi],
  )

  /** Estimativa de px do PNG exportado (largura × altura da folha no DPI escolhido). */
  const exportSizeEstimate = useMemo(() => {
    const w = roundPx(cmToPx(config.widthCm, effectiveDpi))
    const hCm =
      config.sheetGrowMode === 'auto_height' && sheets[0]?.usedHeightCm
        ? sheets[0].usedHeightCm
        : config.heightCm
    const h = roundPx(cmToPx(hCm, effectiveDpi))
    return { w, h }
  }, [config.widthCm, config.heightCm, config.sheetGrowMode, effectiveDpi, sheets])

  const previewPackConfig = useMemo(
    () => ({ ...config, dpi: previewDpi }),
    [config, previewDpi],
  )

  /** packConfig = preview (lista de tamanhos W×H cm usa as mesmas medidas em cm). */
  const packConfig = previewPackConfig

  const artRows = useMemo(() => {
    return arts.map((art) => {
      const ps = getArtPrintSize(art, packConfig)
      return { art, ps }
    })
  }, [arts, packConfig])

  // Empacotar com debounce + DPI de preview (export reempacota no DPI nativo)
  useEffect(() => {
    if (arts.length === 0) {
      setSheets([])
      setPackErrors([])
      setPackFatalError(null)
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      try {
        const { sheets: packed, errors } = packArts(arts, previewPackConfig, {
          maxPreviewSheets: MAX_LIVE_PREVIEW_SHEETS,
        })
        if (cancelled) return
        setSheets(packed)
        setPackErrors(errors)
        setPackFatalError(null)
      } catch (e) {
        if (cancelled) return
        console.error(e)
        setSheets([])
        setPackErrors([])
        setPackFatalError(
          e instanceof Error
            ? e.message
            : 'Falha ao montar a folha (possível falta de memória). Reduza artes ou use DPI forçado menor.',
        )
      }
    }, PACK_DEBOUNCE_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [arts, previewPackConfig])

  const exportOpts = useMemo(
    () => ({
      cropEmpty: !!config.cropEmptyExport,
      marginMm: config.marginMm,
    }),
    [config.cropEmptyExport, config.marginMm],
  )

  /**
   * Reempacota no DPI de export escolhido (preview fica em ≤150 DPI).
   * Se o re-pack falhar (memória), escala o layout do preview → DPI de export
   * mantendo as artes em resolução plena (nunca exporta a folha de preview crua).
   */
  const packForExport = (): PackedSheet[] => {
    const expectedW = roundPx(cmToPx(config.widthCm, effectiveDpi))
    const looksExportDpi = (w: number) => w >= expectedW * 0.55

    try {
      const { sheets: packed, errors } = packArts(arts, exportPackConfig, {
        skipPreview: true,
      })
      if (packed.length > 0) {
        if (!looksExportDpi(packed[0].widthPx)) {
          throw new Error(
            `Resolução de export suspeita (${packed[0].widthPx}px; esperado ~${expectedW}px a ${effectiveDpi} DPI).`,
          )
        }
        return packed
      }
      if (errors.length > 0) {
        throw new Error(errors[0] ?? 'Nada para exportar.')
      }
    } catch (e) {
      console.warn('Reempacote no DPI de export falhou; escalando layout do preview.', e)
    }

    if (sheets.length === 0) {
      throw new Error('Nada para exportar. Importe artes e aguarde a pré-visualização.')
    }
    const scaled = sheets.map((s) => scalePackedSheet(s, previewDpi, effectiveDpi))
    if (!looksExportDpi(scaled[0].widthPx)) {
      throw new Error(
        `Falha ao gerar folha em ~${effectiveDpi} DPI. Tente “Recortar espaços vazios” ou qualidade Rápida/Alta.`,
      )
    }
    return scaled
  }

  const handleExportOne = async (sheet: PackedSheet) => {
    setExporting(true)
    const qLabel = exportQualityLabel(exportQuality, effectiveDpi)
    setStatus(`Exportando folha ${sheet.index + 1} · ${qLabel}…`)
    try {
      const exportSheets = packForExport()
      const target =
        exportSheets.find((s) => s.index === sheet.index) ?? exportSheets[sheet.index]
      if (!target) throw new Error('Folha não encontrada após reempacotar para export.')
      const filename = buildSheetFilename(target, exportSheets.length, clientName)
      await downloadSheetPng(target, effectiveDpi, filename, exportOpts)
      setStatus(
        `Folha ${sheet.index + 1} exportada: ${target.widthPx}×${target.heightPx} px · ${effectiveDpi} DPI (${qLabel}).`,
      )
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Erro ao exportar PNG.')
    } finally {
      setExporting(false)
    }
  }

  const handleExportAll = async () => {
    if (sheets.length === 0) return
    setExporting(true)
    const qLabel = exportQualityLabel(exportQuality, effectiveDpi)
    setStatus(`Exportando · ${qLabel} (reempacotando no DPI escolhido)…`)
    try {
      const exportSheets = packForExport()
      if (exportSheets.length === 0) {
        throw new Error('Nenhuma folha para exportar.')
      }
      if (exportSheets.length === 1) {
        const filename = buildSheetFilename(exportSheets[0], 1, clientName)
        await downloadSheetPng(exportSheets[0], effectiveDpi, filename, exportOpts)
      } else {
        await downloadAllSheetsZip(
          exportSheets,
          effectiveDpi,
          buildZipFilename(clientName),
          exportOpts,
          clientName,
        )
      }
      const sample = exportSheets[0]
      setStatus(
        `Exportação concluída: ${sample.widthPx}×${sample.heightPx} px · ${effectiveDpi} DPI (${qLabel}) · ${exportSheets.length} folha(s).`,
      )
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Erro ao exportar.')
    } finally {
      setExporting(false)
    }
  }

  const setGrowMode = (mode: SheetConfig['sheetGrowMode']) => {
    setConfig((c) => ({
      ...c,
      sheetGrowMode: mode,
      // Recorte ligado por padrão ao entrar em sob medida
      cropEmptyExport: mode === 'auto_height' ? true : c.cropEmptyExport,
      // Grade combina bem com rolo sob medida
      packMode: mode === 'auto_height' && c.packMode === 'maxrects' ? 'grade' : c.packMode,
    }))
  }

  const isAutoHeight = config.sheetGrowMode === 'auto_height'
  const usedReadout = sheets[0]?.usedHeightCm
  const utilReadout = sheets[0]?.utilizationPct

  const statusClass =
    loading || exporting
      ? 'status-banner is-busy'
      : status
        ? 'status-banner is-ok'
        : ''

  return (
    <div className="app folha-app">
      <header className="folha-page-header">
        <div>
          <p className="section-kicker">Folha · Gang Sheet</p>
          <h1>Montagem de folhas</h1>
        </div>
      </header>

      {/* Barra superior — ações frequentes */}
      <div className="folha-toolbar">
        <label className="folha-tb-field">
          <span>Cliente</span>
          <input
            type="text"
            value={clientName}
            placeholder="Nome (opcional)"
            onChange={(e) => setClientName(e.target.value)}
            maxLength={80}
          />
        </label>

        <div className="folha-tb-group">
          <button
            type="button"
            className="btn primary sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={loading}
          >
            Importar PNG/PDF
          </button>
          <button
            type="button"
            className="btn secondary sm"
            onClick={() => folderInputRef.current?.click()}
            disabled={loading}
          >
            Pasta
          </button>
          {arts.length > 0 && (
            <button type="button" className="btn danger sm" onClick={clearArts}>
              Limpar
            </button>
          )}
        </div>

        <label className="folha-tb-check" title="Cortar bordas transparentes">
          <input
            type="checkbox"
            checked={config.trimEnabled}
            onChange={(e) => updateConfig('trimEnabled', e.target.checked)}
          />
          Corte
        </label>

        <label className="folha-tb-check" title="Recortar espaços vazios no export">
          <input
            type="checkbox"
            checked={config.cropEmptyExport}
            onChange={(e) => updateConfig('cropEmptyExport', e.target.checked)}
          />
          Recorte export
        </label>

        <select
          className="folha-tb-select"
          value={config.packMode}
          onChange={(e) =>
            updateConfig('packMode', e.target.value as PackMode)
          }
          title="Modo de montagem"
          aria-label="Modo de montagem"
        >
          <option value="maxrects">Aproveitar espaço</option>
          <option value="grade">Grade</option>
          <option value="group_rows">Agrupar fileiras</option>
          <option value="group_cols">Agrupar colunas</option>
        </select>

        <select
          className="folha-tb-select"
          value={config.widthCm === 41 ? '41' : '29'}
          onChange={(e) => updateConfig('widthCm', Number(e.target.value))}
          title="Largura da folha"
          aria-label="Largura da folha"
        >
          <option value="29">29 cm</option>
          <option value="41">41 cm</option>
        </select>
        <select
          className="folha-tb-select"
          value={lengthChoice}
          onChange={(e) => onLengthChange(e.target.value)}
          title="Comprimento da folha"
          aria-label="Comprimento da folha"
        >
          {LENGTH_OPTIONS.map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>

        <label className="folha-tb-field folha-tb-export-quality">
          <span>Qualidade export</span>
          <select
            className="folha-tb-select"
            value={exportQuality}
            onChange={(e) =>
              setExportQuality(e.target.value as ExportQualityPreset)
            }
            title="DPI do PNG exportado (preview continua limitado)"
            aria-label="Qualidade do export"
          >
            <option value="native">Máxima (nativo ~{nativeDpi})</option>
            <option value="high">Alta (300 DPI)</option>
            <option value="fast">Rápida (150 DPI)</option>
            <option value="custom">Personalizado…</option>
          </select>
        </label>

        <span
          className="folha-tb-dpi"
          title="Tamanho aproximado do PNG no DPI de export escolhido"
        >
          ~{exportSizeEstimate.w}×{exportSizeEstimate.h} px · {effectiveDpi} DPI
        </span>

        <div className="folha-tb-group folha-tb-export">
          <button
            type="button"
            className="btn secondary sm"
            disabled={arts.length === 0}
            onClick={handlePreencherSobras}
            title="Adiciona cópias extras só no espaço vazio"
          >
            Preencher sobras
          </button>
          {sheets.length > 0 && (
            <button
              type="button"
              className="btn primary sm"
              disabled={exporting}
              onClick={handleExportAll}
            >
              {sheets.length === 1 ? 'Baixar PNG' : 'Baixar ZIP'}
            </button>
          )}
        </div>

        {(status || loading || exporting) && (
          <p className={`folha-tb-status ${statusClass || ''}`}>
            {loading && !status ? 'Aguarde…' : status}
          </p>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,.png,application/pdf,.pdf"
          multiple
          hidden
          onChange={(e) => e.target.files && void importFiles(e.target.files)}
        />
        <input
          ref={folderInputRef}
          type="file"
          accept="image/png,.png,application/pdf,.pdf"
          multiple
          hidden
          onChange={(e) => e.target.files && void importFiles(e.target.files)}
        />
      </div>

      <main className="folha-layout">
        {/* ESQUERDA — opções da folha */}
        <aside className="folha-options">
          <section className="card folha-card">
            <div className="folha-card-head">
              <p className="section-kicker">Opções</p>
              <h2>Folha</h2>
            </div>

            <div className="grid-2">
              <label className="field">
                <span>Largura</span>
                <select
                  value={config.widthCm === 41 ? '41' : '29'}
                  onChange={(e) => updateConfig('widthCm', Number(e.target.value))}
                >
                  <option value="29">29 cm</option>
                  <option value="41">41 cm</option>
                </select>
              </label>
              <label className="field">
                <span>Comprimento</span>
                <select value={lengthChoice} onChange={(e) => onLengthChange(e.target.value)}>
                  {LENGTH_OPTIONS.map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </label>
            </div>

            {lengthChoice === 'custom' && (
              <label className="field">
                <span>Compr. (cm)</span>
                <input
                  type="number"
                  min={1}
                  step={0.1}
                  value={config.heightCm}
                  onChange={(e) => updateConfig('heightCm', Number(e.target.value) || 1)}
                />
              </label>
            )}
            {isAutoHeight && (
              <div className="dpi-readout">Completar: cresce até {MAX_AUTO_HEIGHT_CM} cm</div>
            )}

            <div className="grid-2">
              {config.packMode === 'maxrects' ? (
                <label className="field">
                  <span>Espaço (cm)</span>
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={mmToCmField(config.gapMm)}
                    onChange={(e) => updateConfig('gapMm', cmFieldToMm(e.target.value))}
                  />
                </label>
              ) : (
                <label className="field">
                  <span>Lado (cm)</span>
                  <input
                    type="number"
                    min={0.1}
                    step={0.1}
                    value={config.maxSideCm}
                    onChange={(e) => updateConfig('maxSideCm', Number(e.target.value) || 5)}
                  />
                </label>
              )}
            </div>

            {(config.packMode === 'grade' ||
              config.packMode === 'group_rows' ||
              config.packMode === 'group_cols') && (
              <div className="grid-2">
                <label className="field">
                  <span>Espaço H (cm)</span>
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={mmToCmField(config.gapXMm)}
                    onChange={(e) => updateConfig('gapXMm', cmFieldToMm(e.target.value))}
                  />
                </label>
                <label className="field">
                  <span>Espaço V (cm)</span>
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={mmToCmField(config.gapYMm)}
                    onChange={(e) => updateConfig('gapYMm', cmFieldToMm(e.target.value))}
                  />
                </label>
              </div>
            )}

            {config.packMode === 'maxrects' && (
              <label className="field">
                <span>Lado (cm)</span>
                <input
                  type="number"
                  min={0.1}
                  step={0.1}
                  value={config.maxSideCm}
                  onChange={(e) => updateConfig('maxSideCm', Number(e.target.value) || 5)}
                />
              </label>
            )}

            <label className="field">
              <span>Qualidade do export</span>
              <select
                value={exportQuality}
                onChange={(e) =>
                  setExportQuality(e.target.value as ExportQualityPreset)
                }
              >
                <option value="native">Máxima (nativo ~{nativeDpi})</option>
                <option value="high">Alta (300 DPI)</option>
                <option value="fast">Rápida (150 DPI)</option>
                <option value="custom">Personalizado</option>
              </select>
            </label>

            {exportQuality !== 'native' && (
              <label className="field">
                <span>DPI do export</span>
                <input
                  type="number"
                  min={72}
                  max={2400}
                  step={1}
                  value={config.dpi}
                  onChange={(e) => {
                    const dpi = Number(e.target.value) || 300
                    setConfig((c) => ({ ...c, useNativeDpi: false, dpi }))
                  }}
                />
              </label>
            )}

            <p className="hint folha-export-dpi-hint">
              PDF: cada página vira uma arte ({PDF_IMPORT_DPI} DPI, fundo transparente). PDFs
              com fundo branco continuam brancos — o corte só remove transparência.
            </p>
            <p className="hint folha-export-dpi-hint">
              DPI mais baixo = arquivo menor e export mais rápido; resolução cai.
              Preview continua em até {PREVIEW_DPI_CAP} DPI.
            </p>

            <label className="field">
              <span>Sensib. corte (alpha)</span>
              <input
                type="number"
                min={0}
                max={255}
                step={1}
                value={config.alphaThreshold}
                disabled={!config.trimEnabled}
                onChange={(e) =>
                  updateConfig(
                    'alphaThreshold',
                    Math.min(255, Math.max(0, Number(e.target.value) || 8)),
                  )
                }
              />
            </label>


            <details className="folha-hints">
              <summary>Dicas de montagem</summary>
              <p className="hint">
                <strong>Grade</strong> enche a largura esquerda→direita. Agrupar mantém a
                mesma arte junta. Em sob medida a altura cresce até {MAX_AUTO_HEIGHT_CM} cm.
                Preview usa até {PREVIEW_DPI_CAP} DPI; o export reempacota no DPI
                escolhido (padrão nativo ~{nativeDpi}).
              </p>
            </details>
          </section>
        </aside>

        {/* CENTRO — preview */}
        <section className="folha-preview-pane">
          <div className="folha-preview-sticky">
            <div className="result-head">
              <div>
                <p className="section-kicker">Pré-visualização</p>
                <h2>
                  {isAutoHeight
                    ? 'Folha sob medida'
                    : sheets.length > 0
                      ? `${sheets.length} folha(s)`
                      : 'Folhas'}
                </h2>
              </div>
            </div>

            {isAutoHeight && sheets.length > 0 && usedReadout != null && (
              <div className="used-readout" role="status">
                <div className="used-readout-main">
                  <strong>Usado: {usedReadout.toFixed(1)} cm</strong>
                  <span>
                    Largura {config.widthCm} cm
                    {utilReadout != null ? ` · ${utilReadout.toFixed(1)}%` : ''}
                  </span>
                </div>
                <div className="used-bar" aria-hidden>
                  <div
                    className="used-bar-fill"
                    style={{
                      width: `${Math.min(100, (usedReadout / MAX_AUTO_HEIGHT_CM) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            )}

            {packFatalError && (
              <ul className="errors">
                <li>{packFatalError}</li>
              </ul>
            )}

            {packErrors.length > 0 && (
              <ul className="errors">
                {packErrors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            )}

            {sheets.length === 0 ? (
              <div className="empty-state">
                <p className="empty-state-title">
                  {arts.length === 0
                    ? 'Aguardando artes'
                    : packFatalError
                      ? 'Falha ao montar'
                      : 'Nenhuma folha gerada'}
                </p>
                <p className="empty-state-desc">
                  {arts.length === 0
                    ? 'Importe PNGs na barra superior — a prévia aparece aqui.'
                    : packFatalError
                      ? packFatalError
                      : 'Verifique tamanhos, quantidades ou se a arte cabe na folha.'}
                </p>
              </div>
            ) : (
              <div className="sheets sheets-preview-large">
                {sheets.map((sheet) => (
                  <div key={sheet.index} className="sheet-card sheet-card-large">
                    <div className="sheet-meta">
                      <strong>
                        {isAutoHeight ? 'Tira contínua' : `Folha ${sheet.index + 1}`}
                      </strong>
                      <span>
                        {isAutoHeight
                          ? `${config.widthCm} × ${sheet.usedHeightCm?.toFixed(1) ?? '?'} cm`
                          : `${config.widthCm} × ${config.heightCm} cm`}
                        {' · '}
                        {sheet.placements.length} peça(s)
                        {config.cropEmptyExport ? ' · recortado' : ''}
                      </span>
                      <button
                        type="button"
                        className="btn sm"
                        disabled={exporting}
                        onClick={() => handleExportOne(sheet)}
                      >
                        PNG
                      </button>
                    </div>
                    <div className="sheet-preview checker">
                      <LazySheetPreview
                        sheet={sheet}
                        alt={
                          isAutoHeight
                            ? 'Pré-visualização da tira'
                            : `Folha ${sheet.index + 1}`
                        }
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* DIREITA — lista de artes compacta */}
        <aside className="folha-arts">
          <section className="card folha-card folha-arts-card">
            <div className="folha-card-head folha-arts-head">
              <div>
                <p className="section-kicker">Artes</p>
                <h2>Lista ({arts.length})</h2>
              </div>
              {arts.length > 0 && (
                <div className="art-toolbar">
                  <button type="button" className="btn sm" onClick={selectAllArts}>
                    Todas
                  </button>
                  <button type="button" className="btn sm" onClick={clearSelection}>
                    Nenhuma
                  </button>
                  <button
                    type="button"
                    className="btn sm primary"
                    onClick={handleDividirIguais}
                    title="Mesma qtd máxima nas marcadas, 1 folha"
                  >
                    Dividir iguais
                  </button>
                  <button
                    type="button"
                    className="btn sm"
                    onClick={handleRotateSelected}
                    title="Girar 90° nas selecionadas"
                  >
                    90° sel.
                  </button>
                </div>
              )}
            </div>

            {arts.length === 0 ? (
              <div className="empty-state">
                <p className="empty-state-title">Nenhuma arte</p>
                <p className="empty-state-desc">
                  Use Importar PNG/PDF ou Pasta na barra superior.
                </p>
              </div>
            ) : (
              <div className="art-table-wrap">
                <table className="art-table art-table-compact">
                  <thead>
                    <tr>
                      <th title="Seleção">
                        <span className="sr-only">Sel.</span>
                      </th>
                      <th></th>
                      <th>Qtd</th>
                      <th>Lado</th>
                      <th>cm</th>
                      <th>90°</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {artRows.map(({ art, ps }) => (
                      <tr key={art.id} className={ps.error ? 'row-error' : undefined}>
                        <td>
                          <input
                            type="checkbox"
                            checked={!!selectedIds[art.id]}
                            onChange={() => toggleSelect(art.id)}
                            aria-label={`Selecionar ${art.name}`}
                          />
                        </td>
                        <td>
                          <div
                            className={`thumb checker${art.rotate90 ? ' thumb-rotated' : ''}`}
                            title={art.name}
                          >
                            <img src={art.thumbnailUrl} alt={art.name} />
                          </div>
                        </td>
                        <td>
                          <input
                            className="qty"
                            type="number"
                            min={0}
                            step={1}
                            value={art.quantity}
                            onChange={(e) => setQty(art.id, Number(e.target.value))}
                            aria-label={`Quantidade ${art.name}`}
                          />
                          {ps.error && <small className="err">{ps.error}</small>}
                        </td>
                        <td>
                          <input
                            className="override"
                            type="number"
                            min={0.1}
                            step={0.1}
                            placeholder={String(config.maxSideCm)}
                            value={art.maxSideCmOverride ?? ''}
                            onChange={(e) => setArtMaxSide(art.id, e.target.value)}
                            title="Lado maior cm (vazio = global)"
                            aria-label={`Lado maior ${art.name}`}
                          />
                        </td>
                        <td className="mono art-cm" title={art.name}>
                          {ps.widthCm.toFixed(1)}×{ps.heightCm.toFixed(1)}
                          {art.rotate90 ? ' ↻' : ''}
                        </td>
                        <td className="rot-cell">
                          <button
                            type="button"
                            className={`btn sm${art.rotate90 ? ' primary' : ''}`}
                            aria-pressed={art.rotate90}
                            onClick={() => toggleRotate90(art.id)}
                            title="Girar 90°"
                          >
                            90°
                          </button>
                        </td>
                        <td className="row-actions">
                          <button
                            type="button"
                            className="btn sm"
                            disabled={!!ps.error}
                            onClick={() => handleEncherFolha(art.id)}
                            title="Encher folha com esta arte"
                          >
                            Encher
                          </button>
                          <button
                            type="button"
                            className="btn sm"
                            onClick={() => downloadArtPng(art)}
                            title="Baixar PNG cortado"
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            className="btn sm danger"
                            onClick={() => removeArt(art.id)}
                            title="Remover"
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </aside>
      </main>
    </div>
  )
}
