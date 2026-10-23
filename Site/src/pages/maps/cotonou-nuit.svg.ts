import { citySvg } from '@/lib/map-svg'

export const GET = () => new Response(citySvg('dark'), { headers: { 'Content-Type': 'image/svg+xml' } })
