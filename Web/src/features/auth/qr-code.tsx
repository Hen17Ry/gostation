import { useMemo } from 'react'
import { encode } from 'uqr'

/**
 * QR code de l'URI otpauth://, généré dans le navigateur : le secret TOTP ne part jamais vers un
 * service tiers. Modules sombres sur fond blanc dans les deux thèmes (lisible par les scanners).
 */
export default function QrCode({ value, label, className }: { value: string; label: string; className?: string }) {
  const { d, size } = useMemo(() => {
    const qr = encode(value, { ecc: 'M', border: 0 })
    let path = ''
    qr.data.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark) path += `M${x} ${y}h1v1h-1z`
      }),
    )
    return { d: path, size: qr.size }
  }, [value])
  const q = 2 // marge (zone de silence) en modules, complétée par le padding du cadre
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`${-q} ${-q} ${size + 2 * q} ${size + 2 * q}`}
      shapeRendering="crispEdges"
      className={className}
    >
      <rect x={-q} y={-q} width={size + 2 * q} height={size + 2 * q} fill="#ffffff" />
      <path d={d} fill="#0c0a09" />
    </svg>
  )
}
