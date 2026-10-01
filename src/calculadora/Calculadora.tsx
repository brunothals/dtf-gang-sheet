import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ArtDef, ArtInput, CalcResult, PlaceItem, SavedOrder } from './types'
import { FOLHAS_PAD, SHEET_WIDTH_CM } from './types'
import {
  artFits,
  bestFit,
  findIdealHeight,
  fmtCm,
  money,
  packArts,
  packOntoSheets,
} from './pack'
import { buildOrcamentoCompleto, buildResumo } from './orcamento'
import {
  deleteOrder,
  findOrder,
  getSavedOrders,
  saveOrder,
} from './orders'
import SheetPreview from './SheetPreview'
import './Calculadora.css'

function uid(): string {
  return Math.random().toString(36).slice(2, 9)
}

function newArt(partial?: Partial<ArtInput>): ArtInput {
  return {
    id: uid(),
    name: '',
    origW: partial?.origW ?? 10,
    origH: partial?.origH ?? 8,
    qty: partial?.qty ?? 4,
    color: partial?.color ?? 'colorido',
  }
}

type MainMode = 'normal' | 'inv'
type NormalSub = 'fill' | 'multi'

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

export default function Calculadora() {
  const [clientName, setClientName] = useState('')
  const [saleAd, setSaleAd] = useState('')
  const [mainMode, setMainMode] = useState<MainMode>('normal')
  const [normalSub, setNormalSub] = useState<NormalSub>('multi')

  const [folhaSel, setFolhaSel] = useState('29x42')
  const [fhCustom, setFhCustom] = useState(60)
  const [esp, setEsp] = useState(0.3)
  const [useRot, setUseRot] = useState(true)

  const [fillW, setFillW] = useState(10)
  const [fillH, setFillH] = useState(8)
  const [fillColor, setFillColor] = useState('colorido')
  const [fillName, setFillName] = useState('')

  const [arts, setArts] = useState<ArtInput[]>(() => [newArt({ qty: 4 })])
  const [artsInv, setArtsInv] = useState<ArtInput[]>(() => [newArt({ qty: 3 })])
  const [espInv, setEspInv] = useState(0.3)
  const [useRotInv, setUseRotInv] = useState(true)

  const [s2w, setS2w] = useState<number | ''>('')
  const [s2h, setS2h] = useState<number | ''>('')
  const [s2Color, setS2Color] = useState('')

  const [result, setResult] = useState<CalcResult | null>(null)
  const [s2Preview, setS2Preview] = useState<{
    placed: CalcResult['placed']
    arts: ArtDef[]
    s2Count: number
    aprov: number
  } | null>(null)
  const [compRows, setCompRows] = useState<
    Array<{
      label: string
      cost: string
      total: number
      cols: number
      rows: number
      aprov: number
      rotated: boolean
      best: boolean
      ok?: boolean
      sobra?: string
    }>
  >([])
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [saved, setSaved] = useState<SavedOrder[]>(() => getSavedOrders())
  const [savedDetail, setSavedDetail] = useState('')
  const [activeSheetIdx, setActiveSheetIdx] = useState(0)

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(''), 1800)
  }, [])

  const folha = useMemo(() => {
    if (folhaSel === 'custom') {
      const h = fhCustom || 60
      return { w: SHEET_WIDTH_CM, h, label: `29 x ${h} cm`, cost: 0 }
    }
    const [w, h] = folhaSel.split('x').map(Number)
    const preset = FOLHAS_PAD.find((f) => f.w === w && f.h === h)
    return {
      w,
      h,
      label: `${w} x ${h} cm`,
      cost: preset?.cost ?? 0,
    }
  }, [folhaSel, fhCustom])

  useEffect(() => {
    setResult(null)
    setS2Preview(null)
    setError('')
  }, [mainMode, normalSub])

  function updateArt(list: ArtInput[], setList: (a: ArtInput[]) => void, id: string, patch: Partial<ArtInput>) {
    setList(list.map((a) => (a.id === id ? { ...a, ...patch } : a)))
  }

  function limpar() {
    setFillW(10)
    setFillH(8)
    setFillColor('colorido')
    setFillName('')
    setS2w('')
    setS2h('')
    setS2Color('')
    setArts([newArt({ qty: 4 })])
    setArtsInv([newArt({ qty: 3 })])
    setResult(null)
    setS2Preview(null)
    setError('')
    setCompRows([])
    setSavedDetail('')
  }

  function buildArtsFromInputs(inputs: ArtInput[]): { arts: ArtDef[]; toPlace: PlaceItem[] } | null {
    const defs: ArtDef[] = []
    const toPlace: PlaceItem[] = []
    let idx = 0
    for (const a of inputs) {
      const w = Number(a.origW)
      const h = Number(a.origH)
      const qty = Math.max(1, Math.floor(Number(a.qty) || 1))
      if (!(w > 0 && h > 0)) continue
      defs.push({
        origW: w,
        origH: h,
        idx,
        color: (a.color || '').trim() || 'não informado',
        name: (a.name || '').trim(),
        qty,
      })
      for (let j = 0; j < qty; j++) toPlace.push({ origW: w, origH: h, idx })
      idx++
    }
    if (!defs.length) return null
    return { arts: defs, toPlace }
  }

  function calcularNormal() {
    setError('')
    const fw = folha.w
    const fh = folha.h
    let defs: ArtDef[]
    let toPlace: PlaceItem[]

    if (normalSub === 'fill') {
      const aw = Number(fillW)
      const ah = Number(fillH)
      if (!aw || !ah) {
        setError('Informe as medidas da arte.')
        return
      }
      if (!artFits(aw, ah, fw, fh, useRot)) {
        setError(
          `Esta arte não cabe nesta folha com a rotação ${useRot ? 'ativada' : 'desativada'}.`,
        )
        return
      }
      const bf = bestFit(aw, ah, fw, fh, esp, useRot)
      defs = [
        {
          origW: aw,
          origH: ah,
          idx: 0,
          color: (fillColor || '').trim() || 'não informado',
          name: (fillName || '').trim(),
          qty: bf.total,
        },
      ]
      toPlace = []
      for (let i = 0; i < bf.total; i++) toPlace.push({ origW: aw, origH: ah, idx: 0 })
    } else {
      const built = buildArtsFromInputs(arts)
      if (!built) {
        setError('Adicione ao menos uma arte com medidas válidas.')
        return
      }
      defs = built.arts
      toPlace = built.toPlace
      const invalid = defs.filter((a) => !artFits(a.origW, a.origH, fw, fh, useRot))
      if (invalid.length) {
        setError(
          `Uma ou mais artes não cabem nesta folha com a rotação ${useRot ? 'ativada' : 'desativada'}.`,
        )
        return
      }
    }

    const sheets = packOntoSheets(toPlace, fw, fh, esp, useRot)
    const placed = sheets.flatMap((s) => s.placed)
    // Para modo fill / preview principal, usar só a 1ª folha (comportamento clássico)
    const firstPlaced = sheets[0]?.placed ?? []
    const requested = toPlace.length
    // No fill, "faltaram" = 0 pois qty = capacidade. No multi, se couber em N folhas, missing=0
    const allFit = placed.length >= requested
    const missing = allFit ? 0 : Math.max(0, requested - placed.length)
    const artArea = firstPlaced.reduce((s, p) => s + p.w * p.h, 0)
    const aprov = Math.round((artArea / (fw * fh)) * 100)
    const rotCount = firstPlaced.filter((p) => p.rotated).length

    // Segunda arte no espaço restante da 1ª folha
    const sw = Number(s2w) || 0
    const sh = Number(s2h) || 0
    const s2c = (s2Color || '').trim() || 'não informado'
    let s2Placed = 0
    let s2Prev: typeof s2Preview = null

    if (sw > 0 && sh > 0 && artFits(sw, sh, fw, fh, useRot)) {
      const s2arts = defs.concat([
        { origW: sw, origH: sh, idx: defs.length, color: s2c, name: '2ª arte', qty: 0 },
      ])
      const toPlace2 = toPlace.slice()
      // Só preencher 2ª arte na 1ª folha (clássico)
      const maxS2 = Math.ceil((fw * fh) / (sw * sh)) + 10
      for (let k = 0; k < maxS2; k++) toPlace2.push({ origW: sw, origH: sh, idx: defs.length })
      const placed2 = packArts(toPlace2, fw, fh, esp, useRot)
      const s2rects = placed2.filter((p) => p.idx === defs.length)
      s2Placed = s2rects.length
      const newAprov = Math.round(
        (placed2.reduce((s, p) => s + p.w * p.h, 0) / (fw * fh)) * 100,
      )
      s2Prev = { placed: placed2, arts: s2arts, s2Count: s2Placed, aprov: newAprov }
    }
    setS2Preview(s2Prev)

    // Comparativo com 1ª arte
    const a0 = defs[0]
    const fits = FOLHAS_PAD.map((f) => bestFit(a0.origW, a0.origH, f.w, f.h, esp, useRot))
    const maxComp = Math.max(...fits.map((f) => f.total))
    setCompRows(
      FOLHAS_PAD.map((f, i) => {
        const bf = fits[i]
        const ap =
          bf.total > 0 ? Math.round(((bf.total * bf.aw * bf.ah) / (f.w * f.h)) * 100) : 0
        return {
          label: f.label,
          cost: money(f.cost),
          total: bf.total,
          cols: bf.cols,
          rows: bf.rows,
          aprov: ap,
          rotated: bf.rotated,
          best: bf.total === maxComp && maxComp > 0,
        }
      }),
    )

    const calc: CalcResult = {
      mode: 'normal',
      folha: { w: fw, h: fh, label: folha.label, cost: folha.cost },
      arts: defs,
      placed: allFit ? placed : firstPlaced,
      sheets: allFit && sheets.length > 1 ? sheets : sheets.slice(0, 1).map((s, i) => ({
        ...s,
        sheetIndex: i + 1,
      })),
      aprov,
      esp,
      s2w: sw,
      s2h: sh,
      s2Color: s2c,
      s2Placed,
      requested,
      missing,
      rotCount,
      useRot,
    }

    // Se multi e não cabe em 1 folha, usar todas as folhas no resultado
    if (normalSub === 'multi' && sheets.length > 1 && allFit) {
      calc.placed = placed
      calc.sheets = sheets
      calc.missing = 0
      calc.rotCount = placed.filter((p) => p.rotated).length
      const totalArea = placed.reduce((s, p) => s + p.w * p.h, 0)
      calc.aprov = Math.round((totalArea / (fw * fh * sheets.length)) * 100)
    } else if (normalSub === 'multi' && !allFit) {
      // Empacota o que couber (todas as folhas geradas)
      calc.placed = placed
      calc.sheets = sheets
      calc.missing = Math.max(0, requested - placed.length)
      calc.rotCount = placed.filter((p) => p.rotated).length
    }

    setResult(calc)
    setActiveSheetIdx(0)
  }

  function calcularInverso() {
    setError('')
    const built = buildArtsFromInputs(artsInv)
    if (!built) {
      setError('Adicione ao menos uma arte com medidas válidas.')
      return
    }
    const { arts: defs, toPlace } = built
    const FW = SHEET_WIDTH_CM
    const tooWide = defs.filter((a) => !artFits(a.origW, a.origH, FW, 500, useRotInv))
    if (tooWide.length) {
      setError(
        `Uma ou mais artes não cabem na largura fixa de 29 cm com a rotação ${useRotInv ? 'ativada' : 'desativada'}.`,
      )
      return
    }

    const idealH = findIdealHeight(toPlace, espInv, useRotInv, defs)
    if (!idealH) {
      setError('Não foi possível calcular. Verifique se as artes cabem em 29 cm de largura.')
      return
    }

    const placed = packArts(toPlace.slice(), FW, idealH, espInv, useRotInv)
    const requested = toPlace.length
    const missing = Math.max(0, requested - placed.length)
    const artArea = placed.reduce((s, p) => s + p.w * p.h, 0)
    const aprov = Math.round((artArea / (FW * idealH)) * 100)
    const rotCount = placed.filter((p) => p.rotated).length

    setCompRows(
      FOLHAS_PAD.map((f) => {
        const pl2 = packArts(toPlace.slice(), f.w, f.h, espInv, useRotInv)
        const ok = pl2.length >= toPlace.length
        return {
          label: f.label,
          cost: money(f.cost),
          total: pl2.length,
          cols: 0,
          rows: 0,
          aprov: 0,
          rotated: false,
          best: ok,
          ok,
          sobra: ok ? `${f.h} cm (sobra ${(f.h - idealH).toFixed(1)} cm)` : '—',
        }
      }),
    )

    setS2Preview(null)
    setResult({
      mode: 'inv',
      folha: { w: FW, h: idealH, label: `29 x ${idealH} cm`, cost: 0 },
      arts: defs,
      placed,
      sheets: [{ sheetIndex: 1, placed, heightCm: idealH }],
      aprov,
      esp: espInv,
      s2w: 0,
      s2h: 0,
      s2Color: '',
      s2Placed: 0,
      requested,
      missing,
      rotCount,
      useRot: useRotInv,
    })
    setActiveSheetIdx(0)
  }

  function calcular() {
    if (mainMode === 'normal') calcularNormal()
    else calcularInverso()
  }

  async function onCopyOrcamento() {
    if (!result) return
    const text = buildOrcamentoCompleto(result, clientName, saleAd)
    const ok = await copyText(text)
    showToast(ok ? 'Orçamento copiado' : 'Não foi possível copiar')
  }

  async function onCopyResumo() {
    if (!result) return
    const text = buildResumo(result, clientName, saleAd)
    const ok = await copyText(text)
    showToast(ok ? 'Resumo copiado' : 'Não foi possível copiar')
  }

  function onSalvar() {
    if (!result) {
      setError('Calcule o pedido antes de salvar.')
      return
    }
    const summary = buildResumo(result, clientName, saleAd)
    const orcamento = buildOrcamentoCompleto(result, clientName, saleAd)
    const item = saveOrder({
      client: clientName.trim() || 'Sem cliente',
      ad: saleAd.trim() || 'Sem anúncio',
      sheet: `${result.folha.w} x ${result.folha.h} cm`,
      requested: result.requested,
      placed: result.placed.length,
      summary,
      orcamento,
    })
    setSaved(getSavedOrders())
    setSavedDetail(item.orcamento)
    showToast('Pedido salvo')
  }

  function onAbrirSalvo(id: string) {
    const o = findOrder(id)
    if (!o) return
    setClientName(o.client === 'Sem cliente' ? '' : o.client)
    setSaleAd(o.ad === 'Sem anúncio' ? '' : o.ad)
    setSavedDetail(o.orcamento || o.summary)
    showToast('Pedido aberto')
  }

  async function onCopiarSalvo(id: string) {
    const o = findOrder(id)
    if (!o) return
    const ok = await copyText(o.orcamento || o.summary)
    showToast(ok ? 'Orçamento copiado' : 'Não foi possível copiar')
  }

  function onExcluirSalvo(id: string) {
    if (!confirm('Excluir este pedido salvo deste navegador?')) return
    deleteOrder(id)
    setSaved(getSavedOrders())
    setSavedDetail('')
    showToast('Pedido excluído')
  }

  const previewSheet = result?.sheets[activeSheetIdx] ?? null
  const previewArts =
    result && s2Preview && activeSheetIdx === 0 && result.mode === 'normal'
      ? null
      : result?.arts

  return (
    <div className="calc-studio">
      <header className="calc-header">
        <div>
          <p className="section-kicker">Orçamento</p>
          <h1>Calculadora DTF UV</h1>
        </div>
        <p className="calc-header-sub">
          Medidas → encaixe 29 cm → orçamento. Sem scroll longo até as artes.
        </p>
      </header>

      <div className="calc-layout">
        {/* LEFT: form — sticky / scrollable */}
        <aside className="calc-sidebar">
          <div className="calc-panel">
            {/* Mode */}
            <div className="calc-tabs" role="tablist">
              <button
                type="button"
                className={`calc-tab ${mainMode === 'normal' ? 'on' : ''}`}
                onClick={() => setMainMode('normal')}
              >
                Tenho a folha
              </button>
              <button
                type="button"
                className={`calc-tab ${mainMode === 'inv' ? 'on' : ''}`}
                onClick={() => setMainMode('inv')}
              >
                Qual folha usar?
              </button>
            </div>

            {/* Cliente — compact */}
            <div className="calc-meta">
              <label className="field">
                <span>Cliente</span>
                <input
                  type="text"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="Maria Silva"
                />
              </label>
              <label className="field">
                <span>Anúncio</span>
                <input
                  type="text"
                  value={saleAd}
                  onChange={(e) => setSaleAd(e.target.value)}
                  placeholder="Instagram — copos"
                />
              </label>
            </div>

            {mainMode === 'normal' && (
              <>
                {/* Folha config — one dense row */}
                <div className="calc-folha-row">
                  <label className="field">
                    <span>Folha</span>
                    <select value={folhaSel} onChange={(e) => setFolhaSel(e.target.value)}>
                      <option value="29x21">29×21</option>
                      <option value="29x42">29×42</option>
                      <option value="29x50">29×50</option>
                      <option value="29x100">29×100</option>
                      <option value="custom">Custom</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Esp. cm</span>
                    <input
                      type="number"
                      value={esp}
                      min={0}
                      max={5}
                      step={0.1}
                      onChange={(e) => setEsp(Number(e.target.value))}
                    />
                  </label>
                  <label className="field">
                    <span>Custom H</span>
                    <input
                      type="number"
                      value={fhCustom}
                      min={1}
                      disabled={folhaSel !== 'custom'}
                      onChange={(e) => setFhCustom(Number(e.target.value))}
                    />
                  </label>
                  <label className="calc-check">
                    <input
                      type="checkbox"
                      checked={useRot}
                      onChange={(e) => setUseRot(e.target.checked)}
                    />
                    Rot. 90°
                  </label>
                </div>

                <div className="calc-subtabs">
                  <button
                    type="button"
                    className={`calc-subtab ${normalSub === 'fill' ? 'on' : ''}`}
                    onClick={() => setNormalSub('fill')}
                  >
                    Preencher folha
                  </button>
                  <button
                    type="button"
                    className={`calc-subtab ${normalSub === 'multi' ? 'on' : ''}`}
                    onClick={() => setNormalSub('multi')}
                  >
                    Múltiplas artes
                  </button>
                </div>

                {normalSub === 'fill' ? (
                  <div className="calc-fill-row">
                    <label className="field">
                      <span>L cm</span>
                      <input
                        type="number"
                        value={fillW}
                        min={0.1}
                        step={0.1}
                        onChange={(e) => setFillW(Number(e.target.value))}
                      />
                    </label>
                    <label className="field">
                      <span>A cm</span>
                      <input
                        type="number"
                        value={fillH}
                        min={0.1}
                        step={0.1}
                        onChange={(e) => setFillH(Number(e.target.value))}
                      />
                    </label>
                    <label className="field">
                      <span>Cor</span>
                      <input
                        type="text"
                        value={fillColor}
                        onChange={(e) => setFillColor(e.target.value)}
                        placeholder="preto"
                      />
                    </label>
                    <label className="field">
                      <span>Nome</span>
                      <input
                        type="text"
                        value={fillName}
                        onChange={(e) => setFillName(e.target.value)}
                        placeholder="opcional"
                      />
                    </label>
                  </div>
                ) : (
                  <>
                    <ArtRows
                      arts={arts}
                      onChange={(id, patch) => updateArt(arts, setArts, id, patch)}
                      onRemove={(id) => setArts(arts.filter((a) => a.id !== id))}
                    />
                    <button
                      type="button"
                      className="calc-add"
                      onClick={() => setArts([...arts, newArt({ qty: 1, color: '' })])}
                    >
                      + Adicionar arte
                    </button>
                  </>
                )}

                <details className="calc-details">
                  <summary>2ª arte (espaço restante, opcional)</summary>
                  <div className="calc-fill-row" style={{ marginTop: '0.45rem' }}>
                    <label className="field">
                      <span>L cm</span>
                      <input
                        type="number"
                        value={s2w}
                        min={0.1}
                        step={0.1}
                        placeholder="5"
                        onChange={(e) =>
                          setS2w(e.target.value === '' ? '' : Number(e.target.value))
                        }
                      />
                    </label>
                    <label className="field">
                      <span>A cm</span>
                      <input
                        type="number"
                        value={s2h}
                        min={0.1}
                        step={0.1}
                        placeholder="4"
                        onChange={(e) =>
                          setS2h(e.target.value === '' ? '' : Number(e.target.value))
                        }
                      />
                    </label>
                    <label className="field">
                      <span>Cor</span>
                      <input
                        type="text"
                        value={s2Color}
                        placeholder="preto"
                        onChange={(e) => setS2Color(e.target.value)}
                      />
                    </label>
                  </div>
                </details>
              </>
            )}

            {mainMode === 'inv' && (
              <>
                <p className="calc-hint-inline">
                  Menor comprimento com largura fixa 29 cm
                </p>
                <ArtRows
                  arts={artsInv}
                  onChange={(id, patch) => updateArt(artsInv, setArtsInv, id, patch)}
                  onRemove={(id) => setArtsInv(artsInv.filter((a) => a.id !== id))}
                />
                <button
                  type="button"
                  className="calc-add"
                  onClick={() => setArtsInv([...artsInv, newArt({ qty: 1, color: '' })])}
                >
                  + Adicionar arte
                </button>
                <div className="calc-folha-row">
                  <label className="field">
                    <span>Esp. cm</span>
                    <input
                      type="number"
                      value={espInv}
                      min={0}
                      max={5}
                      step={0.1}
                      onChange={(e) => setEspInv(Number(e.target.value))}
                    />
                  </label>
                  <label className="calc-check">
                    <input
                      type="checkbox"
                      checked={useRotInv}
                      onChange={(e) => setUseRotInv(e.target.checked)}
                    />
                    Rot. 90°
                  </label>
                </div>
              </>
            )}

            {/* Primary actions — right under arts */}
            <div className="calc-actions">
              <button type="button" className="btn primary" onClick={calcular}>
                {mainMode === 'normal' ? 'Calcular encaixe' : 'Calcular folha ideal'}
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={onCopyOrcamento}
                disabled={!result}
                title={!result ? 'Calcule antes de copiar' : undefined}
              >
                Copiar orçamento
              </button>
              <button type="button" className="btn ghost" onClick={limpar}>
                Limpar
              </button>
            </div>
            {error && <p className="calc-error">{error}</p>}

            <div className="calc-secondary-actions">
              <button
                type="button"
                className="btn ghost sm"
                onClick={onCopyResumo}
                disabled={!result}
              >
                Copiar resumo
              </button>
              <button
                type="button"
                className="btn ghost sm"
                onClick={onSalvar}
                disabled={!result}
              >
                Salvar pedido
              </button>
            </div>

            <details className="calc-details">
              <summary>
                Pedidos salvos{saved.length ? ` (${saved.length})` : ''}
              </summary>
              {saved.length === 0 ? (
                <p className="calc-hint-inline">Nenhum pedido salvo neste navegador.</p>
              ) : (
                <ul className="calc-saved-list">
                  {saved.slice(0, 8).map((o) => (
                    <li key={o.id} className="calc-saved-item">
                      <div>
                        <strong>{o.client}</strong>
                        <span className="hint">
                          {o.sheet} · {o.placed}/{o.requested} ·{' '}
                          {new Date(o.createdAt).toLocaleString('pt-BR')}
                        </span>
                      </div>
                      <div className="calc-saved-actions">
                        <button type="button" className="btn ghost sm" onClick={() => onAbrirSalvo(o.id)}>
                          Abrir
                        </button>
                        <button type="button" className="btn ghost sm" onClick={() => onCopiarSalvo(o.id)}>
                          Copiar
                        </button>
                        <button type="button" className="btn ghost sm" onClick={() => onExcluirSalvo(o.id)}>
                          Excluir
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {savedDetail && (
                <textarea className="calc-textarea" value={savedDetail} readOnly rows={4} />
              )}
            </details>
          </div>
        </aside>

        {/* RIGHT: results */}
        <div className="calc-results">
          {!result ? (
            <section className="calc-panel calc-empty">
              <p className="section-kicker">Resultado</p>
              <h2>Aguardando cálculo</h2>
              <p className="calc-hint-inline">
                Preencha L × A e quantidade à esquerda e clique em Calcular. O layout e o
                orçamento aparecem aqui.
              </p>
            </section>
          ) : (
            <div className="calc-results-sticky">
              {result.mode === 'inv' && (
                <div className="calc-ideal">
                  <span className="section-kicker">Mínimo real</span>
                  <strong className="calc-ideal-val">
                    29 × {fmtCm(result.folha.h)} cm
                  </strong>
                </div>
              )}

              <div className="calc-summary">
                <div className="calc-sumitem">
                  <span className="calc-sumlabel">Pedido</span>
                  <strong>{result.requested}</strong>
                </div>
                <div className="calc-sumitem">
                  <span className="calc-sumlabel">Couberam</span>
                  <strong className="ok">{result.placed.length}</strong>
                </div>
                <div className="calc-sumitem">
                  <span className="calc-sumlabel">Faltaram</span>
                  <strong className={result.missing ? 'warn' : 'ok'}>{result.missing}</strong>
                </div>
                <div className="calc-sumitem">
                  <span className="calc-sumlabel">Folhas</span>
                  <strong>
                    {result.sheets.length}×{fmtCm(result.folha.w)}×{fmtCm(result.folha.h)}
                  </strong>
                </div>
              </div>

              <div className="calc-stats">
                <div className="calc-stat">
                  <span className="calc-slabel">Aprov.</span>
                  <strong>{result.aprov}%</strong>
                </div>
                <div className="calc-stat">
                  <span className="calc-slabel">Rot.</span>
                  <strong>{result.rotCount}</strong>
                </div>
                <div className="calc-stat">
                  <span className="calc-slabel">Esp.</span>
                  <strong>{fmtCm(result.esp)}</strong>
                </div>
                <div className="calc-stat">
                  <span className="calc-slabel">Folha</span>
                  <strong>
                    {fmtCm(result.folha.w)}×{fmtCm(result.folha.h)}
                  </strong>
                </div>
              </div>

              <div className="calc-panel">
                <div className="calc-result-head">
                  <span className="calc-fbadge">
                    {fmtCm(result.folha.w)} × {fmtCm(result.folha.h)} cm
                    {result.sheets.length > 1 ? ` · ${result.sheets.length} folhas` : ''}
                  </span>
                  <div className="calc-result-actions">
                    <button type="button" className="btn primary sm" onClick={onCopyOrcamento}>
                      Copiar orçamento
                    </button>
                    <button type="button" className="btn ghost sm" onClick={onCopyResumo}>
                      Resumo
                    </button>
                  </div>
                </div>

                {result.sheets.length > 1 && (
                  <div className="calc-sheet-tabs">
                    {result.sheets.map((sh, i) => (
                      <button
                        key={sh.sheetIndex}
                        type="button"
                        className={`calc-subtab ${activeSheetIdx === i ? 'on' : ''}`}
                        onClick={() => setActiveSheetIdx(i)}
                      >
                        Folha {sh.sheetIndex} ({sh.placed.length})
                      </button>
                    ))}
                  </div>
                )}

                {previewSheet && (
                  <SheetPreview
                    placed={
                      s2Preview && activeSheetIdx === 0 && result.mode === 'normal'
                        ? s2Preview.placed
                        : previewSheet.placed
                    }
                    fw={result.folha.w}
                    fh={result.folha.h}
                    arts={
                      s2Preview && activeSheetIdx === 0 && result.mode === 'normal'
                        ? s2Preview.arts
                        : previewArts || result.arts
                    }
                  />
                )}
              </div>

              {s2Preview && result.mode === 'normal' && (
                <div className="calc-stats">
                  <div className="calc-stat">
                    <span className="calc-slabel">2ª arte</span>
                    <strong className="ok">{s2Preview.s2Count}</strong>
                  </div>
                  <div className="calc-stat">
                    <span className="calc-slabel">Aprov. total</span>
                    <strong>{s2Preview.aprov}%</strong>
                  </div>
                  <div className="calc-stat">
                    <span className="calc-slabel">Ganho</span>
                    <strong>+{s2Preview.aprov - result.aprov}%</strong>
                  </div>
                  <div className="calc-stat">
                    <span className="calc-slabel">Total</span>
                    <strong>{s2Preview.placed.length}</strong>
                  </div>
                </div>
              )}

              {compRows.length > 0 && (
                <details className="calc-details calc-comp-details">
                  <summary>
                    Comparativo folhas padrão
                    {result.mode === 'normal' ? ' (1ª arte)' : ''}
                  </summary>
                  <div className="calc-table-wrap">
                    <table className="calc-table">
                      <thead>
                        {result.mode === 'inv' ? (
                          <tr>
                            <th>Folha</th>
                            <th>Custo</th>
                            <th>Status</th>
                            <th>Artes</th>
                            <th>Sobra</th>
                          </tr>
                        ) : (
                          <tr>
                            <th>Folha</th>
                            <th>Custo</th>
                            <th>Artes</th>
                            <th>Col×Lin</th>
                            <th>Aprov.</th>
                            <th>Rot.</th>
                          </tr>
                        )}
                      </thead>
                      <tbody>
                        {compRows.map((r) =>
                          result.mode === 'inv' ? (
                            <tr key={r.label}>
                              <td>{r.label}</td>
                              <td>{r.cost}</td>
                              <td className={r.ok ? 'ok' : 'warn'}>
                                {r.ok ? 'Comporta' : 'Não'}
                              </td>
                              <td>
                                {r.total}/{result.requested}
                              </td>
                              <td>{r.sobra}</td>
                            </tr>
                          ) : (
                            <tr key={r.label} className={r.best ? 'best' : ''}>
                              <td>
                                {r.label}
                                {r.best ? <span className="calc-bbadge">MELHOR</span> : null}
                              </td>
                              <td>{r.cost}</td>
                              <td>{r.total}</td>
                              <td>
                                {r.cols}×{r.rows}
                              </td>
                              <td>{r.aprov}%</td>
                              <td>{r.rotated ? 'sim' : 'não'}</td>
                            </tr>
                          ),
                        )}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}
            </div>
          )}
        </div>
      </div>

      {toast && <div className="calc-toast">{toast}</div>}
    </div>
  )
}

function ArtRows({
  arts,
  onChange,
  onRemove,
}: {
  arts: ArtInput[]
  onChange: (id: string, patch: Partial<ArtInput>) => void
  onRemove: (id: string) => void
}) {
  return (
    <div className="calc-arts">
      <div className="calc-art-head" aria-hidden>
        <span>Nome</span>
        <span>L</span>
        <span>A</span>
        <span>Qtd</span>
        <span>Cor</span>
        <span />
      </div>
      {arts.map((a, i) => (
        <div key={a.id} className="calc-art-row">
          <input
            type="text"
            className="calc-art-input"
            value={a.name}
            placeholder={`Arte ${i + 1}`}
            onChange={(e) => onChange(a.id, { name: e.target.value })}
            aria-label={`Nome arte ${i + 1}`}
          />
          <input
            type="number"
            className="calc-art-input"
            value={a.origW}
            min={0.1}
            step={0.1}
            onChange={(e) => onChange(a.id, { origW: Number(e.target.value) })}
            aria-label={`Largura arte ${i + 1}`}
          />
          <input
            type="number"
            className="calc-art-input"
            value={a.origH}
            min={0.1}
            step={0.1}
            onChange={(e) => onChange(a.id, { origH: Number(e.target.value) })}
            aria-label={`Altura arte ${i + 1}`}
          />
          <input
            type="number"
            className="calc-art-input"
            value={a.qty}
            min={1}
            step={1}
            onChange={(e) => onChange(a.id, { qty: Number(e.target.value) })}
            aria-label={`Quantidade arte ${i + 1}`}
          />
          <input
            type="text"
            className="calc-art-input"
            value={a.color}
            placeholder="preto"
            onChange={(e) => onChange(a.id, { color: e.target.value })}
            aria-label={`Cor arte ${i + 1}`}
          />
          <button
            type="button"
            className="calc-rm"
            onClick={() => onRemove(a.id)}
            disabled={arts.length <= 1}
            title="Remover"
            aria-label={`Remover arte ${i + 1}`}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
