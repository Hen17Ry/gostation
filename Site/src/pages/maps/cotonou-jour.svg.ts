import { citySvg } from '@/lib/map-svg'

export const GET = () => new Response(citySvg('light'), { headers: { 'Content-Type': 'image/svg+xml' } })
