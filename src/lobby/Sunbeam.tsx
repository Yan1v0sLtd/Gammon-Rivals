import { useEffect, useRef } from 'react';

interface Beam {
  angle: number;
  length: number;
  width: number;
  phase: number;
}

// The supplied effect was tuned against a 460px square. We scale every
// pixel dimension by (renderedSize / BASE) so it looks identical at any
// size — the lobby chrome scales with --lobby-u, so the canvas does too.
// fadeRadius is BASE/2, so the glow fills the canvas to its rim; the
// canvas CSS size (.lobby-sunbeam-canvas) is what sets its on-screen scale.
const BASE = 460;

const CONFIG = {
  amountOfBeams: 90,
  minLength: 130,
  maxLength: 350,
  fadeRadius: 230,
  circleRadius: 48,
  blurStrength: 4,
  fadeInOutTime: 10,
  rotationSpeed: -0.0016,
  lineWidth: 46,
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
      // Denser, brighter "pop" tuning (90 beams + 5-stop gradient + hotter
      // core) supplied by the operator so the warm rays read clearly over
      // the BRIGHT lobby art. Pixel dimensions still scale by k so the
      // effect tracks the lobby's --lobby-u sizing.
      gradient.addColorStop(0, `rgba(255, 245, 130, ${0.7 * opacity})`);
      gradient.addColorStop(0.25, `rgba(255, 205, 60, ${0.38 * opacity})`);
      gradient.addColorStop(0.55, `rgba(255, 150, 0, ${0.16 * opacity})`);
      gradient.addColorStop(0.82, `rgba(255, 110, 0, ${0.055 * opacity})`);
      gradient.addColorStop(1, 'rgba(255, 110, 0, 0)');
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
        drawBeam(beam, cx, cy, 0.45 + pulse * 0.75, k);
      }
      ctx.restore();

      // Fade the whole beam area outward into transparency.
      ctx.save();
      ctx.globalCompositeOperation = 'destination-in';
      const fade = ctx.createRadialGradient(cx, cy, 20 * k, cx, cy, CONFIG.fadeRadius * k);
      fade.addColorStop(0, 'rgba(0,0,0,1)');
      fade.addColorStop(0.42, 'rgba(0,0,0,0.98)');
      fade.addColorStop(0.62, 'rgba(0,0,0,0.68)');
      fade.addColorStop(0.8, 'rgba(0,0,0,0.24)');
      fade.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = fade;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();

      // Soft center glow.
      const sun = ctx.createRadialGradient(cx, cy, 0, cx, cy, CONFIG.circleRadius * k);
      sun.addColorStop(0, 'rgba(255, 245, 150, 1)');
      sun.addColorStop(0.45, 'rgba(255, 190, 35, 0.72)');
      sun.addColorStop(0.75, 'rgba(255, 145, 0, 0.28)');
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
