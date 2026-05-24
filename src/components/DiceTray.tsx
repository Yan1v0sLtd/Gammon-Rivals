import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import * as CANNON from 'cannon-es';
import type { Die, DiceRoll } from '../engine/types';

/**
 * DiceTray v3 — Three.js dice with physics, architected to avoid the
 * WebGL-context leak that killed v1.
 *
 * History (so future readers don't repeat the mistakes):
 *   v1 — Three.js + Cannon physics. Effect deps were
 *        [diceCount, rollKey], so the WebGLRenderer was destroyed +
 *        recreated on EVERY dice roll. disposeStage() called
 *        renderer.dispose() but NOT renderer.forceContextLoss(), so
 *        the GPU-side context lingered until GC. After ~16 rolls
 *        the browser killed the oldest live WebGL context — which
 *        turned out to be the Pixi board canvas — and the board
 *        went white mid-match.
 *   v2 — Pure CSS 3D cubes. No WebGL contexts at all. Survived
 *        the leak class entirely but visual quality was below the
 *        bar (flat-looking, no shading, no real shadows).
 *   v3 — Back to Three.js, but the architecture is fundamentally
 *        different from v1:
 *         1) The renderer / scene / world / dice meshes are created
 *            ONCE per mount, in a useEffect with deps [].
 *         2) Per-roll changes only touch the cannon-es bodies
 *            (reset positions + impulses). The renderer is NEVER
 *            torn down per roll.
 *         3) Cleanup on unmount: forceContextLoss() THEN dispose()
 *            THEN remove the canvas. This explicitly releases the
 *            GPU-side WebGL context instead of waiting for GC.
 *
 * Because backgammon is server-authoritative (the DB decides what
 * was rolled — see roll_dice edge function + match.current_turn.dice),
 * the physics simulation is decorative. After the dice come to rest,
 * we snap each die's quaternion to the orientation that shows the
 * value the server actually rolled. Physics for the tumble, server
 * for the result.
 */

interface Props {
  readonly roll: DiceRoll | null;
  readonly remaining: readonly Die[];
  readonly settleSide?: 'left' | 'right';
  readonly placement?: 'board' | 'hud';
}

/* ─── Scene constants ──────────────────────────────────────────── */

const CANVAS_W = 180;
const CANVAS_H = 200;
const CANVAS_W_MOBILE = 130;
const CANVAS_H_MOBILE = 150;

const DIE_SIZE = 1;
const DIE_HALF = DIE_SIZE * 0.5;

/** Initial spawn positions for the two dice — chosen so they land
 *  inside the floor patch and don't roll out of frame. */
const DIE_SPAWN: ReadonlyArray<[number, number, number]> = [
  [-1.2, 3.5, -0.6],
  [1.2, 4.5, 0.6],
];

const FLOOR_HALF = 3; // floor is 6x6
const GRAVITY = -28;
const ROLL_SETTLE_MS = 1500;

/** Map each die face value (1–6) to the index that face has in the
 *  DiceCube material's per-face layout. The material is built so
 *  index 0 carries 1 pip, index 5 carries 6 pips, etc. — see
 *  faceNumberIndexes in createDiceCube below for the full mapping.
 *
 *  After physics settles, we orient the cube so the chosen face's
 *  outward normal points to +Y (up toward the camera).
 */
const FACE_INDEX_FOR_VALUE: Record<Die, number> = {
  1: 0,
  6: 1,
  2: 2,
  5: 3,
  3: 4,
  4: 5,
};

/** The outward normal in cube-local space for each face index 0–5.
 *  Matches the [+X, -X, +Y, -Y, +Z, -Z] layout the reference used. */
const FACE_NORMALS: ReadonlyArray<THREE.Vector3> = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, -1, 0),
  new THREE.Vector3(0, 0, 1),
  new THREE.Vector3(0, 0, -1),
];

const UP = new THREE.Vector3(0, 1, 0);

/* ─── DiceCube factory ─────────────────────────────────────────── */

/**
 * Build a single die mesh: RoundedBoxGeometry + a canvas texture
 * with the six pip faces laid out in a 4×2 atlas, plus custom UVs
 * pointing each cube face at the correct atlas tile.
 *
 * Adapted from the reference DiceCube class; refactored into a
 * function so we control disposal lifecycle (texture + geometry +
 * material) when the component unmounts.
 */
function createDiceCube(size: number): {
  readonly mesh: THREE.Mesh;
  readonly geometry: RoundedBoxGeometry;
  readonly material: THREE.MeshStandardMaterial;
  readonly texture: THREE.CanvasTexture;
} {
  const tileDimension = new THREE.Vector2(4, 2);
  const tileSize = 512;
  const geometry = new RoundedBoxGeometry(size, size, size, 3, size * 0.075);
  const pipDistance = 0.25;
  const pipRadius = 0.075;

  // Pip positions per face value (1..6) in normalised face-local
  // coordinates. Indices into this array map to face VALUES, not
  // face geometry indices.
  const pips: ReadonlyArray<ReadonlyArray<THREE.Vector2>> = [
    [new THREE.Vector2(0, 0)],
    [new THREE.Vector2(-1, -1), new THREE.Vector2(1, 1)],
    [new THREE.Vector2(-1, -1), new THREE.Vector2(0, 0), new THREE.Vector2(1, 1)],
    [
      new THREE.Vector2(-1, -1),
      new THREE.Vector2(-1, 1),
      new THREE.Vector2(1, 1),
      new THREE.Vector2(1, -1),
    ],
    [
      new THREE.Vector2(-1, -1),
      new THREE.Vector2(-1, 1),
      new THREE.Vector2(1, 1),
      new THREE.Vector2(1, -1),
      new THREE.Vector2(0, 0),
    ],
    [
      new THREE.Vector2(-1, -1),
      new THREE.Vector2(-1, 0),
      new THREE.Vector2(-1, 1),
      new THREE.Vector2(1, 1),
      new THREE.Vector2(1, 0),
      new THREE.Vector2(1, -1),
    ],
  ];

  // Map face geometry index 0..5 → pip-count index 0..5. This
  // arrangement places opposite values on opposite faces (1↔6, 2↔5,
  // 3↔4), as on a real die.
  const faceNumberIndexes = [0, 5, 1, 4, 2, 3];

  // Build a 4×2 atlas: 6 face tiles plus 2 unused. The geometry's
  // default UVs cover the whole 0..1 range per face; we remap them
  // to point at the per-face tile.
  const canvas = document.createElement('canvas');
  canvas.width = tileSize * tileDimension.x;
  canvas.height = tileSize * tileDimension.y;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#0e1a2e';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const uvAttr = geometry.attributes.uv as THREE.BufferAttribute;
  const baseUVs = Array.from({ length: uvAttr.count / 6 }, (_, idx) =>
    new THREE.Vector2().fromBufferAttribute(uvAttr, idx)
  );
  const uvs: number[] = [];
  const tmp = new THREE.Vector2();
  const center = new THREE.Vector2(0.5, 0.5);

  for (let i = 0; i < 6; i++) {
    const u = i % tileDimension.x;
    const v = Math.floor(i / tileDimension.x);

    baseUVs.forEach((base) => {
      uvs.push((base.x + u) / tileDimension.x, (base.y + v) / tileDimension.y);
    });

    ctx.fillStyle = '#fff';
    ctx.beginPath();
    pips[faceNumberIndexes[i]!]!.forEach((p) => {
      tmp.copy(p).multiplyScalar(pipDistance).add(center);
      tmp.x += u;
      // Y in atlas runs top-down, but our UVs are y-up. Invert.
      tmp.y += tileDimension.y - 1 - v;
      tmp.multiplyScalar(tileSize);
      ctx.moveTo(tmp.x + tileSize * pipRadius, tmp.y);
      ctx.arc(tmp.x, tmp.y, tileSize * pipRadius, 0, Math.PI * 2);
    });
    ctx.fill();
  }

  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const material = new THREE.MeshStandardMaterial({
    map: texture,
    metalness: 0.55,
    roughness: 0.3,
    color: 0xf6f6f6,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = false;

  return { mesh, geometry, material, texture };
}

/* ─── diceToShow — same semantics as v1/v2 ──────────────────────── */

function diceToShow(
  roll: DiceRoll,
  remaining: readonly Die[]
): Array<{ readonly value: Die; readonly used: boolean }> {
  if (roll[0] === roll[1]) {
    const used = 4 - remaining.length;
    return [
      { value: roll[0], used: used >= 2 },
      { value: roll[0], used: used >= 4 },
    ];
  }
  const remCopy = [...remaining];
  return ([roll[0], roll[1]] as const).map((v) => {
    const idx = remCopy.indexOf(v);
    if (idx >= 0) {
      remCopy.splice(idx, 1);
      return { value: v, used: false };
    }
    return { value: v, used: true };
  });
}

/* ─── Component ────────────────────────────────────────────────── */

/** Refs we hold across renders so the per-roll effect can poke the
 *  same scene that the mount effect built. Stored as a single
 *  object so we don't need 8 separate useRefs. */
interface SceneRefs {
  renderer: THREE.WebGLRenderer | null;
  scene: THREE.Scene | null;
  camera: THREE.PerspectiveCamera | null;
  world: CANNON.World | null;
  dice: Array<{
    mesh: THREE.Mesh;
    body: CANNON.Body;
    geometry: RoundedBoxGeometry;
    material: THREE.MeshStandardMaterial;
    texture: THREE.CanvasTexture;
  }>;
  rafId: number | null;
  pmrem: THREE.PMREMGenerator | null;
  envTexture: THREE.Texture | null;
  /** Timer that snaps the dice to the server-determined value after
   *  the physics tumble settles. Cancelled if a new roll fires
   *  before this one finishes. */
  snapTimer: number | null;
}

export default function DiceTray({ roll, remaining, settleSide = 'right' }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const refs = useRef<SceneRefs>({
    renderer: null,
    scene: null,
    camera: null,
    world: null,
    dice: [],
    rafId: null,
    pmrem: null,
    envTexture: null,
    snapTimer: null,
  });

  // Compute the canvas size once per render. Using matchMedia rather
  // than CSS-only because the WebGLRenderer's pixel buffer size is
  // set in JS.
  const dims = useMemo(() => {
    if (typeof window === 'undefined') return { w: CANVAS_W, h: CANVAS_H };
    const isMobile = window.matchMedia('(max-width: 640px)').matches;
    return isMobile
      ? { w: CANVAS_W_MOBILE, h: CANVAS_H_MOBILE }
      : { w: CANVAS_W, h: CANVAS_H };
  }, []);

  /* ── Mount: create renderer, scene, world, dice ─────────────── */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    /* --- Renderer --- */
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(dims.w, dims.h);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';

    /* --- Scene + camera --- */
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, dims.w / dims.h, 0.1, 50);
    // Angled top-down view. Length 7 keeps the dice large in frame
    // while letting the floor read.
    camera.position.set(-2, 4.5, 4).setLength(7);
    camera.lookAt(0, 0.4, 0);

    /* --- Lighting --- */
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(-3, 6, 4);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.set(512, 512);
    dirLight.shadow.camera.left = -4;
    dirLight.shadow.camera.right = 4;
    dirLight.shadow.camera.top = 4;
    dirLight.shadow.camera.bottom = -4;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 20;
    scene.add(dirLight);

    const hemi = new THREE.HemisphereLight(0xfff8c8, 0x202840, 0.55);
    scene.add(hemi);

    /* --- Environment (subtle reflections on the metal-ish dice) --- */
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTexture;

    /* --- Physics world --- */
    const world = new CANNON.World({
      allowSleep: true,
      gravity: new CANNON.Vec3(0, GRAVITY, 0),
    });
    world.defaultContactMaterial.contactEquationStiffness = 5e7;
    world.defaultContactMaterial.contactEquationRelaxation = 4;
    world.defaultContactMaterial.restitution = 0.28;
    world.defaultContactMaterial.friction = 0.32;

    /* --- Floor (transparent shadow catcher, plus side walls so the
           dice don't roll off into the void) --- */
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(FLOOR_HALF * 2, FLOOR_HALF * 2).rotateX(
        -Math.PI / 2
      ),
      new THREE.ShadowMaterial({ opacity: 0.4, color: 0x000000 })
    );
    floor.receiveShadow = true;
    scene.add(floor);

    const floorBody = new CANNON.Body({
      type: CANNON.Body.STATIC,
      shape: new CANNON.Plane(),
    });
    floorBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    world.addBody(floorBody);

    // Invisible walls — the four sides of a box centred on origin,
    // FLOOR_HALF from centre on the x/z axes. Keeps dice in frame.
    const wallShape = new CANNON.Plane();
    const wallConfigs: ReadonlyArray<{
      pos: [number, number, number];
      euler: [number, number, number];
    }> = [
      { pos: [0, 0, -FLOOR_HALF], euler: [0, 0, 0] }, // far
      { pos: [0, 0, FLOOR_HALF], euler: [0, Math.PI, 0] }, // near
      { pos: [-FLOOR_HALF, 0, 0], euler: [0, Math.PI / 2, 0] }, // left
      { pos: [FLOOR_HALF, 0, 0], euler: [0, -Math.PI / 2, 0] }, // right
    ];
    wallConfigs.forEach(({ pos, euler }) => {
      const wallBody = new CANNON.Body({
        type: CANNON.Body.STATIC,
        shape: wallShape,
      });
      wallBody.position.set(...pos);
      wallBody.quaternion.setFromEuler(...euler);
      world.addBody(wallBody);
    });

    /* --- Two dice --- */
    const dice = DIE_SPAWN.map((spawn) => {
      const { mesh, geometry, material, texture } = createDiceCube(DIE_SIZE);
      mesh.position.set(...spawn);
      scene.add(mesh);

      const body = new CANNON.Body({
        mass: 1.2,
        shape: new CANNON.Box(new CANNON.Vec3(DIE_HALF, DIE_HALF, DIE_HALF)),
        sleepTimeLimit: 0.12,
      });
      body.position.set(...spawn);
      world.addBody(body);

      return { mesh, body, geometry, material, texture };
    });

    /* --- Animation loop --- */
    const clock = new THREE.Clock();
    const tick = () => {
      const dt = Math.min(clock.getDelta(), 0.1);
      // Fixed timestep with substepping for stability — the
      // accumulator handles framerate variance.
      world.step(1 / 60, dt, 3);
      dice.forEach(({ mesh, body }) => {
        mesh.position.set(body.position.x, body.position.y, body.position.z);
        mesh.quaternion.set(
          body.quaternion.x,
          body.quaternion.y,
          body.quaternion.z,
          body.quaternion.w
        );
      });
      renderer.render(scene, camera);
      refs.current.rafId = window.requestAnimationFrame(tick);
    };
    refs.current.rafId = window.requestAnimationFrame(tick);

    refs.current = {
      renderer,
      scene,
      camera,
      world,
      dice,
      rafId: refs.current.rafId,
      pmrem,
      envTexture,
      snapTimer: null,
    };

    /* --- Cleanup ----------------------------------------------------
       The full disposal chain. Critically, forceContextLoss() comes
       BEFORE dispose() — that's what immediately releases the GPU
       context instead of leaving it for GC. This is the difference
       between "renderer destroyed cleanly" and "renderer destroyed
       in code but context still counted against the browser's
       ~16-context cap". The v1 bug was caused by skipping this. */
    return () => {
      const r = refs.current;
      if (r.rafId !== null) {
        window.cancelAnimationFrame(r.rafId);
      }
      if (r.snapTimer !== null) {
        window.clearTimeout(r.snapTimer);
      }
      r.dice.forEach(({ mesh, geometry, material, texture, body }) => {
        scene.remove(mesh);
        if (r.world) r.world.removeBody(body);
        geometry.dispose();
        material.dispose();
        texture.dispose();
      });
      // Floor + walls + lights stay on the scene; their geometries
      // and materials are small + uniqueless. The renderer.dispose()
      // below releases everything internal to the renderer.
      r.envTexture?.dispose();
      r.pmrem?.dispose();
      // CRITICAL: forceContextLoss first.
      renderer.forceContextLoss();
      renderer.dispose();
      if (renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
      refs.current = {
        renderer: null,
        scene: null,
        camera: null,
        world: null,
        dice: [],
        rafId: null,
        pmrem: null,
        envTexture: null,
        snapTimer: null,
      };
    };
    // Dims captured at mount; we don't re-create the renderer on
    // resize. (If the viewport crosses the mobile breakpoint mid-
    // session, the dice tray ends up slightly miss-sized until the
    // next match start. Acceptable tradeoff for renderer stability.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Per-roll: push the dice with impulses, then snap to value ─ */
  useEffect(() => {
    if (!roll) return;
    const r = refs.current;
    if (!r.world || r.dice.length < 2) return;

    // Cancel any previous snap that hasn't fired yet — fresh roll
    // takes precedence.
    if (r.snapTimer !== null) {
      window.clearTimeout(r.snapTimer);
      r.snapTimer = null;
    }

    const values: [Die, Die] = [roll[0], roll[1]];

    r.dice.forEach((d, i) => {
      const spawn = DIE_SPAWN[i]!;
      d.body.wakeUp();
      d.body.allowSleep = true;
      d.body.velocity.set(0, 0, 0);
      d.body.angularVelocity.set(0, 0, 0);
      d.body.position.set(spawn[0], spawn[1], spawn[2]);
      d.body.quaternion.setFromEuler(
        Math.random() * Math.PI,
        Math.random() * Math.PI,
        Math.random() * Math.PI
      );

      // Throw the die toward the middle of the tray. Direction is
      // roughly opposite the spawn position so the cube travels
      // across the floor and tumbles a few times before resting.
      const fx = -spawn[0] * 3 + (Math.random() - 0.5) * 1.5;
      const fz = -spawn[2] * 3 + (Math.random() - 0.5) * 1.5;
      d.body.applyImpulse(
        new CANNON.Vec3(fx, 0.5, fz),
        new CANNON.Vec3(0, 0, 0.2)
      );
      d.body.angularVelocity.set(
        (Math.random() - 0.5) * 18,
        (Math.random() - 0.5) * 18,
        (Math.random() - 0.5) * 18
      );
    });

    // After the tumble, force each die to its server-determined face.
    // We can't trust the physics to randomly land on the right value,
    // and the value is server-canonical anyway (see file header).
    r.snapTimer = window.setTimeout(() => {
      r.dice.forEach((d, i) => {
        snapToValue(d.body, values[i]!);
      });
      r.snapTimer = null;
    }, ROLL_SETTLE_MS);

    return () => {
      if (refs.current.snapTimer !== null) {
        window.clearTimeout(refs.current.snapTimer);
        refs.current.snapTimer = null;
      }
    };
  }, [roll, remaining]);

  /* ── Per-render: dim used dice via material opacity ───────────── */
  useEffect(() => {
    if (!roll) return;
    const r = refs.current;
    if (r.dice.length < 2) return;
    const dice = diceToShow(roll, remaining);
    r.dice.forEach((d, i) => {
      const used = dice[i]?.used ?? false;
      d.material.opacity = used ? 0.35 : 1;
      d.material.transparent = used;
      d.material.needsUpdate = true;
    });
  }, [roll, remaining]);

  // Render nothing if there's no roll yet — saves the canvas DOM
  // until the first roll. The mount effect above still creates the
  // renderer once the container is in the DOM though, so the
  // FIRST roll already has the scene warm.
  if (!roll) return null;

  return (
    <div
      className={`dice-tray-3d dice-tray-3d--${settleSide}`}
      style={{ width: dims.w, height: dims.h }}
      aria-hidden
    >
      <div ref={containerRef} className="dice-tray-3d-canvas" />
    </div>
  );
}

/**
 * Rotate a CANNON Body's quaternion so that the cube face whose
 * pip-value is `value` ends up pointing toward +Y (up at the camera).
 * Used to override the physics result with the server-determined
 * value once the dice settle.
 */
function snapToValue(body: CANNON.Body, value: Die) {
  const faceIdx = FACE_INDEX_FOR_VALUE[value];
  const normal = FACE_NORMALS[faceIdx]!.clone();
  // Compute the rotation that takes `normal` to `UP`.
  const q = new THREE.Quaternion().setFromUnitVectors(normal, UP);
  // Add a small random twist around the up axis so the dice don't
  // all sit axis-aligned. Multiplying on the LEFT applies the twist
  // in world space after the face rotation, keeping the chosen face
  // pointing up.
  const twist = new THREE.Quaternion().setFromAxisAngle(
    UP,
    (Math.random() - 0.5) * Math.PI * 0.6
  );
  q.premultiply(twist);
  body.quaternion.set(q.x, q.y, q.z, q.w);
  body.velocity.set(0, 0, 0);
  body.angularVelocity.set(0, 0, 0);
  body.sleep();
}
