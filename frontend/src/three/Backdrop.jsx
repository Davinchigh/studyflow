import React, { useEffect, useRef, useState } from 'react';
import { ShaderGradient, ShaderGradientCanvas } from '@shadergradient/react';

// The sky the board floats over. Geometry follows ShaderGradient's "Halo" preset (a tilted plane
// that fills the frame head-on); colours are ours. Dark: an ember of signal orange rising through
// ink and harbour teal. Light: the same ember softened to peach over ice.
// Keep these in step with the CSS fallback in styles.css (.backdrop-fallback).
const SKIES = {
  // In this geometry color3 is the bright diagonal band, color2 one flank, color1 the far corner.
  // The shader saturates strongly, so inputs are muted; they render as the intended hues.
  // No film grain: at this low contrast it reads as speckle noise, not texture.
  light: {
    idle: { color1: '#efbca7', color2: '#cbd9f4', color3: '#f1eff9', brightness: 1.15 },
    focus: { color1: '#a9c9ec', color2: '#c4d3f3', color3: '#eef2fb', brightness: 1.15 },
  },
  dark: {
    idle: { color1: '#a8694f', color2: '#1f2c48', color3: '#3f6f8a', brightness: 1.05 },
    focus: { color1: '#2c5f87', color2: '#18233f', color3: '#3a7890', brightness: 1.05 },
  },
};

// While a focus block runs, the warm corner cools and the motion slows: the room goes quiet.
export default function Backdrop({ theme, still, focus }) {
  const sky = (SKIES[theme] || SKIES.light)[focus ? 'focus' : 'idle'];
  const holder = useRef(null);
  const [lost, setLost] = useState(false);
  // If the browser drops the WebGL context the canvas freezes on its last frame, which may no longer
  // match the theme. Step aside and let the CSS sky underneath show instead.
  useEffect(() => {
    const onLost = () => setLost(true);
    const node = holder.current;
    node?.addEventListener('webglcontextlost', onLost, true);
    return () => node?.removeEventListener('webglcontextlost', onLost, true);
  }, []);
  if (lost) return null;
  return <div ref={holder} style={{ position: 'absolute', inset: 0 }}><ShaderGradientCanvas className="backdrop-canvas" style={{ position: 'absolute', inset: 0 }} pixelDensity={1} fov={45} pointerEvents="none" powerPreference="low-power">
    <ShaderGradient
      control="props"
      type="plane"
      animate={still ? 'off' : 'on'}
      uTime={0}
      uSpeed={focus ? 0.06 : 0.12}
      uStrength={4}
      uDensity={1.3}
      uFrequency={5.5}
      uAmplitude={1}
      positionX={-1.4}
      positionY={0}
      positionZ={0}
      rotationX={0}
      rotationY={10}
      rotationZ={50}
      cAzimuthAngle={180}
      cPolarAngle={90}
      cDistance={2.6}
      cameraZoom={1}
      lightType="3d"
      reflection={0.1}
      grain="off"
      {...sky}
    />
  </ShaderGradientCanvas></div>;
}
