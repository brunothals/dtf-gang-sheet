import { useEffect, useRef } from 'react'
import type { ArtDef, PlacedRect } from './types'
import { COLORS } from './types'
import { fmtCm } from './pack'

type Props = {
  placed: PlacedRect[]
  fw: number
  fh: number
  arts: ArtDef[]
  maxWidth?: number
  maxHeight?: number
}

export function drawSheet(
  canvas: HTMLCanvasElement,
  placed: PlacedRect[],
  fw: number,
  fh: number,
  maxW: number,
  maxH: number,
) {
  const scale = Math.min(maxW / fw, maxH / fh)
  canvas.width = Math.round(fw * scale)
  canvas.height = Math.round(fh * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  ctx.fillStyle = '#0f172a'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  ctx.strokeStyle = 'rgba(255,255,255,0.04)'
  ctx.lineWidth = 0.5
  const gs = scale * 5
  for (let x = 0; x <= canvas.width; x += gs) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, canvas.height)
    ctx.stroke()
  }
  for (let y = 0; y <= canvas.height; y += gs) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(canvas.width, y)
    ctx.stroke()
  }

  placed.forEach((p) => {
    const col = COLORS[p.idx % COLORS.length]
    const px = Math.round(p.x * scale)
    const py = Math.round(p.y * scale)
    const pw = Math.round(p.w * scale)
    const ph = Math.round(p.h * scale)

    ctx.fillStyle = col + '28'
    ctx.fillRect(px, py, pw, ph)
    ctx.strokeStyle = col
    ctx.lineWidth = 1.5
    ctx.strokeRect(px + 0.75, py + 0.75, pw - 1.5, ph - 1.5)

    if (pw > 22 && ph > 14) {
      ctx.fillStyle = col
      const fs = Math.max(9, Math.min(12, Math.round(Math.min(pw, ph) / 4.5)))
      ctx.font = `600 ${fs}px Inter, system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(
        `${fmtCm(p.w)}×${fmtCm(p.h)}${p.rotated ? ' r' : ''}`,
        px + pw / 2,
        py + ph / 2,
      )
    }
  })

  ctx.strokeStyle = 'rgba(167,139,250,0.35)'
  ctx.lineWidth = 1
  ctx.strokeRect(0.5, 0.5, canvas.width - 1, canvas.height - 1)
}

export default function SheetPreview({
  placed,
  fw,
  fh,
  arts,
  maxWidth = 820,
  maxHeight = 480,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    const maxW = Math.min(maxWidth, typeof window !== 'undefined' ? window.innerWidth - 50 : maxWidth)
    drawSheet(c, placed, fw, fh, maxW, maxHeight)
  }, [placed, fw, fh, maxWidth, maxHeight])

  const counts: Record<number, number> = {}
  placed.forEach((p) => {
    counts[p.idx] = (counts[p.idx] || 0) + 1
  })

  return (
    <div className="calc-preview">
      <canvas ref={canvasRef} className="calc-canvas" />
      <div className="calc-legend">
        {arts.map((a, i) => {
          const col = COLORS[i % COLORS.length]
          const cp = counts[i] || 0
          const label = (a.name || '').trim() || `Arte ${i + 1}`
          return (
            <div key={i} className="calc-leg">
              <span
                className="calc-legdot"
                style={{ background: col + '40', borderColor: col }}
              />
              {label} · {fmtCm(a.origW)}×{fmtCm(a.origH)} cm · {a.color || 'sem cor'} · {cp} enc.
            </div>
          )
        })}
      </div>
    </div>
  )
}
