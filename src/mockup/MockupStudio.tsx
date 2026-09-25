import { useCallback, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, ClipboardEvent, DragEvent } from 'react'
import MockupCanvas, {
  type ArtTransform,
  type MockupCanvasHandle,
} from './MockupCanvas'
import {
  PRODUCTS,
  ART_SIZE_PRESETS,
  CERAMIC_COLOR_PRESETS,
  GLASS_TINT_PRESETS,
  type ProductId,
  type ArtSizeCm,
  getProduct,
  defaultColorsFor,
} from './products'
import { EXPORT_PRESETS, downloadMockupPng, type ExportPreset } from './exportMockup'
import './MockupStudio.css'

const DEFAULT_TRANSFORM: ArtTransform = {
  offsetXCm: 0,
  offsetYCm: 0,
  rotationDeg: 0,
  flipH: false,
  flipV: false,
}

function presetIdForSize(size: ArtSizeCm): string {
  const match = ART_SIZE_PRESETS.find(
    (p) => p.size && p.size.width === size.width && p.size.height === size.height,
  )
  return match?.id ?? 'custom'
}

type Props = {
  onLogout?: () => void
}

export default function MockupStudio({ onLogout }: Props) {
  const [productId, setProductId] = useState<ProductId>('copo_americano')
  const [colors, setColors] = useState<Record<string, string>>(() => defaultColorsFor('copo_americano'))
  const [frosting, setFrosting] = useState(0.08)
  const [bgColor, setBgColor] = useState('#e8eef5')
  const [artImage, setArtImage] = useState<HTMLImageElement | null>(null)
  const [artName, setArtName] = useState('')
  const [artSizeCm, setArtSizeCm] = useState<ArtSizeCm>(() => getProduct('copo_americano').defaultArtSizeCm)
  const [sizePresetId, setSizePresetId] = useState(() =>
    presetIdForSize(getProduct('copo_americano').defaultArtSizeCm),
  )
  const [transform, setTransform] = useState<ArtTransform>({ ...DEFAULT_TRANSFORM })
  const [showGuide, setShowGuide] = useState(true)
  const [exportPresetId, setExportPresetId] = useState(EXPORT_PRESETS[0].id)
  const [status, setStatus] = useState('')
  const [dragOver, setDragOver] = useState(false)

  const canvasRef = useRef<MockupCanvasHandle>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const product = getProduct(productId)

  const loadFile = useCallback((file: File) => {
    if (!file.type.includes('png') && !file.name.toLowerCase().endsWith('.png')) {
      setStatus('Envie um PNG transparente.')
      return
    }
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      setArtImage(img)
      setArtName(file.name)
      setTransform({ ...DEFAULT_TRANSFORM })
      setStatus(`Arte carregada: ${file.name}`)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      setStatus('Falha ao carregar a imagem.')
    }
    img.src = url
  }, [])

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) loadFile(f)
    e.target.value = ''
  }

  const onPaste = useCallback(
    (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) {
            e.preventDefault()
            loadFile(file)
            return
          }
        }
      }
    },
    [loadFile],
  )

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      const f = e.dataTransfer.files?.[0]
      if (f) loadFile(f)
    },
    [loadFile],
  )

  const selectProduct = (id: ProductId) => {
    const p = getProduct(id)
    setProductId(id)
    setColors(defaultColorsFor(id))
    setArtSizeCm({ ...p.defaultArtSizeCm })
    setSizePresetId(presetIdForSize(p.defaultArtSizeCm))
    setTransform({ ...DEFAULT_TRANSFORM })
    setFrosting(0.08)
    setStatus('')
  }

  const applySizePreset = (id: string) => {
    setSizePresetId(id)
    const preset = ART_SIZE_PRESETS.find((p) => p.id === id)
    if (preset?.size) {
      setArtSizeCm({ ...preset.size })
    }
  }

  const patchArtSize = (partial: Partial<ArtSizeCm>) => {
    setArtSizeCm((s) => {
      const next = {
        width: Math.max(0.5, Math.min(20, partial.width ?? s.width)),
        height: Math.max(0.5, Math.min(20, partial.height ?? s.height)),
      }
      setSizePresetId(presetIdForSize(next))
      return next
    })
  }

  const patchTransform = (partial: Partial<ArtTransform>) => {
    setTransform((t) => ({ ...t, ...partial }))
  }

  const setPartColor = (partId: string, hex: string) => {
    setColors((c) => ({ ...c, [partId]: hex }))
  }

  const applyCeramicPreset = (hex: string) => {
    setColors((c) => {
      const next = { ...c }
      for (const part of product.colorParts) {
        next[part.id] = hex
      }
      return next
    })
  }

  const centerArt = () => {
    setTransform((t) => ({ ...t, offsetXCm: 0, offsetYCm: 0, rotationDeg: 0 }))
  }

  const clearArt = () => {
    setArtImage(null)
    setArtName('')
    setTransform({ ...DEFAULT_TRANSFORM })
    setStatus('Arte removida.')
  }

  const handleExport = () => {
    const preset = EXPORT_PRESETS.find((p) => p.id === exportPresetId) as ExportPreset
    const base = artName ? artName.replace(/\.png$/i, '') : `mockup-${productId}`
    const ok = downloadMockupPng(canvasRef.current, preset, `mockup-${productId}-${base}`)
    setStatus(ok ? `PNG baixado (${preset.label}).` : 'Não foi possível exportar.')
  }

  const sizeReadout = useMemo(
    () => `Arte: ${artSizeCm.width}×${artSizeCm.height} cm no produto`,
    [artSizeCm],
  )

  const isGlass = product.material === 'glass'
  const isCeramic = product.material === 'porcelain'

  return (
    <div className="mockup-studio" onPaste={onPaste}>
      <header className="header mockup-header">
        <div>
          <h1>Mockup DTF UV</h1>
          <p className="subtitle">
            Pré-visualização profissional em produtos rígidos — arte em tamanho real (cm), como adesivo
            UV DTF (não wrap 360°).
          </p>
        </div>
        {onLogout && (
          <button type="button" className="btn sm logout-btn" onClick={onLogout} title="Encerrar sessão">
            Sair
          </button>
        )}
      </header>

      <div className="mockup-layout">
        <aside className="mockup-sidebar">
          <section className="card">
            <h2>Produto</h2>
            <div className="product-grid product-grid-3">
              {PRODUCTS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`product-card ${productId === p.id ? 'active' : ''}`}
                  onClick={() => selectProduct(p.id)}
                >
                  <span className="product-icon" aria-hidden>
                    {p.icon}
                  </span>
                  <span className="product-name">{p.name}</span>
                </button>
              ))}
            </div>
            <p className="hint">
              {product.diameterCm > 0 && (
                <>
                  Dimensão: <strong>Ø {product.diameterCm} × H {product.heightCm} cm</strong>
                  <br />
                </>
              )}
              {product.description}
            </p>
          </section>

          <section className="card">
            <h2>Arte PNG</h2>
            <div
              className={`dropzone ${dragOver ? 'dragover' : ''}`}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => fileRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') fileRef.current?.click()
              }}
            >
              {artImage ? (
                <div className="art-preview-wrap">
                  <img src={artImage.src} alt={artName} className="art-preview" />
                  <span className="art-name">{artName || 'arte.png'}</span>
                </div>
              ) : (
                <p>
                  Clique, solte ou cole (Ctrl+V)
                  <br />
                  <span className="muted">PNG transparente</span>
                </p>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,.png"
              hidden
              onChange={onFileChange}
            />
            <div className="row-actions">
              <button type="button" className="btn primary" onClick={() => fileRef.current?.click()}>
                Enviar PNG
              </button>
              {artImage && (
                <button type="button" className="btn danger" onClick={clearArt}>
                  Remover
                </button>
              )}
            </div>
          </section>

          <section className="card">
            <h2>Tamanho da arte</h2>
            <div className="size-preset-grid">
              {ART_SIZE_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`size-chip ${sizePresetId === p.id ? 'active' : ''}`}
                  onClick={() => applySizePreset(p.id)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="grid-2 custom-size-row">
              <label className="field">
                <span>Largura (cm)</span>
                <input
                  type="number"
                  min={0.5}
                  max={20}
                  step={0.1}
                  value={artSizeCm.width}
                  onChange={(e) => patchArtSize({ width: Number(e.target.value) })}
                />
              </label>
              <label className="field">
                <span>Altura (cm)</span>
                <input
                  type="number"
                  min={0.5}
                  max={20}
                  step={0.1}
                  value={artSizeCm.height}
                  onChange={(e) => patchArtSize({ height: Number(e.target.value) })}
                />
              </label>
            </div>
            <p className="size-readout" aria-live="polite">
              {sizeReadout}
            </p>
            <label className="field checkbox-field">
              <input
                type="checkbox"
                checked={showGuide}
                onChange={(e) => setShowGuide(e.target.checked)}
              />
              <span>Guia de área de impressão</span>
            </label>
          </section>

          <section className="card">
            <h2>Cores</h2>
            {isGlass && (
              <>
                <div className="preset-row">
                  {GLASS_TINT_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={`color-swatch ${colors.glass === p.hex ? 'active' : ''}`}
                      style={{ background: p.hex }}
                      title={p.label}
                      onClick={() => setPartColor('glass', p.hex)}
                    />
                  ))}
                </div>
                <label className="field">
                  <span>Tom do vidro</span>
                  <input
                    type="color"
                    value={colors.glass ?? '#e8f4fc'}
                    onChange={(e) => setPartColor('glass', e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Fosco ({Math.round(frosting * 100)}%)</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={frosting}
                    onChange={(e) => setFrosting(Number(e.target.value))}
                  />
                </label>
              </>
            )}
            {isCeramic && (
              <>
                <div className="preset-row">
                  {CERAMIC_COLOR_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="color-swatch"
                      style={{ background: p.hex }}
                      title={p.label}
                      onClick={() => applyCeramicPreset(p.hex)}
                    />
                  ))}
                </div>
                <div className="grid-2">
                  {product.colorParts.map((part) => (
                    <label key={part.id} className="field">
                      <span>{part.label}</span>
                      <input
                        type="color"
                        value={colors[part.id] ?? part.default}
                        onChange={(e) => setPartColor(part.id, e.target.value)}
                      />
                    </label>
                  ))}
                </div>
              </>
            )}
            <label className="field" style={{ marginTop: '0.5rem' }}>
              <span>Cor do fundo</span>
              <input type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)} />
            </label>
          </section>

          <section className="card">
            <h2>Posição da arte</h2>
            <label className="field">
              <span>Offset X ({transform.offsetXCm.toFixed(1)} cm)</span>
              <input
                type="range"
                min={-6}
                max={6}
                step={0.1}
                value={transform.offsetXCm}
                onChange={(e) => patchTransform({ offsetXCm: Number(e.target.value) })}
              />
            </label>
            <label className="field">
              <span>Offset Y ({transform.offsetYCm.toFixed(1)} cm)</span>
              <input
                type="range"
                min={-6}
                max={6}
                step={0.1}
                value={transform.offsetYCm}
                onChange={(e) => patchTransform({ offsetYCm: Number(e.target.value) })}
              />
            </label>
            <label className="field">
              <span>Rotação ({Math.round(transform.rotationDeg)}°)</span>
              <input
                type="range"
                min={-180}
                max={180}
                step={1}
                value={transform.rotationDeg}
                onChange={(e) => patchTransform({ rotationDeg: Number(e.target.value) })}
              />
            </label>
            <div className="row-actions wrap">
              <button type="button" className="btn" onClick={centerArt}>
                Centralizar
              </button>
              <button
                type="button"
                className={`btn ${transform.flipH ? 'primary' : ''}`}
                onClick={() => patchTransform({ flipH: !transform.flipH })}
              >
                Espelhar H
              </button>
              <button
                type="button"
                className={`btn ${transform.flipV ? 'primary' : ''}`}
                onClick={() => patchTransform({ flipV: !transform.flipV })}
              >
                Espelhar V
              </button>
            </div>
          </section>

          <section className="card">
            <h2>Exportar</h2>
            <label className="field">
              <span>Preset</span>
              <select
                value={exportPresetId}
                onChange={(e) => setExportPresetId(e.target.value)}
              >
                {EXPORT_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="btn primary" onClick={handleExport} disabled={!artImage}>
              Baixar PNG
            </button>
            <p className="hint">Sem marca d&apos;água. O tamanho da arte no PNG é o mesmo da prévia 3D.</p>
          </section>

          {status && <p className="status-line">{status}</p>}
        </aside>

        <section className="card mockup-preview-card">
          <div className="preview-toolbar">
            <h2>Pré-visualização</h2>
            <div className="row-actions">
              <button
                type="button"
                className="btn sm"
                onClick={() => canvasRef.current?.setViewAngle('frente')}
              >
                Ângulo Frente
              </button>
              <button
                type="button"
                className="btn sm"
                onClick={() => canvasRef.current?.setViewAngle('tresquartos')}
              >
                Ângulo ¾
              </button>
            </div>
          </div>
          <p className="hint preview-hint">
            Arraste para orbitar · scroll para zoom · {sizeReadout}
          </p>
          <MockupCanvas
            ref={canvasRef}
            className="mockup-canvas"
            productId={productId}
            colors={colors}
            backgroundColor={bgColor}
            artImage={artImage}
            artSizeCm={artSizeCm}
            transform={transform}
            showGuide={showGuide}
            frosting={frosting}
          />
        </section>
      </div>
    </div>
  )
}
