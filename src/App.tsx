import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { saveAs } from 'file-saver'
import {
  DEFAULT_CONFIG,
  MAX_AUTO_HEIGHT_CM,
  SHEET_PRESETS,
  type ArtItem,
  type PackedSheet,
  type SheetConfig,
} from './types'
import {
  applyTrim,
  IMPORT_WARN_MAX_SIDE_PX,
  loadPngAsCanvas,
  makeThumbnailDataUrl,
} from './utils/trim'
import { buildPreviewUrl, getArtPrintSize, packArts } from './utils/pack'
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
import { computeNativeExportDpi, resolveExportDpi } from './utils/units'
import './App.css'

/** DPI máximo para packing/preview ao vivo (export reempacota no DPI nativo). */
const PREVIEW_DPI_CAP = 150
/** Debounce do packing ao vivo (ms). */
const PACK_DEBOUNCE_MS = 320
/** Quantas folhas geram previewUrl de uma vez (resto sob demanda). */
const MAX_LIVE_PREVIEW_SHEETS = 6

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

function formatPxSize(w: number, h: number): string {
  return `${w}×${h}`
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
  const [presetId, setPresetId] = useState('29x42')
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
  const [skipDuplicateNames, setSkipDuplicateNames] = useState(true)
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

  const onPresetChange = (id: string) => {
    setPresetId(id)
    if (id === 'custom') return
    const p = SHEET_PRESETS.find((x) => x.id === id)
    if (p) {
      setConfig((c) => ({ ...c, widthCm: p.widthCm, heightCm: p.heightCm }))
    }
  }

  /** Inverte L×A e marca como personalizado (orientação paisagem/retrato). */
  const rotateSheetOrientation = () => {
    setPresetId('custom')
    setConfig((c) => ({ ...c, widthCm: c.heightCm, heightCm: c.widthCm }))
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
        (f.type === 'image/png' || f.name.toLowerCase().endsWith('.png')),
    )
    const skippedNonPng = all.length - files.length
    if (files.length === 0) {
      setStatus(
        skippedNonPng > 0
          ? `Nenhum PNG válido (ignorados ${skippedNonPng} não-PNG/vazios).`
          : 'Nenhum PNG encontrado.',
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
    if (skippedNonPng > 0) parts.push(`${skippedNonPng} não-PNG/vazio(s)`)
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

  /** DPI efetivo: nativo das PNGs (padrão) ou forçado. */
  const effectiveDpi = useMemo(
    () => resolveExportDpi(arts, config),
    [arts, config],
  )

  const nativeDpi = useMemo(
    () => computeNativeExportDpi(arts, config),
    [arts, config],
  )

  /** Config de export — dpi nativo/forçado completo. */
  const exportPackConfig = useMemo(
    () => ({ ...config, dpi: effectiveDpi }),
    [config, effectiveDpi],
  )

  /** DPI baixo só para packing + preview ao vivo (evita OOM ~780 DPI). */
  const previewDpi = useMemo(
    () => Math.min(effectiveDpi, PREVIEW_DPI_CAP),
    [effectiveDpi],
  )

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

  /** Reempacota no DPI nativo para export (preview usa DPI limitado). */
  const packForExport = (): PackedSheet[] => {
    const { sheets: packed, errors } = packArts(arts, exportPackConfig, {
      skipPreview: true,
    })
    if (errors.length > 0 && packed.length === 0) {
      throw new Error(errors[0] ?? 'Nada para exportar.')
    }
    return packed
  }

  const handleExportOne = async (sheet: PackedSheet) => {
    setExporting(true)
    setStatus(`Exportando folha ${sheet.index + 1} em ~${effectiveDpi} DPI (qualidade do PNG)…`)
    try {
      const exportSheets = packForExport()
      const target =
        exportSheets.find((s) => s.index === sheet.index) ?? exportSheets[sheet.index]
      if (!target) throw new Error('Folha não encontrada após reempacotar para export.')
      const filename = buildSheetFilename(target, exportSheets.length, clientName)
      await downloadSheetPng(target, effectiveDpi, filename, exportOpts)
      setStatus(`Folha ${sheet.index + 1} exportada (~${effectiveDpi} DPI).`)
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Erro ao exportar PNG.')
    } finally {
      setExporting(false)
    }
  }

  const handleExportAll = async () => {
    if (sheets.length === 0) return
    setExporting(true)
    setStatus(`Exportando em ~${effectiveDpi} DPI (reempacotando na qualidade nativa)…`)
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
      setStatus(`Exportação concluída (~${effectiveDpi} DPI · ${exportSheets.length} folha(s)).`)
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
    <div className="app">
      <header className="page-header">
        <p className="section-kicker">Folha · Gang Sheet</p>
        <h1>Montagem de folhas</h1>
        <p className="subtitle">
          Empacote artes PNG localmente para DTF UV e anúncios no Mercado Livre. Tudo roda no
          navegador — nada é enviado ao servidor.
        </p>
      </header>

      <main className="folha-layout">
        <div className="folha-sidebar">
        {/* Configuração da folha */}
        <section className="card">
          <div className="card-header">
            <div>
              <p className="section-kicker">Configuração</p>
              <h2 className="card-title">Folha de impressão</h2>
              <p className="card-desc">Tamanho, margens, gaps e modo de montagem</p>
            </div>
          </div>

          <div className="grid-2">
            <label className="field">
              <span>Preset da folha</span>
              <select value={presetId} onChange={(e) => onPresetChange(e.target.value)}>
                {(['Mercado Livre', 'Rolo DTF', 'Papel', 'Outro'] as const).map((group) => {
                  const items = SHEET_PRESETS.filter((p) => (p.group ?? 'Outro') === group)
                  if (items.length === 0) return null
                  return (
                    <optgroup key={group} label={group}>
                      {items.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </optgroup>
                  )
                })}
              </select>
            </label>

            <div className="field">
              <span>Exportação</span>
              <div className="dpi-readout" title="A folha é montada e exportada na densidade das PNGs importadas — sem reduzir qualidade">
                {config.useNativeDpi
                  ? `~${effectiveDpi} DPI (nativo das artes)`
                  : `${effectiveDpi} DPI (forçado)`}
              </div>
            </div>
          </div>

          <label className="checkbox">
            <input
              type="checkbox"
              checked={config.useNativeDpi}
              onChange={(e) => updateConfig('useNativeDpi', e.target.checked)}
            />
            <span>Qualidade do PNG importado (recomendado)</span>
          </label>
          <p className="hint">
            Exporta na mesma resolução das artes (sem pedir para reduzir qualidade), mesmo em
            folhas grandes. DPI nativo calculado: ~{nativeDpi}. A pré-visualização ao vivo usa
            até {PREVIEW_DPI_CAP} DPI (export reempacota no DPI completo).
          </p>

          {!config.useNativeDpi && (
            <label className="field">
              <span>Forçar DPI (avançado)</span>
              <input
                type="number"
                min={72}
                max={2400}
                step={1}
                value={config.dpi}
                onChange={(e) => updateConfig('dpi', Number(e.target.value) || 300)}
              />
            </label>
          )}

          <div className="grid-2">
            <label className="field">
              <span>Largura (cm)</span>
              <input
                type="number"
                min={1}
                step={0.1}
                value={config.widthCm}
                disabled={presetId !== 'custom'}
                onChange={(e) => {
                  setPresetId('custom')
                  updateConfig('widthCm', Number(e.target.value) || 1)
                }}
              />
            </label>
            <label className="field">
              <span>{isAutoHeight ? 'Altura (cm) — sob medida' : 'Altura (cm)'}</span>
              {isAutoHeight ? (
                <div className="dpi-readout" title="A altura cresce automaticamente">
                  Cresce até {MAX_AUTO_HEIGHT_CM} cm
                </div>
              ) : (
                <input
                  type="number"
                  min={1}
                  step={0.1}
                  value={config.heightCm}
                  disabled={presetId !== 'custom'}
                  onChange={(e) => {
                    setPresetId('custom')
                    updateConfig('heightCm', Number(e.target.value) || 1)
                  }}
                />
              )}
            </label>
          </div>
          <div className="row-actions" style={{ marginTop: '-0.35rem', marginBottom: '0.65rem' }}>
            <button type="button" className="btn secondary sm" onClick={rotateSheetOrientation}>
              Girar orientação (inverte L×A)
            </button>
          </div>
          <p className="hint" style={{ marginTop: '-0.35rem' }}>
            Presets em Largura × Altura (cm). Use &quot;Girar orientação&quot; para trocar paisagem/retrato.
          </p>

          <fieldset className="pack-mode">
            <legend>Tipo de folha</legend>
            <label className="radio">
              <input
                type="radio"
                name="sheetGrowMode"
                checked={!isAutoHeight}
                onChange={() => setGrowMode('fixed')}
              />
              <span>Folha fixa (W × H · várias folhas)</span>
            </label>
            <label className="radio">
              <input
                type="radio"
                name="sheetGrowMode"
                checked={isAutoHeight}
                onChange={() => setGrowMode('auto_height')}
              />
              <span>Folha sob medida / rolo (largura fixa · altura cresce)</span>
            </label>
            <p className="hint">
              Em <strong>sob medida</strong>, a largura vem do preset; a altura cresce até caber
              todas as artes em <em>uma</em> tira contínua (máx. {MAX_AUTO_HEIGHT_CM} cm).
              Recomendado com modo <strong>Grade</strong>.
            </p>
          </fieldset>

          <div className="grid-2">
            <label className="field">
              <span>Margem (mm)</span>
              <input
                type="number"
                min={0}
                step={0.5}
                value={config.marginMm}
                onChange={(e) => updateConfig('marginMm', Number(e.target.value) || 0)}
              />
            </label>
            {config.packMode === 'maxrects' && (
              <label className="field">
                <span>Espaçamento / gap (mm)</span>
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={config.gapMm}
                  onChange={(e) => updateConfig('gapMm', Number(e.target.value) || 0)}
                />
              </label>
            )}
          </div>

          {(config.packMode === 'grade' ||
            config.packMode === 'group_rows' ||
            config.packMode === 'group_cols') && (
            <div className="grid-2">
              <label className="field">
                <span>
                  {config.packMode === 'group_cols'
                    ? 'Espaçamento entre colunas (mm)'
                    : 'Espaçamento horizontal (mm)'}
                </span>
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={config.gapXMm}
                  onChange={(e) => updateConfig('gapXMm', Number(e.target.value) || 0)}
                />
              </label>
              <label className="field">
                <span>
                  {config.packMode === 'group_cols'
                    ? 'Espaçamento vertical na coluna (mm)'
                    : 'Espaçamento entre linhas (mm)'}
                </span>
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={config.gapYMm}
                  onChange={(e) => updateConfig('gapYMm', Number(e.target.value) || 0)}
                />
              </label>
            </div>
          )}
          {(config.packMode === 'grade' ||
            config.packMode === 'group_rows' ||
            config.packMode === 'group_cols') && (
            <p className="hint">
              Use gaps X e Y baixos (ex.: 1 mm) para uma grade rente — como no Organizador
              Nesting. No modo &quot;Aproveitar espaço&quot; vale o gap único.
            </p>
          )}

          <fieldset className="pack-mode">
            <legend>Modo de montagem</legend>
            <label className="radio">
              <input
                type="radio"
                name="packMode"
                checked={config.packMode === 'maxrects'}
                onChange={() => updateConfig('packMode', 'maxrects')}
              />
              <span>Aproveitar espaço</span>
            </label>
            <label className="radio">
              <input
                type="radio"
                name="packMode"
                checked={config.packMode === 'grade'}
                onChange={() => updateConfig('packMode', 'grade')}
              />
              <span>Grade — linhas e colunas</span>
            </label>
            <label className="radio">
              <input
                type="radio"
                name="packMode"
                checked={config.packMode === 'group_rows'}
                onChange={() => updateConfig('packMode', 'group_rows')}
              />
              <span>Agrupar por arte — fileiras (mesma arte junta)</span>
            </label>
            <label className="radio">
              <input
                type="radio"
                name="packMode"
                checked={config.packMode === 'group_cols'}
                onChange={() => updateConfig('packMode', 'group_cols')}
              />
              <span>Agrupar por arte — colunas (mesma arte junta)</span>
            </label>
            <p className="hint">
              <strong>Grade</strong> = como Organizador Nesting (rente, enche a largura
              esquerda→direita e sobe de linha; mistura artes; só abre nova folha quando a
              peça não cabe mais na atual). Agrupar mantém a mesma arte junta para recorte
              com tesoura. &quot;Aproveitar espaço&quot; usa MaxRects e pode misturar artes.
            </p>
          </fieldset>

          <div className="grid-2">
            <label className="field">
              <span>Lado maior (cm)</span>
              <input
                type="number"
                min={0.1}
                step={0.1}
                value={config.maxSideCm}
                onChange={(e) => updateConfig('maxSideCm', Number(e.target.value) || 5)}
              />
            </label>
            <label className="field">
              <span>Sensibilidade do corte (alpha 0–255)</span>
              <input
                type="number"
                min={0}
                max={255}
                step={1}
                value={config.alphaThreshold}
                disabled={!config.trimEnabled}
                onChange={(e) =>
                  updateConfig('alphaThreshold', Math.min(255, Math.max(0, Number(e.target.value) || 8)))
                }
              />
            </label>
          </div>

          <label className="checkbox">
            <input
              type="checkbox"
              checked={config.trimEnabled}
              onChange={(e) => updateConfig('trimEnabled', e.target.checked)}
            />
            <span>Cortar bordas transparentes</span>
          </label>
          <p className="hint">
            Remove o padding transparente em volta da arte (bounding box do alpha). Valores
            muito baixos (ex.: 1) podem deixar “poeira” invisível nas bordas (alpha=1) e o
            corte não encolhe; 8–16 costuma ser o melhor para packs PNG. Valores maiores
            cortam mais as bordas suaves/semi-transparentes. Com o corte desligado, usa a
            arte original completa.
          </p>

          <p className="hint">
            Gire arte por arte (botão 90°); todas as cópias da mesma arte ficam iguais.
          </p>
          <p className="hint">
            Modo &quot;lado maior&quot;: se a arte for mais larga que alta, a largura impressa = lado
            maior; senão a altura. Proporção sempre preservada.
          </p>
        </section>

        {/* Importar */}
        <section className="card">
          <div className="card-header">
            <div>
              <p className="section-kicker">Artes</p>
              <h2 className="card-title">Importar PNGs</h2>
              <p className="card-desc">Arquivos ou pasta inteira · corte automático opcional</p>
            </div>
          </div>
          <div className="import-actions">
            <button type="button" className="btn primary" onClick={() => fileInputRef.current?.click()} disabled={loading}>
              Selecionar PNGs
            </button>
            <button type="button" className="btn secondary" onClick={() => folderInputRef.current?.click()} disabled={loading}>
              Selecionar pasta
            </button>
            {arts.length > 0 && (
              <button type="button" className="btn danger" onClick={clearArts}>
                Limpar tudo
              </button>
            )}
          </div>
          <label className="checkbox" style={{ marginTop: '0.65rem' }}>
            <input
              type="checkbox"
              checked={skipDuplicateNames}
              onChange={(e) => setSkipDuplicateNames(e.target.checked)}
            />
            <span>Ignorar duplicatas (mesmo nome + tamanho)</span>
          </label>
          <p className="hint">
            <strong>Selecionar pasta</strong> só lê os PNGs no navegador — não grava nem copia
            na pasta. Se aparecerem cópias no Windows, confira o Organizador Nesting ou a pasta
            de Downloads.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,.png"
            multiple
            hidden
            onChange={(e) => e.target.files && void importFiles(e.target.files)}
          />
          <input
            ref={folderInputRef}
            type="file"
            accept="image/png,.png"
            multiple
            hidden
            onChange={(e) => e.target.files && void importFiles(e.target.files)}
          />
          {(status || loading) && (
            <p className={statusClass || 'status-banner'}>
              {loading && !status ? 'Aguarde…' : status}
            </p>
          )}
        </section>

        {/* Artes */}
        <section className="card">
          <div className="section-head">
            <div>
              <p className="section-kicker">Artes</p>
              <h2>Lista de artes ({arts.length})</h2>
            </div>
            {arts.length > 0 && (
              <div className="art-toolbar">
                <button type="button" className="btn sm" onClick={selectAllArts} title="Marcar todas as artes">
                  Selecionar todas
                </button>
                <button type="button" className="btn sm" onClick={clearSelection} title="Desmarcar todas">
                  Limpar seleção
                </button>
                <button
                  type="button"
                  className="btn sm primary"
                  onClick={handleDividirIguais}
                  title="Define a mesma quantidade máxima Q para as artes marcadas, cabendo tudo em 1 folha"
                >
                  Dividir iguais na folha
                </button>
                <button
                  type="button"
                  className="btn sm"
                  onClick={handleRotateSelected}
                  title="Alterna rotação 90° nas artes marcadas (todas as cópias de cada arte ficam iguais)"
                >
                  Girar 90° selecionadas
                </button>
              </div>
            )}
          </div>
          {arts.length === 0 ? (
            <div className="empty-state">
              <p className="empty-state-title">Nenhuma arte ainda</p>
              <p className="empty-state-desc">
                Importe PNGs transparentes acima para montar a folha. Use &quot;Selecionar pasta&quot;
                para lotes do Mercado Livre.
              </p>
            </div>
          ) : (
            <div className="art-table-wrap">
              <table className="art-table">
                <thead>
                  <tr>
                    <th title="Seleção para Dividir iguais">
                      <span className="sr-only">Sel.</span>
                    </th>
                    <th></th>
                    <th>px (orig. → corte)</th>
                    <th>Qtd</th>
                    <th>Lado maior (cm)</th>
                    <th>W × H (cm)</th>
                    <th title="Rotação 90° desta arte (todas as cópias)">90°</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {artRows.map(({ art, ps }) => {
                    const sizeChanged =
                      art.originalWidthPx !== art.trimmedWidthPx ||
                      art.originalHeightPx !== art.trimmedHeightPx
                    const pxLabel = sizeChanged
                      ? `${formatPxSize(art.originalWidthPx, art.originalHeightPx)} → ${formatPxSize(art.trimmedWidthPx, art.trimmedHeightPx)}`
                      : formatPxSize(art.originalWidthPx, art.originalHeightPx)
                    return (
                      <tr key={art.id} className={ps.error ? 'row-error' : undefined}>
                        <td>
                          <input
                            type="checkbox"
                            checked={!!selectedIds[art.id]}
                            onChange={() => toggleSelect(art.id)}
                            title="Incluir em Dividir iguais"
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
                        <td className="mono px-size" title={pxLabel}>
                          {pxLabel}
                          {ps.error && <small className="err">{ps.error}</small>}
                        </td>
                        <td>
                          <input
                            className="qty"
                            type="number"
                            min={0}
                            step={1}
                            value={art.quantity}
                            onChange={(e) => setQty(art.id, Number(e.target.value))}
                          />
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
                            title="Deixe vazio para usar o global"
                          />
                        </td>
                        <td className="mono">
                          {ps.widthCm.toFixed(2)} × {ps.heightCm.toFixed(2)}
                          {art.rotate90 ? ' ↻' : ''}
                        </td>
                        <td className="rot-cell">
                          <button
                            type="button"
                            className={`btn sm${art.rotate90 ? ' primary' : ''}`}
                            aria-pressed={art.rotate90}
                            onClick={() => toggleRotate90(art.id)}
                            title="Girar esta arte 90° (todas as cópias ficam iguais)"
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
                            title="Define a quantidade máxima desta arte sozinha em 1 folha"
                          >
                            Encher folha
                          </button>
                          <button
                            type="button"
                            className="btn sm"
                            onClick={() => downloadArtPng(art)}
                            title="Baixa o PNG atual desta arte (cortado se o corte estiver ligado)"
                          >
                            Baixar cortada
                          </button>
                          <button type="button" className="btn sm danger" onClick={() => removeArt(art.id)}>
                            Remover
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Exportação */}
        <section className="card">
          <div className="card-header">
            <div>
              <p className="section-kicker">Exportar</p>
              <h2 className="card-title">Salvar folhas</h2>
              <p className="card-desc">Nome do cliente, recorte e download</p>
            </div>
          </div>

          <label className="field">
            <span>Nome do cliente</span>
            <input
              type="text"
              value={clientName}
              placeholder="Ex.: Maria Silva (opcional)"
              onChange={(e) => setClientName(e.target.value)}
              maxLength={80}
            />
          </label>
          <p className="hint">
            Se preenchido, os arquivos saem como{' '}
            <code>{'{Cliente}_gang.png'}</code> ou{' '}
            <code>{'{Cliente}_folha-01.png'}</code> / ZIP{' '}
            <code>{'{Cliente}_folhas.zip'}</code>.
          </p>

          <label className="checkbox">
            <input
              type="checkbox"
              checked={config.cropEmptyExport}
              onChange={(e) => updateConfig('cropEmptyExport', e.target.checked)}
            />
            <span>Recortar espaços vazios no export</span>
          </label>
          <p className="hint">
            Gera PNG só da área com artes + margem ({config.marginMm} mm), sem a folha
            vazia em volta. Mantém DPI (pHYs). Ligado por padrão em folha sob medida.
          </p>

          <div className="export-actions" style={{ marginTop: '0.75rem' }}>
            <button
              type="button"
              className="btn secondary"
              disabled={arts.length === 0}
              onClick={handlePreencherSobras}
              title="Após o pedido: adiciona cópias extras só no espaço vazio, sem criar novas folhas"
            >
              Preencher sobras
            </button>
            {sheets.length > 0 && (
              <button
                type="button"
                className="btn primary"
                disabled={exporting}
                onClick={handleExportAll}
              >
                {sheets.length === 1 ? 'Baixar PNG' : 'Baixar todas (ZIP)'}
              </button>
            )}
          </div>
          {(status || loading || exporting) && (
            <p className={statusClass || 'status-banner'}>
              {loading && !status ? 'Aguarde…' : status}
            </p>
          )}
        </section>
        </div>{/* /.folha-sidebar */}

        {/* Preview sticky à direita */}
        <aside className="folha-preview-pane">
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
                  <strong>Usado: {usedReadout.toFixed(1)} cm de altura</strong>
                  <span>
                    Largura {config.widthCm} cm
                    {utilReadout != null ? ` · Aproveitamento ${utilReadout.toFixed(1)}%` : ''}
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
                <p className="hint" style={{ marginTop: '0.35rem' }}>
                  Limite {MAX_AUTO_HEIGHT_CM} cm · ~{effectiveDpi} DPI
                </p>
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
                    ? 'Importe artes à esquerda — a pré-visualização aparece aqui ao vivo.'
                    : packFatalError
                      ? packFatalError
                      : 'Verifique erros de tamanho, quantidades zeradas ou se a arte cabe na folha.'}
                </p>
              </div>
            ) : (
              <div className="sheets sheets-preview-large">
                {sheets.map((sheet) => (
                  <div key={sheet.index} className="sheet-card sheet-card-large">
                    <div className="sheet-meta">
                      <strong>
                        {isAutoHeight
                          ? 'Tira contínua'
                          : `Folha ${sheet.index + 1}`}
                      </strong>
                      <span>
                        {isAutoHeight
                          ? `${config.widthCm} × ${sheet.usedHeightCm?.toFixed(1) ?? '?'} cm`
                          : `${config.widthCm} × ${config.heightCm} cm`}
                        {' · '}
                        {sheet.placements.length} peça(s) · ~{effectiveDpi} DPI
                        {config.cropEmptyExport ? ' · export recortado' : ''}
                      </span>
                      <button
                        type="button"
                        className="btn sm"
                        disabled={exporting}
                        onClick={() => handleExportOne(sheet)}
                      >
                        Baixar PNG
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
        </aside>
      </main>

    </div>
  )
}

