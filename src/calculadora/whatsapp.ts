import { bestFit } from './pack'

export const WA_PRICES_KEY = 'dtfuv_wa_prices_v1'

export type WaSheet = { id: string; w: number; h: number }

export const WA_SHEETS: WaSheet[] = [29, 41].flatMap((w) =>
  [21, 42, 50, 100].map((h) => ({ id: `${w}x${h}`, w, h })),
)

export const WA_DEFAULT_PRICES: Record<string, string> = { '29x21': '39,00' }

export function parseBRL(v: string | undefined): number | null {
  if (!v) return null
  const n = Number(v.trim().replace(/\s|R\$/g, '').replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? n : null
}

export function brl(n: number): string {
  return 'R$ ' + n.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

function cm(n: number): string {
  return String(Math.round(n * 10) / 10).replace('.', ',')
}

export function loadWaPrices(): Record<string, string> {
  try {
    const raw = localStorage.getItem(WA_PRICES_KEY)
    if (raw) return { ...WA_DEFAULT_PRICES, ...JSON.parse(raw) }
  } catch {
    /* ignore */
  }
  return { ...WA_DEFAULT_PRICES }
}

export function saveWaPrices(p: Record<string, string>): void {
  try {
    localStorage.setItem(WA_PRICES_KEY, JSON.stringify(p))
  } catch {
    /* ignore */
  }
}

/**
 * Texto p/ WhatsApp: frase da folha de referência (29×21) + tabela monoespaçada
 * das outras folhas. Linhas 41 cm só entram se tiverem preço.
 */
export function buildWhatsAppText(
  artW: number,
  artH: number,
  esp: number,
  useRot: boolean,
  prices: Record<string, string>,
): string {
  const rows = WA_SHEETS.map((s) => {
    const qty = bestFit(artW, artH, s.w, s.h, esp, useRot).total
    const price = parseBRL(prices[s.id])
    return { ...s, qty, price, unit: price != null && qty > 0 ? price / qty : null }
  })
  const art = `${cm(artW)}×${cm(artH)} cm`
  const ref = rows[0]
  const lines: string[] = []
  if (ref.qty > 0) {
    const pr = ref.price != null ? ` (${brl(ref.price)} + frete)` : ''
    const un = ref.unit != null ? `, sai ${brl(ref.unit)} por unidade` : ''
    lines.push(`Na folha ${ref.w}×${ref.h} cm${pr} cabem ${ref.qty} artes de ${art}${un}.`)
  } else {
    lines.push(`A arte de ${art} não cabe na folha ${ref.w}×${ref.h} cm.`)
  }
  const others = rows.slice(1).filter((r) => r.w === 29 || r.price != null)
  if (others.length) {
    const head = ['Folha', 'Qtd', 'Preço', 'R$/un']
    const body = others.map((r) => [
      `${r.w}×${r.h}`,
      String(r.qty),
      r.price != null ? brl(r.price) : '—',
      r.unit != null ? brl(r.unit) : '—',
    ])
    const widths = head.map((h, i) => Math.max(h.length, ...body.map((b) => b[i].length)))
    const fmt = (c: string[]) =>
      c.map((v, i) => (i === 0 ? v.padEnd(widths[i]) : v.padStart(widths[i]))).join('  ')
    lines.push('', 'Outras opções:', '```', fmt(head), ...body.map(fmt), '```')
  }
  lines.push('', 'Valores + frete. Medidas com espaçamento entre as artes.')
  return lines.join('\n')
}
