import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { saveAs } from 'file-saver'
import {
  DEFAULT_CONFIG,
  SHEET_PRESETS,
  type ArtItem,
  type PackedSheet,
  type SheetConfig,
} from './types'
import { applyTrim, loadPngAsCanvas } from './utils/trim'
import { getArtPrintSize, packArts } from './utils/pack'
import {
  fillLeftoverQuantities,
  maxEqualQtyOnOneSheet,
  maxQtyOneArtOnOneSheet,
} from './utils/fillSheet'
import { downloadAllSheetsZip, downloadSheetPng } from './utils/exportPng'
import './App.css'

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
    thumbnailUrl: trimmed.canvas.toDataURL('image/png'),
    quantity,
    maxSideCmOverride,
    rotate90,
  }
}

function formatPxSize(w: number, h: number): string {
  return `${w}×${h}`
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

  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)

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
    const files = Array.from(fileList).filter(
      (f) =>
        f.type === 'image/png' ||
        f.name.toLowerCase().endsWith('.png'),
    )
    if (files.length === 0) {
      setStatus('Nenhum PNG encontrado.')
      return
    }
    setLoading(true)
    setStatus(`Processando ${files.length} arquivo(s)…`)
    try {
      const next: ArtItem[] = []
      let anyCropped = false
      for (const file of files) {
        const loaded = await loadPngAsCanvas(file)
        const art = buildArtItem(
          uid(),
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
      }
      setArts((prev) => [...prev, ...next])
      // Sincroniza a chave para não reprocessar de novo no efeito
      trimKeyRef.current = `${config.trimEnabled}:${config.alphaThreshold}`
      if (anyCropped) {
        setStatus(`${next.length} arte(s) importada(s) (bordas transparentes cortadas).`)
      } else {
        setStatus(`${next.length} arte(s) importada(s).`)
      }
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Erro ao importar.')
    } finally {
      setLoading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
      if (folderInputRef.current) folderInputRef.current.value = ''
    }
  }

  const removeArt = (id: string) => {
    setArts((prev) => prev.filter((a) => a.id !== id))
  }

  const clearArts = () => {
    setArts([])
    setSelectedIds({})
    setSheets([])
    setPackErrors([])
    setStatus('')
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
    const q = maxQtyOneArtOnOneSheet(art, config)
    setArts((prev) => prev.map((a) => (a.id === id ? { ...a, quantity: q } : a)))
    setStatus(
      q > 0
        ? `Encher folha: "${art.name}" → ${q} peça(s) em 1 folha.`
        : `Encher folha: "${art.name}" não cabe na folha com o tamanho atual.`,
    )
  }

  const handleDividirIguais = () => {
    const selected = arts.filter((a) => selectedIds[a.id])
    const fitting = selected.filter((a) => !getArtPrintSize(a, config).error)
    if (fitting.length === 0) {
      setStatus('Dividir iguais: selecione ao menos uma arte que caiba na folha.')
      return
    }
    const q = maxEqualQtyOnOneSheet(fitting, config)
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
    const hasOrdered = arts.some(
      (a) => a.quantity >= 1 && !getArtPrintSize(a, config).error,
    )
    if (!hasOrdered) {
      setStatus('Sobras: defina primeiro as quantidades do pedido (≥ 1).')
      return
    }
    const result = fillLeftoverQuantities(arts, config)
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

  const artRows = useMemo(() => {
    return arts.map((art) => {
      const ps = getArtPrintSize(art, config)
      return { art, ps }
    })
  }, [arts, config])

  // Empacotar quando artes ou config mudam
  useEffect(() => {
    if (arts.length === 0) {
      setSheets([])
      setPackErrors([])
      return
    }
    const { sheets: packed, errors } = packArts(arts, config)
    setSheets(packed)
    setPackErrors(errors)
  }, [arts, config])

  const handleExportOne = async (sheet: PackedSheet) => {
    setExporting(true)
    try {
      await downloadSheetPng(sheet, config.dpi, `folha-${sheet.index + 1}.png`)
    } finally {
      setExporting(false)
    }
  }

  const handleExportAll = async () => {
    if (sheets.length === 0) return
    setExporting(true)
    try {
      if (sheets.length === 1) {
        await downloadSheetPng(sheets[0], config.dpi)
      } else {
        await downloadAllSheetsZip(sheets, config.dpi)
      }
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>DTF UV — Gang Sheets</h1>
          <p className="subtitle">
            Empacote artes PNG localmente (Mercado Livre / DTF UV). Nada é enviado ao servidor.
          </p>
        </div>
      </header>

      <main className="layout">
        {/* Configuração da folha */}
        <section className="card">
          <h2>Configuração da folha</h2>

          <div className="grid-2">
            <label className="field">
              <span>Preset</span>
              <select value={presetId} onChange={(e) => onPresetChange(e.target.value)}>
                {SHEET_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>DPI</span>
              <input
                type="number"
                min={72}
                max={600}
                step={1}
                value={config.dpi}
                onChange={(e) => updateConfig('dpi', Number(e.target.value) || 300)}
              />
            </label>
          </div>

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
              <span>Altura (cm)</span>
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
            </label>
          </div>

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
          </div>

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
          <h2>Importar</h2>
          <div className="import-actions">
            <button type="button" className="btn primary" onClick={() => fileInputRef.current?.click()} disabled={loading}>
              Selecionar PNGs
            </button>
            <button type="button" className="btn" onClick={() => folderInputRef.current?.click()} disabled={loading}>
              Selecionar pasta
            </button>
            {arts.length > 0 && (
              <button type="button" className="btn danger" onClick={clearArts}>
                Limpar tudo
              </button>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,.png"
            multiple
            hidden
            onChange={(e) => e.target.files && importFiles(e.target.files)}
          />
          <input
            ref={folderInputRef}
            type="file"
            accept="image/png,.png"
            multiple
            hidden
            onChange={(e) => e.target.files && importFiles(e.target.files)}
          />
          {status && <p className="status">{status}</p>}
          {loading && <p className="status">Aguarde…</p>}
        </section>

        {/* Artes */}
        <section className="card card-wide">
          <div className="section-head">
            <h2>Artes ({arts.length})</h2>
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
            <p className="empty">Importe PNGs para começar.</p>
          ) : (
            <div className="art-table-wrap">
              <table className="art-table">
                <thead>
                  <tr>
                    <th title="Seleção para Dividir iguais">
                      <span className="sr-only">Sel.</span>
                    </th>
                    <th></th>
                    <th>Nome</th>
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
                          <div className={`thumb checker${art.rotate90 ? ' thumb-rotated' : ''}`}>
                            <img src={art.thumbnailUrl} alt={art.name} />
                          </div>
                        </td>
                        <td className="name-cell">
                          <span title={art.name}>{art.name}</span>
                          {ps.error && <small className="err">{ps.error}</small>}
                        </td>
                        <td className="mono px-size" title={pxLabel}>
                          {pxLabel}
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

        {/* Resultado */}
        <section className="card card-wide">
          <div className="result-head">
            <h2>Resultado</h2>
            <div className="export-actions">
              <button
                type="button"
                className="btn"
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
          </div>

          {packErrors.length > 0 && (
            <ul className="errors">
              {packErrors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}

          {sheets.length === 0 ? (
            <p className="empty">
              {arts.length === 0
                ? 'Nenhuma folha gerada ainda.'
                : 'Nenhuma folha — verifique erros ou quantidades.'}
            </p>
          ) : (
            <div className="sheets">
              {sheets.map((sheet) => (
                <div key={sheet.index} className="sheet-card">
                  <div className="sheet-meta">
                    <strong>Folha {sheet.index + 1}</strong>
                    <span>
                      {config.widthCm} × {config.heightCm} cm · {sheet.placements.length} peça(s)
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
                    <img src={sheet.previewUrl} alt={`Folha ${sheet.index + 1}`} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      <footer className="footer">
        Processamento 100% no navegador · MaxRects · DPI embutido (pHYs)
      </footer>
    </div>
  )
}
