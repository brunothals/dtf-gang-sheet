import type { CalcResult } from './types'
import { fmtCm } from './pack'

function artLabel(a: { name: string; idx: number }): string {
  const n = (a.name || '').trim()
  return n || `Arte ${a.idx + 1}`
}

function todayPtBr(): string {
  return new Date().toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Resumo curto (WhatsApp / pedido rápido). */
export function buildResumo(
  result: CalcResult,
  client: string,
  ad: string,
): string {
  const lines = [
    'PEDIDO DTF UV',
    `Cliente: ${client.trim() || 'não informado'}`,
    `Anúncio da venda: ${ad.trim() || 'não informado'}`,
    `Folha: ${fmtCm(result.folha.w)} x ${fmtCm(result.folha.h)} cm`,
    '',
    `Total solicitado: ${result.requested} artes`,
    `Encaixadas: ${result.placed.length}`,
    result.missing > 0 ? `Faltaram: ${result.missing}` : null,
    `Aproveitamento: ${result.aprov}%`,
    `Rotacionadas: ${result.rotCount || 0}`,
    '',
    'ARTES',
  ].filter((x): x is string => x != null)

  const counts: Record<number, number> = {}
  result.placed.forEach((p) => {
    counts[p.idx] = (counts[p.idx] || 0) + 1
  })

  result.arts.forEach((a) => {
    const color = a.color || 'não informado'
    lines.push(
      `${a.idx + 1}. ${artLabel(a)} | ${fmtCm(a.origW)}×${fmtCm(a.origH)} cm | cor: ${color} | qtd: ${counts[a.idx] || 0}/${a.qty}`,
    )
  })

  if (result.s2w > 0 && result.s2h > 0) {
    lines.push(
      `2ª arte: ${fmtCm(result.s2w)}×${fmtCm(result.s2h)} cm | cor: ${result.s2Color || 'não informado'} | qtd encaixada: ${result.s2Placed}`,
    )
  }

  lines.push('')
  lines.push('Conferir medidas, cores e quantidade antes da impressão.')
  return lines.join('\n')
}

/**
 * Orçamento formal pronto para cliente / WhatsApp.
 * Inclui encaixe por folha quando há resultado de packing multi-folha.
 */
export function buildOrcamentoCompleto(
  result: CalcResult,
  client: string,
  ad: string,
): string {
  const clientLine = client.trim() || 'não informado'
  const lines: string[] = [
    `ORÇAMENTO DTF UV — Cliente: ${clientLine}`,
    `Data: ${todayPtBr()}`,
  ]

  if (ad.trim()) lines.push(`Anúncio / referência: ${ad.trim()}`)

  lines.push('')
  lines.push('Itens:')

  // Contagem por arte e por folha
  const sheets = result.sheets.length > 0 ? result.sheets : [
    { sheetIndex: 1, placed: result.placed, heightCm: result.folha.h },
  ]

  result.arts.forEach((a) => {
    const color = (a.color || '').trim() || 'não informado'
    const perSheet: string[] = []
    let totalPlaced = 0

    for (const sh of sheets) {
      const n = sh.placed.filter((p) => p.idx === a.idx).length
      if (n > 0) {
        perSheet.push(`${n} na folha ${sh.sheetIndex}`)
        totalPlaced += n
      }
    }

    const encaixe =
      perSheet.length > 0
        ? perSheet.join(', ')
        : '0 (não encaixou nesta configuração)'

    lines.push(
      `${a.idx + 1}. ${artLabel(a)} | cor: ${color} | ${fmtCm(a.origW)}×${fmtCm(a.origH)} cm | qtd: ${a.qty} | encaixe: ${encaixe}`,
    )

    if (totalPlaced < a.qty) {
      lines.push(`   → faltam ${a.qty - totalPlaced} un. nesta configuração de folhas`)
    }
  })

  if (result.s2w > 0 && result.s2h > 0 && result.s2Placed > 0) {
    lines.push(
      `• 2ª arte (espaço restante) | cor: ${result.s2Color || 'não informado'} | ${fmtCm(result.s2w)}×${fmtCm(result.s2h)} cm | encaixadas: ${result.s2Placed}`,
    )
  }

  lines.push('')

  if (result.mode === 'inv') {
    lines.push(
      `Folha ideal: 1 × ${fmtCm(result.folha.w)}×${fmtCm(result.folha.h)} cm (largura fixa 29 cm)`,
    )
  } else if (sheets.length === 1) {
    lines.push(
      `Folhas: 1 × ${fmtCm(result.folha.w)}×${fmtCm(result.folha.h)} cm`,
    )
    if (sheets[0].heightCm < result.folha.h - 0.05) {
      lines.push(
        `Altura útil aproximada: ${fmtCm(sheets[0].heightCm)} cm`,
      )
    }
  } else {
    lines.push(
      `Folhas: ${sheets.length} × ${fmtCm(result.folha.w)}×${fmtCm(result.folha.h)} cm`,
    )
    sheets.forEach((sh) => {
      lines.push(
        `  · Folha ${sh.sheetIndex}: ${sh.placed.length} artes | útil ~${fmtCm(sh.heightCm)} cm`,
      )
    })
  }

  lines.push(`Total solicitado: ${result.requested} artes`)
  lines.push(`Total encaixado: ${result.placed.length}`)
  if (result.missing > 0) lines.push(`Não encaixadas: ${result.missing}`)
  lines.push(`Aproveitamento (folha principal): ${result.aprov}%`)
  if (result.rotCount > 0) {
    lines.push(`Rotacionadas (90°): ${result.rotCount}`)
  }
  lines.push(`Espaçamento entre artes: ${fmtCm(result.esp)} cm`)

  lines.push('')
  lines.push('Conferir medidas, cores e quantidade antes da impressão.')

  return lines.join('\n')
}
