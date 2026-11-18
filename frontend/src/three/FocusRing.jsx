import React, { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { DoubleSide } from 'three';

const COLORS = {
  light: { accent: '#ff5b1f', track: '#13254a' },
  dark: { accent: '#ff6a33', track: '#ffffff' },
};

function Ring({ progress, running, still, accent, track }) {
  const group = useRef();
  const bead = useRef();
  const arc = Math.max(0.0001, Math.min(1, progress)) * Math.PI * 2;

  useFrame((state, delta) => {
    const g = group.current;
    if (!g) return;
    // Tilt toward the pointer with a critically damped approach: it starts from wherever the ring is
    // now, so a new pointer position simply re-targets the motion instead of restarting it.
    const ease = 1 - Math.exp(-delta * 6);
    const targetX = still ? 0 : -state.pointer.y * 0.35;
    const targetY = still ? 0 : state.pointer.x * 0.45;
    g.rotation.x += (targetX - g.rotation.x) * ease;
    g.rotation.y += (targetY - g.rotation.y) * ease;
    if (bead.current) {
      const pulse = running && !still ? 1 + Math.sin(state.clock.elapsedTime * 2.4) * 0.12 : 1;
      bead.current.scale.setScalar(pulse);
    }
  });

  // The arc starts at 12 o'clock and runs clockwise: mirror on x, then rotate a quarter turn back.
  return <group ref={group}>
    <mesh>
      <torusGeometry args={[1, 0.05, 24, 180]}/>
      <meshPhysicalMaterial color={track} transparent opacity={0.22} roughness={0.15} clearcoat={1} clearcoatRoughness={0.1}/>
    </mesh>
    <mesh rotation={[0, 0, -Math.PI / 2]} scale={[-1, 1, 1]}>
      <torusGeometry args={[1, 0.085, 28, 180, arc]}/>
      <meshPhysicalMaterial color={accent} emissive={accent} emissiveIntensity={0.55} roughness={0.3} clearcoat={1} side={DoubleSide}/>
    </mesh>
    <mesh ref={bead} position={[Math.sin(arc), Math.cos(arc), 0.02]}>
      <sphereGeometry args={[0.13, 32, 32]}/>
      <meshStandardMaterial color="#ffffff" emissive={accent} emissiveIntensity={1.4} roughness={0.2}/>
    </mesh>
  </group>;
}

export default function FocusRing({ progress, running, still, theme }) {
  const colors = COLORS[theme] || COLORS.light;
  return <Canvas
    className="focus-ring-canvas"
    dpr={[1, 2]}
    frameloop={still ? 'demand' : 'always'}
    camera={{ position: [0, 0, 3.1], fov: 45 }}
    gl={{ alpha: true, antialias: true, powerPreference: 'low-power' }}
    aria-hidden="true"
  >
    <ambientLight intensity={0.7}/>
    <directionalLight position={[2, 3, 4]} intensity={2.2}/>
    <pointLight position={[-2, -1, 2]} intensity={6} color={colors.accent}/>
    <Ring progress={progress} running={running} still={still} accent={colors.accent} track={colors.track}/>
  </Canvas>;
}
