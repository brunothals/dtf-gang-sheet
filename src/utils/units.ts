/** Conversão consistente: px = cm * dpi / 2.54 */

export function cmToPx(cm: number, dpi: number): number {
  return (cm * dpi) / 2.54
}

export function mmToPx(mm: number, dpi: number): number {
  return (mm * dpi) / 25.4
}

export function pxToCm(px: number, dpi: number): number {
  return (px * 2.54) / dpi
}

export function roundPx(n: number): number {
  return Math.max(1, Math.round(n))
}

/**
 * Modo "lado maior": o maior lado da arte (após trim) vira maxSideCm;
 * o outro lado proporcional.
 */
export function computePrintSizeCm(
  trimmedW: number,
  trimmedH: number,
  maxSideCm: number,
): { widthCm: number; heightCm: number } {
  if (trimmedW <= 0 || trimmedH <= 0) {
    return { widthCm: maxSideCm, heightCm: maxSideCm }
  }
  if (trimmedW >= trimmedH) {
    return {
      widthCm: maxSideCm,
      heightCm: (trimmedH / trimmedW) * maxSideCm,
    }
  }
  return {
    widthCm: (trimmedW / trimmedH) * maxSideCm,
    heightCm: maxSideCm,
  }
}
