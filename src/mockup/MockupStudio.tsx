import { useCallback, useRef, useState } from 'react'
import type { ChangeEvent, ClipboardEvent, DragEvent } from 'react'
import MockupCanvas, {
  type ArtTransform,
  type MockupCanvasHandle,
} from './MockupCanvas'
import { PRODUCTS, type ProductId, getProduct } from './products'
import { EXPORT_PRESETS, downloadMockupPng, type ExportPreset } from './exportMockup'
import './MockupStudio.css'

const DEFAULT_TRANSFORM: ArtTransform = {
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  rotationDeg: 0,
  flipH: false,
  flipV: false,
}

type Props = {
  onLogout?: () => void
}

export default function MockupStudio({ onLogout }: Props) {
  const [productId, setProductId] = useState<ProductId>('copo')
  const [productColor, setProductColor] = useState('#ffffff')
  const [bgColor, setBgColor] = useState('#e8eef5')
  const [artImage, setArtImage] = useState<HTMLImageElement | null>(null)
  const [artName, setArtName] = useState('')
  const [transform, setTransform] = useState<ArtTransform>({ ...DEFAULT_TRANSFORM })
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
      // Keep object URL alive while image is used (don't revoke immediately)
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
    setProductId(id)
    setProductColor(getProduct(id).defaultColor)
    setStatus('')
  }

  const patchTransform = (partial: Partial<ArtTransform>) => {
    setTransform((t) => ({ ...t, ...partial }))
  }

  const centerArt = () => {
    setTransform((t) => ({ ...t, offsetX: 0, offsetY: 0, rotation: 1, rotationDeg: 0 }))
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

  return (
    <div className="mockup-studio" onPaste={onPaste}>
      <header className="header mockup-header">
        <div>
          <h1>Mockup DTF UV</h1>
          <p className="subtitle">
            Visualize a arte em produtos rígidos (prato, copo, taça, tumbler). Somente imagem —
            sem vídeo.
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
            <div className="product-grid">
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
              Área de impressão: <strong>{product.printAreaMm.width} × {product.printAreaMm.height} mm</strong>
              <br />
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
            <h2>Cores</h2>
            <div className="grid-2">
              <label className="field">
                <span>Cor do produto</span>
                <input
                  type="color"
                  value={productColor}
                  onChange={(e) => setProductColor(e.target.value)}
                />
              </label>
              <label className="field">
                <span>Cor do fundo</span>
                <input type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)} />
              </label>
            </div>
          </section>

          <section className="card">
            <h2>Arte — posição</h2>
            <label className="field">
              <span>Escala ({transform.scale.toFixed(2)})</span>
              <input
                type="range"
                min={0.2}
                max={3}
                step={0.01}
                value={transform.scale}
                onChange={(e) => patchTransform({ scale: Number(e.target.value) })}
              />
            </label>
            <label className="field">
              <span>Offset X ({transform.offsetX.toFixed(2)})</span>
              <input
                type="range"
                min={-1}
                max={1}
                step={0.01}
                value={transform.offsetX}
                onChange={(e) => patchTransform({ offsetX: Number(e.target.value) })}
              />
            </label>
            <label className="field">
              <span>Offset Y ({transform.offsetY.toFixed(2)})</span>
              <input
                type="range"
                min={-1}
                max={1}
                step={0.01}
                value={transform.offsetY}
                onChange={(e) => patchTransform({ offsetY: Number(e.target.value) })}
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
                Centralizar arte
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
            <p className="hint">Sem marca d&apos;água. Fundo e produto entram no PNG.</p>
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
          <p className="hint preview-hint">Arraste para orbitar · scroll para zoom</p>
          <MockupCanvas
            ref={canvasRef}
            className="mockup-canvas"
            productId={productId}
            productColor={productColor}
            backgroundColor={bgColor}
            artImage={artImage}
            transform={transform}
          />
        </section>
      </div>
    </div>
  )
}
