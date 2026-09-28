type Props = {
  size?: number
  className?: string
}

/** Marca DTF: folha + camadas UV. */
export default function BrandMark({ size = 32, className }: Props) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <rect x="2" y="4" width="20" height="24" rx="3" fill="url(#bm-sheet)" />
      <rect
        x="6"
        y="8"
        width="20"
        height="20"
        rx="3"
        fill="url(#bm-sheet2)"
        opacity="0.95"
      />
      <rect x="10" y="12" width="16" height="16" rx="3" fill="url(#bm-top)" />
      <circle cx="18" cy="20" r="3.5" fill="#fff" opacity="0.9" />
      <circle cx="18" cy="20" r="1.6" fill="#7c3aed" />
      <defs>
        <linearGradient id="bm-sheet" x1="2" y1="4" x2="22" y2="28" gradientUnits="userSpaceOnUse">
          <stop stopColor="#6366f1" />
          <stop offset="1" stopColor="#4f46e5" />
        </linearGradient>
        <linearGradient id="bm-sheet2" x1="6" y1="8" x2="26" y2="28" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8b5cf6" />
          <stop offset="1" stopColor="#6d28d9" />
        </linearGradient>
        <linearGradient id="bm-top" x1="10" y1="12" x2="26" y2="28" gradientUnits="userSpaceOnUse">
          <stop stopColor="#a78bfa" />
          <stop offset="1" stopColor="#7c3aed" />
        </linearGradient>
      </defs>
    </svg>
  )
}
