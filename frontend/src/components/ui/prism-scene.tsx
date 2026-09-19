import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Edges, Environment, Float, Lightformer, MeshTransmissionMaterial } from "@react-three/drei";
import * as THREE from "three";
import type { MotionValue } from "motion/react";

export type PrismQuality = "high" | "medium" | "low";

/** Quality tiers: cheaper transmission buffer, fewer samples, fewer motes, lower DPR on weaker devices. */
export const QUALITY = {
  high: { dpr: [1, 2] as [number, number], resolution: 512, samples: 10, chroma: 0.5, blur: 0.3, motes: 220, backside: true, aa: true },
  medium: { dpr: [1, 1.5] as [number, number], resolution: 384, samples: 6, chroma: 0.3, blur: 0.2, motes: 110, backside: true, aa: true },
  low: { dpr: [1, 1.25] as [number, number], resolution: 192, samples: 3, chroma: 0.1, blur: 0.1, motes: 45, backside: false, aa: false },
} as const;

export interface PrismSceneProps {
  quality: PrismQuality;
  /** "never" while off-screen, "demand" for reduced motion (a single still frame), otherwise "always". */
  frameloop: "always" | "demand" | "never";
  reduced: boolean;
  /** 0..1 scroll progress of the hero section. */
  progress: MotionValue<number>;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function Crystal({ quality, reduced, progress }: Pick<PrismSceneProps, "quality" | "reduced" | "progress">) {
  const q = QUALITY[quality];
  const group = useRef<THREE.Group>(null);
  const geometry = useMemo(() => new THREE.IcosahedronGeometry(1.45, 1), []);
  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame((state, dt) => {
    const g = group.current;
    if (!g || reduced) return;
    const p = progress.get();
    const px = state.pointer.x;
    const py = state.pointer.y;
    const ty = state.clock.elapsedTime * 0.16 + px * 0.55 + p * 1.8;
    const tx = -py * 0.35 + p * 0.5;
    g.rotation.y = THREE.MathUtils.damp(g.rotation.y, ty, 3, dt);
    g.rotation.x = THREE.MathUtils.damp(g.rotation.x, tx, 3, dt);
    const s = THREE.MathUtils.damp(g.scale.x, 1 - p * 0.2, 4, dt);
    g.scale.setScalar(s);
  });

  return (
    <Float speed={reduced ? 0 : 1.1} rotationIntensity={0} floatIntensity={reduced ? 0 : 0.5}>
      <group ref={group} rotation={[0.35, 0.6, 0]}>
        <mesh geometry={geometry}>
          <MeshTransmissionMaterial
            flatShading
            transmission={1}
            thickness={1.3}
            roughness={0.05}
            ior={1.52}
            chromaticAberration={q.chroma}
            anisotropicBlur={q.blur}
            distortion={0.07}
            distortionScale={0.25}
            temporalDistortion={reduced ? 0 : 0.015}
            samples={q.samples}
            resolution={q.resolution}
            backside={q.backside}
            backsideThickness={0.5}
            color="#eafcff"
            attenuationColor="#7dd3fc"
            attenuationDistance={3}
            envMapIntensity={1.3}
          />
          <Edges threshold={12} color="#a5f3fc" />
        </mesh>
      </group>
    </Float>
  );
}

/** Light bars behind the crystal: the only thing there is to refract, and a soft visual anchor. */
function LightRig() {
  return (
    <group position={[0, 0, -2.6]}>
      <mesh position={[-2.4, 0.6, 0]} rotation={[0, 0, 0.5]}>
        <planeGeometry args={[0.12, 4.6]} />
        <meshBasicMaterial color="#22d3ee" toneMapped={false} transparent opacity={0.6} />
      </mesh>
      <mesh position={[0.2, -0.2, 0.2]} rotation={[0, 0, -0.35]}>
        <planeGeometry args={[0.08, 4.2]} />
        <meshBasicMaterial color="#ffffff" toneMapped={false} transparent opacity={0.6} />
      </mesh>
      <mesh position={[2.2, 0.4, 0]} rotation={[0, 0, 0.9]}>
        <planeGeometry args={[0.16, 4.6]} />
        <meshBasicMaterial color="#3b82f6" toneMapped={false} transparent opacity={0.6} />
      </mesh>
      <mesh position={[0, 0, -0.4]}>
        <torusGeometry args={[2.5, 0.014, 8, 96]} />
        <meshBasicMaterial color="#67e8f9" toneMapped={false} transparent opacity={0.4} />
      </mesh>
    </group>
  );
}

function Motes({ count, reduced }: { count: number; reduced: boolean }) {
  const ref = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const rand = mulberry32(7);
    const a = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = 2 + rand() * 3.2;
      const th = rand() * Math.PI * 2;
      a[i * 3] = Math.cos(th) * r;
      a[i * 3 + 1] = (rand() - 0.5) * 6;
      a[i * 3 + 2] = Math.sin(th) * r * 0.6 - 1;
    }
    return a;
  }, [count]);
  useFrame((_, dt) => {
    if (ref.current && !reduced) ref.current.rotation.y += dt * 0.03;
  });
  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.028} color="#a5f3fc" transparent opacity={0.55} sizeAttenuation depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  );
}

/** Re-render the still frame after a resize when running on demand (reduced motion). */
function InvalidateOnResize() {
  const { invalidate, size } = useThree();
  useEffect(() => {
    invalidate();
  }, [size.width, size.height, invalidate]);
  return null;
}

export default function PrismScene({ quality, frameloop, reduced, progress }: PrismSceneProps) {
  const q = QUALITY[quality];
  return (
    <Canvas
      dpr={q.dpr}
      frameloop={frameloop}
      camera={{ position: [0, 0, 7], fov: 32 }}
      gl={{ alpha: true, antialias: q.aa, powerPreference: "high-performance" }}
      onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
      style={{ background: "transparent" }}
    >
      <ambientLight intensity={0.25} />
      <spotLight position={[4, 5, 5]} angle={0.4} penumbra={1} intensity={60} color="#a5f3fc" />
      {/* Procedural studio lighting: no HDR download, rendered once (frames=1). */}
      <Environment resolution={128} frames={1}>
        <Lightformer form="rect" intensity={5} position={[-5, 2, 3]} scale={[7, 1.2, 1]} color="#67e8f9" />
        <Lightformer form="rect" intensity={4} position={[5, -1, 3]} scale={[6, 1, 1]} color="#93c5fd" />
        <Lightformer form="ring" intensity={3} position={[0, 4, -2]} scale={3} color="#ffffff" />
      </Environment>
      <LightRig />
      <Crystal quality={quality} reduced={reduced} progress={progress} />
      <Motes count={q.motes} reduced={reduced} />
      {reduced && <InvalidateOnResize />}
    </Canvas>
  );
}
