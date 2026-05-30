import { useEffect, useRef } from 'react';

interface Beam {
  angle: number;
  length: number;
  width: number;
  phase: number;
}

// The supplied effect was tuned against a 340px square. We scale every
// pixel dimension by (renderedSize / BASE) so it looks identical at any
// size — the lobby chrome scales with --lobby-u, so the canvas does too.
const BASE = 340;

const CONFIG = {
  amountOfBeams: 48,
  minLength: 70,
  maxLength: 210,
  circleRadius: 36,
  blurStrength: 5,
  fadeInOutTime: 8,
  rotationSpeed: -0.002,
  lineWidth: 34,
};

/**
 * Animated radial "sunbeam" glow on a <canvas>, sits BEHIND the Special
 * Offers icon in the lobby side-rail. Self-contained: owns its
 * requestAnimationFrame loop + resize listener and tears both down on
 * unmount. Honours prefers-reduced-motion by drawing a single static
 * frame (no loop).
 */
export function Sunbeam() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduceMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let beams: Beam[] = [];
    let rafId = 0;

    const generateBeams = () => {
      beams = [];
      for (let i = 0; i < CONFIG.amountOfBeams; i++) {
        const widthBias = Math.random() ** 2;
        beams.push({
          angle: Math.random() * Math.PI * 2,
          length: CONFIG.minLength + Math.random() * (CONFIG.maxLength - CONFIG.minLength),
          width: 5 + widthBias * CONFIG.lineWidth,
          phase: Math.random() * Math.PI * 2,
        });
      }
    };

    const resizeCanvas = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      generateBeams();
    };

    const drawBeam = (beam: Beam, cx: number, cy: number, opacity: number, k: number) => {
      const x1 = cx + Math.cos(beam.angle) * beam.length * k;
      const y1 = cy + Math.sin(beam.angle) * beam.length * k;
      const gradient = ctx.createLinearGradient(cx, cy, x1, y1);
      gradient.addColorStop(0, `rgba(255, 225, 80, ${0.35 * opacity})`);
      gradient.addColorStop(0.35, `rgba(255, 170, 20, ${0.16 * opacity})`);
      gradient.addColorStop(0.7, `rgba(255, 120, 0, ${0.05 * opacity})`);
      gradient.addColorStop(1, 'rgba(255, 120, 0, 0)');
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(x1, y1);
      ctx.strokeStyle = gradient;
      ctx.lineWidth = beam.width * k;
      ctx.lineCap = 'round';
      ctx.stroke();
    };

    const renderFrame = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const cx = w / 2;
      const cy = h / 2;
      const k = Math.min(w, h) / BASE || 1;
      const time = performance.now() / 1000;

      ctx.clearRect(0, 0, w, h);

      ctx.save();
      ctx.filter = `blur(${CONFIG.blurStrength * k}px)`;
      for (const beam of beams) {
        beam.angle += CONFIG.rotationSpeed;
        const pulse = (Math.sin((time * Math.PI) / CONFIG.fadeInOutTime + beam.phase) + 1) / 2;
        drawBeam(beam, cx, cy, 0.35 + pulse * 0.65, k);
      }
      ctx.restore();

      // Fade the whole beam area outward into transparency.
      ctx.save();
      ctx.globalCompositeOperation = 'destination-in';
      const fade = ctx.createRadialGradient(cx, cy, 10 * k, cx, cy, 170 * k);
      fade.addColorStop(0, 'rgba(0,0,0,1)');
      fade.addColorStop(0.35, 'rgba(0,0,0,0.95)');
      fade.addColorStop(0.55, 'rgba(0,0,0,0.55)');
      fade.addColorStop(0.75, 'rgba(0,0,0,0.16)');
      fade.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = fade;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();

      // Soft center glow.
      const sun = ctx.createRadialGradient(cx, cy, 0, cx, cy, CONFIG.circleRadius * k);
      sun.addColorStop(0, 'rgba(255, 235, 120, 0.95)');
      sun.addColorStop(0.55, 'rgba(255, 170, 20, 0.45)');
      sun.addColorStop(1, 'rgba(255, 130, 0, 0)');
      ctx.fillStyle = sun;
      ctx.beginPath();
      ctx.arc(cx, cy, CONFIG.circleRadius * k, 0, Math.PI * 2);
      ctx.fill();

      if (!reduceMotion) rafId = requestAnimationFrame(renderFrame);
    };

    resizeCanvas();
    renderFrame();
    window.addEventListener('resize', resizeCanvas);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resizeCanvas);
    };
  }, []);

  return <canvas ref={canvasRef} className="lobby-sunbeam-canvas" aria-hidden="true" />;
}
