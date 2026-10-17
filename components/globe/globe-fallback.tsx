import { fallbackBackgroundX } from '@/lib/geo'
import { cn } from '@/lib/utils'

interface GlobeFallbackProps {
  centerLng: number
  className?: string
}

/**
 * Static, WebGL-free globe used as the loading poster, the reduced-motion view,
 * and the fallback when WebGL is unavailable or the context is lost.
 */
export function GlobeFallback({ centerLng, className }: GlobeFallbackProps) {
  return (
    <div
      aria-hidden="true"
      className={cn('relative aspect-square w-full rounded-full', className)}
      style={{
        boxShadow:
          '0 0 0 1px rgb(212 180 122 / 0.18), 0 0 80px 4px rgb(212 180 122 / 0.12), inset 0 0 60px rgb(0 0 0 / 0.6)',
      }}
    >
      <div
        className="absolute inset-0 rounded-full"
        style={{
          backgroundImage: 'url(/textures/earth-day-1k.webp)',
          backgroundSize: '200% 100%',
          backgroundRepeat: 'repeat-x',
          backgroundPositionX: fallbackBackgroundX(centerLng),
          backgroundPositionY: 'center',
          filter: 'saturate(0.85) brightness(0.8)',
        }}
      />
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background:
            'radial-gradient(circle at 34% 30%, rgb(255 236 200 / 0.18), transparent 45%), radial-gradient(circle at 50% 50%, transparent 52%, rgb(11 10 9 / 0.85) 74%)',
        }}
      />
    </div>
  )
}
