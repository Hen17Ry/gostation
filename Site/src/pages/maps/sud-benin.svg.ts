import { regionSvg } from '@/lib/map-svg'

export const GET = () => new Response(regionSvg(), { headers: { 'Content-Type': 'image/svg+xml' } })
