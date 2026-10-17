'use client'

import { Canvas, useFrame, useLoader, type ThreeEvent } from '@react-three/fiber'
import { Suspense, useEffect, useMemo, useRef, type MutableRefObject } from 'react'
import * as THREE from 'three'
import { DESTINATIONS } from '@/lib/destinations'
import { MAX_TILT, focusRotation, latLngToVector, shortestAngle } from '@/lib/geo'
import { getIstLighting, previewDate } from '@/lib/ist-lighting'
import { atmosphereFragment, atmosphereVertex, earthFragment, earthVertex } from './shaders'

export interface GlobeControl {
  rotation: { x: number; y: number }
  target: { x: number; y: number } | null
  velocity: { x: number; y: number }
  dragging: boolean
  hovering: boolean
}

interface GlobeCanvasProps {
  control: MutableRefObject<GlobeControl>
  selectedIso: string | null
  quality: 'high' | 'low'
  active: boolean
  onSelect: (iso2: string) => void
  onReady: () => void
  onContextLost: () => void
}

const GOLD = new THREE.Color('#d4b47a')
const GOLD_BRIGHT = new THREE.Color('#f1d9a6')

export default function GlobeCanvas({
  control,
  selectedIso,
  quality,
  active,
  onSelect,
  onReady,
  onContextLost,
}: GlobeCanvasProps) {
  return (
    <Canvas
      frameloop={active ? 'always' : 'never'}
      dpr={quality === 'high' ? [1, 1.75] : [1, 1.4]}
      camera={{ position: [0, 0, 3.95], fov: 36, near: 0.1, far: 20 }}
      gl={{ antialias: quality === 'high', alpha: true, powerPreference: 'default' }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping
        gl.toneMappingExposure = 1.05
        gl.domElement.addEventListener(
          'webglcontextlost',
          (event) => {
            event.preventDefault()
            onContextLost()
          },
          { once: true },
        )
      }}
    >
      <Suspense fallback={null}>
        <Earth
          control={control}
          selectedIso={selectedIso}
          quality={quality}
          onSelect={onSelect}
          onReady={onReady}
        />
      </Suspense>
    </Canvas>
  )
}

function Earth({
  control,
  selectedIso,
  quality,
  onSelect,
  onReady,
}: Pick<GlobeCanvasProps, 'control' | 'selectedIso' | 'quality' | 'onSelect' | 'onReady'>) {
  const size = quality === 'high' ? '2k' : '1k'
  const [day, night] = useLoader(THREE.TextureLoader, [
    `/textures/earth-day-${size}.webp`,
    `/textures/earth-night-${size}.webp`,
  ])
  const group = useRef<THREE.Group>(null)
  const lightingTick = useRef(0)

  useMemo(() => {
    for (const t of [day, night]) {
      t.colorSpace = THREE.SRGBColorSpace
      t.anisotropy = quality === 'high' ? 4 : 1
    }
  }, [day, night, quality])

  const initial = useMemo(() => getIstLighting(previewDate()), [])
  const uniforms = useMemo(
    () => ({
      uDay: { value: day },
      uNight: { value: night },
      uLightDir: { value: new THREE.Vector3(-0.6, 0.35, 0.75).normalize() },
      uLightColor: { value: new THREE.Color(...initial.lightColor) },
      uLightIntensity: { value: initial.lightIntensity },
      uAmbient: { value: initial.ambient },
      uNightLights: { value: initial.nightLights },
      uAtmosphere: { value: new THREE.Color(...initial.atmosphere) },
    }),
    [day, night, initial],
  )
  const atmoUniforms = useMemo(
    () => ({
      uAtmosphere: { value: new THREE.Color(...initial.atmosphere) },
      uStrength: { value: 0.75 },
    }),
    [initial],
  )

  useEffect(() => {
    onReady()
  }, [onReady])

  useEffect(() => {
    const destination = DESTINATIONS.find((d) => d.iso2 === selectedIso)
    if (destination) {
      control.current.target = focusRotation(destination.marker.lat, destination.marker.lng)
    }
  }, [selectedIso, control])

  useFrame((_, delta) => {
    const c = control.current
    const dt = Math.min(delta, 0.05)

    if (!c.dragging) {
      if (c.target) {
        const ease = 1 - Math.pow(0.002, dt)
        c.rotation.y += shortestAngle(c.rotation.y, c.target.y) * ease
        c.rotation.x += (c.target.x - c.rotation.x) * ease
      } else {
        c.rotation.y += c.velocity.y
        c.rotation.x += c.velocity.x
        c.velocity.x *= Math.pow(0.05, dt)
        c.velocity.y *= Math.pow(0.05, dt)
        if (!c.hovering && Math.abs(c.velocity.y) < 0.0005) c.rotation.y += dt * 0.045
      }
    }
    c.rotation.x = Math.max(-MAX_TILT, Math.min(MAX_TILT, c.rotation.x))
    group.current?.rotation.set(c.rotation.x, c.rotation.y, 0)

    // Re-sample IST lighting a few times per second and ease toward it.
    lightingTick.current += dt
    if (lightingTick.current > 0.5) {
      lightingTick.current = 0
      const next = getIstLighting(previewDate())
      const k = 0.25
      uniforms.uLightColor.value.lerp(new THREE.Color(...next.lightColor), k)
      uniforms.uLightIntensity.value += (next.lightIntensity - uniforms.uLightIntensity.value) * k
      uniforms.uAmbient.value += (next.ambient - uniforms.uAmbient.value) * k
      uniforms.uNightLights.value += (next.nightLights - uniforms.uNightLights.value) * k
      uniforms.uAtmosphere.value.lerp(new THREE.Color(...next.atmosphere), k)
      atmoUniforms.uAtmosphere.value.copy(uniforms.uAtmosphere.value)
      uniforms.uLightDir.value
        .set(-0.62, Math.sin(next.elevation) * 0.9, 0.72)
        .normalize()
    }
  })

  const segments = quality === 'high' ? 96 : 64

  return (
    <>
      <group ref={group}>
        <mesh>
          <sphereGeometry args={[1, segments, segments]} />
          <shaderMaterial
            vertexShader={earthVertex}
            fragmentShader={earthFragment}
            uniforms={uniforms}
          />
        </mesh>
        {DESTINATIONS.map((d) => (
          <Marker
            key={d.iso2}
            iso2={d.iso2}
            lat={d.marker.lat}
            lng={d.marker.lng}
            selected={d.iso2 === selectedIso}
            onSelect={onSelect}
          />
        ))}
      </group>
      <mesh scale={1.14}>
        <sphereGeometry args={[1, 48, 48]} />
        <shaderMaterial
          vertexShader={atmosphereVertex}
          fragmentShader={atmosphereFragment}
          uniforms={atmoUniforms}
          side={THREE.BackSide}
          blending={THREE.AdditiveBlending}
          transparent
          depthWrite={false}
        />
      </mesh>
    </>
  )
}

function Marker({
  iso2,
  lat,
  lng,
  selected,
  onSelect,
}: {
  iso2: string
  lat: number
  lng: number
  selected: boolean
  onSelect: (iso2: string) => void
}) {
  const ring = useRef<THREE.Mesh>(null)
  const position = useMemo(() => latLngToVector(lat, lng, 1.004), [lat, lng])
  const orientation = useMemo(() => {
    const q = new THREE.Quaternion()
    q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...position).normalize())
    return q
  }, [position])

  useFrame(({ clock }) => {
    if (!ring.current) return
    const material = ring.current.material as THREE.MeshBasicMaterial
    if (selected) {
      const pulse = (Math.sin(clock.elapsedTime * 2.4) + 1) / 2
      ring.current.scale.setScalar(1.4 + pulse * 0.5)
      material.opacity = 0.55 + pulse * 0.35
    } else {
      ring.current.scale.setScalar(1)
      material.opacity = 0.5
    }
  })

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    if (event.delta > 6) return
    onSelect(iso2)
  }

  return (
    <group position={position} quaternion={orientation}>
      <mesh>
        <circleGeometry args={[selected ? 0.016 : 0.011, 20]} />
        <meshBasicMaterial color={selected ? GOLD_BRIGHT : GOLD} toneMapped={false} />
      </mesh>
      <mesh ref={ring}>
        <ringGeometry args={[0.022, 0.027, 32]} />
        <meshBasicMaterial color={GOLD} transparent toneMapped={false} depthWrite={false} />
      </mesh>
      <mesh
        onClick={handleClick}
        onPointerOver={(e) => {
          e.stopPropagation()
          document.body.style.cursor = 'pointer'
        }}
        onPointerOut={() => {
          document.body.style.cursor = ''
        }}
      >
        <circleGeometry args={[0.06, 12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  )
}
