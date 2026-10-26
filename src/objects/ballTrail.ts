import * as THREE from 'three/webgpu';
import { MeshLine, MeshLineGeometry } from 'makio-meshline';
import {
  Fn, float, smoothstep,
  uniform as tslUniform,
  cameraPosition, positionWorld, distance,
  positionGeometry, max as tslMax,
  cameraProjectionMatrix, screenSize, vec4
} from 'three/tsl';
import type { UniformNode } from 'three/webgpu';
import { QualityMode } from '@/utils/quality';

const MAX_POINTS = 4000;
const EPS_SQ = 1e-6;

/** Uniform Catmull-Rom on one axis. Samples are uniform in time, which suits a ballistic path. */
const cr = (p0: number, p1: number, p2: number, p3: number, t: number, t2: number, t3: number) =>
  0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (3 * p1 - p0 - 3 * p2 + p3) * t3);

/** Resampler position. Mutated in place, never reallocated. */
type Cursor = { seg: number; traveled: number; nextTarget: number; count: number };

type BallTrailOptions = {
  maxPoints?: number;
  lineWidth?: number;
  fadeLength?: number;
  resampleSpacing?: number;
  cameraFadeNear?: number;
  cameraFadeFar?: number;
  color?: THREE.Color | number;
  qualityLevel?: QualityMode;
};

/**
 * Ball trail rendered as a MeshLine.
 *
 * - Raw samples are taken per fixed physics step (`onPhysicsStep`), so density is FPS-independent.
 * - Raw samples are resampled at a fixed arc-length spacing along a Catmull-Rom spline.
 * - Resampling is incremental: segments whose spline is final are written once ("committed");
 *   only the last two segments (which depend on the live ball position) are rewritten each frame.
 * - Geometry attributes are written directly for the changed range only, uploaded with
 *   `updateRanges`, and `drawRange` limits rendering to the active part of the buffer.
 * - No per-frame allocations, no geometry/material rebuilds after construction.
 */
export class BallTrail {
  scene: THREE.Scene;
  golfBall: THREE.Object3D;
  maxPoints: number;
  lineWidth: number;
  fadeLength: number;
  resampleSpacing: number;
  color: THREE.Color;
  qualityLevel: QualityMode;

  /** Raw samples (also exported via GolfBall.getTrailPoints). */
  points: THREE.Vector3[] = [];
  line: MeshLine;
  fadeFracUniform: UniformNode<"float", number>;
  camFadeNear: UniformNode<"float", number>;
  camFadeFar: UniformNode<"float", number>;
  activeRatioUniform: UniformNode<"float", number>;
  renderOrder = 1;

  /** Resampled output points (x,y,z), one slot per MeshLine point. */
  #positions: Float32Array;
  #geometry: MeshLineGeometry;
  #posAttr: THREE.BufferAttribute;
  #prevAttr: THREE.BufferAttribute;
  #nextAttr: THREE.BufferAttribute;

  #stepMod: number;
  #stepNum = 0;

  #live = new THREE.Vector3();
  #lastLive = new THREE.Vector3(Infinity, Infinity, Infinity);
  #lastRawCount = -1;

  /** Final part of the resampled trail. */
  #commit: Cursor = { seg: 0, traveled: 0, nextTarget: 0, count: 0 };
  /** Scratch cursor for the provisional tail. */
  #tail: Cursor = { seg: 0, traveled: 0, nextTarget: 0, count: 0 };
  /** commit.count at the last upload; points before (that index - 1) are unchanged on the GPU. */
  #uploadedCommitted = 0;
  #activePoints = 0;

  constructor(scene: THREE.Scene, golfBall: THREE.Object3D, options: BallTrailOptions = {}) {
    this.scene = scene;
    this.golfBall = golfBall;
    this.qualityLevel = options.qualityLevel ?? QualityMode.Medium;
    const isLow = this.qualityLevel === QualityMode.Low;

    this.maxPoints = options.maxPoints ?? MAX_POINTS;
    this.lineWidth = options.lineWidth ?? 0.03;
    this.fadeLength = options.fadeLength ?? 2.0;
    // Output points sit on the spline, so wider spacing stays smooth; fewer points = less CPU + GPU.
    this.resampleSpacing = options.resampleSpacing ?? (isLow ? 0.3 : 0.15);
    // Raw sample every N physics steps (FIXED_DT = 1/60): Low 6 Hz, otherwise 15 Hz.
    this.#stepMod = isLow ? 10 : 4;
    this.color = options.color instanceof THREE.Color
      ? options.color
      : new THREE.Color(options.color ?? '#fc4723');

    this.fadeFracUniform = tslUniform(0.01);
    this.camFadeNear = tslUniform(options.cameraFadeNear ?? 15);
    this.camFadeFar = tslUniform(options.cameraFadeFar ?? 20);
    this.activeRatioUniform = tslUniform(1.0);

    // Low quality (no AA): clamp world-space width so the projected width
    // never drops below ~1.25px — sub-pixel lines miss sample centers and
    // stipple/vanish. P·(0,1,0,0).y = P[1][1] = 1/tan(fov/2); screenSize
    // tracks the drawing buffer, so adaptive pixel-ratio changes are handled.
    // @ts-expect-error - makio-meshline Fn hook typing
    const trailWidthFn = Fn(([width, progress, side]) => {
      const dist = distance(positionGeometry, cameraPosition);
      const projScaleY = cameraProjectionMatrix.mul(vec4(0, 1, 0, 0)).y;
      const minWorldWidth = dist.mul(2.0 * 1.25)
        .div(projScaleY.mul(screenSize.y));
      return tslMax(width, minWorldWidth);
    });

    // Fade opacity at both ends. progress (0→1 over the full buffer) is remapped
    // to the active portion via activeRatio.
    // @ts-expect-error - makio-meshline Fn hook typing
    const trailOpacityFn = Fn(([alpha, progress, side]) => {
      const remapped = progress.div(this.activeRatioUniform).clamp(0, 1);
      const fadeIn = smoothstep(float(0), this.fadeFracUniform, remapped);
      const fadeOut = smoothstep(float(0), this.fadeFracUniform, float(1).sub(remapped));
      return alpha.mul(fadeIn).mul(fadeOut);
    });

    // Transparent near the camera (< cameraFadeNear), opaque past cameraFadeFar.
    // @ts-expect-error - makio-meshline Fn hook typing
    const trailAlphaFn = Fn(([alpha, uv, progress, side]) => {
      const dist = distance(positionWorld, cameraPosition);
      const camFade = smoothstep(this.camFadeNear, this.camFadeFar, dist);
      return alpha.mul(camFade);
    });

    this.#positions = new Float32Array(this.maxPoints * 3);

    this.line = new MeshLine({
      lines: this.#positions,
      color: this.color,
      lineWidth: this.lineWidth,
      sizeAttenuation: true,
      transparent: true,
      opacity: 1.0,
      opacityFn: trailOpacityFn,
      fragmentAlphaFn: trailAlphaFn,
      ...(isLow ? { widthFn: trailWidthFn } : {}),
    });

    // Build once: allocates GPU buffers and compiles shaders. Never rebuilt afterwards.
    this.line.lines(this.#positions).build();

    this.#geometry = this.line.geometry as MeshLineGeometry;
    this.#posAttr = this.#geometry.getAttribute('position') as THREE.BufferAttribute;
    this.#prevAttr = this.#geometry.getAttribute('previous') as THREE.BufferAttribute;
    this.#nextAttr = this.#geometry.getAttribute('next') as THREE.BufferAttribute;
    this.#geometry.setDrawRange(0, 0);

    this.line.layers.set(2);
    this.line.frustumCulled = false;
    this.line.visible = false;
    this.line.renderOrder = this.renderOrder;
    // @ts-expect-error makio-meshline raycast signature doesn't match Object3D
    scene.add(this.line);
  }

  clear() {
    this.#resetState();
  }

  reset(updatedTarget?: THREE.Object3D) {
    if (updatedTarget) {
      this.golfBall = updatedTarget;
    }
    this.#resetState();
  }

  addPoint() {
    const p = this.golfBall.position;
    const last = this.points[this.points.length - 1];
    if (!last || last.distanceToSquared(p) > EPS_SQ) {
      this.points.push(p.clone());
    }
  }

  /** Call once per fixed physics step. Sampling is independent of render FPS. */
  onPhysicsStep(collectPoints: boolean) {
    if (!collectPoints) return;
    if (this.#stepNum++ % this.#stepMod === 0 && this.points.length < this.maxPoints) {
      this.addPoint();
    }
  }

  /** Call once per rendered frame. Cheap: only the tail is recomputed and uploaded. */
  update(collectPoints = false) {
    if (!collectPoints) return;

    const n = this.points.length;
    if (n === 0) return;

    const ball = this.golfBall.position;
    if (n === this.#lastRawCount && ball.distanceToSquared(this.#lastLive) <= EPS_SQ) {
      return; // nothing moved, nothing to upload
    }
    this.#lastRawCount = n;
    this.#lastLive.copy(ball);
    this.#live.copy(ball);

    const hasLive = this.points[n - 1].distanceToSquared(this.#live) > EPS_SQ;
    const m = n + (hasLive ? 1 : 0); // control point count

    const pos = this.#positions;
    const commit = this.#commit;

    // First point
    if (commit.count === 0) {
      const p = this.points[0];
      pos[0] = p.x; pos[1] = p.y; pos[2] = p.z;
      commit.count = 1;
      commit.nextTarget = this.resampleSpacing;
    }

    // Commit segments whose spline is final: segment k needs control k+2 to be a raw sample.
    this.#runSegments(commit, n - 2, m);

    // Provisional tail: remaining segments up to the live position, from a scratch copy.
    const tail = this.#tail;
    tail.seg = commit.seg;
    tail.traveled = commit.traveled;
    tail.nextTarget = commit.nextTarget;
    tail.count = commit.count;
    this.#runSegments(tail, m - 1, m);

    // Pin the head exactly to the last control point (the ball).
    const end = this.#ctrl(m - 1);
    const lo = (tail.count - 1) * 3;
    const dx = pos[lo] - end.x, dy = pos[lo + 1] - end.y, dz = pos[lo + 2] - end.z;
    if (dx * dx + dy * dy + dz * dz > EPS_SQ && tail.count < this.maxPoints) {
      const o = tail.count * 3;
      pos[o] = end.x; pos[o + 1] = end.y; pos[o + 2] = end.z;
      tail.count++;
    }

    const active = tail.count;
    this.#activePoints = active;

    if (active < 2) {
      this.line.visible = false;
      return;
    }

    // Upload only what changed: from the point before the previous commit boundary
    // (its `next` neighbour may have changed) to the current head.
    const start = Math.max(0, this.#uploadedCommitted - 1);
    this.#writeAttributes(start, active);
    this.#uploadedCommitted = commit.count;

    this.#geometry.setDrawRange(0, (active - 1) * 6);
    this.fadeFracUniform.value = Math.min(0.49, this.fadeLength / Math.max(tail.traveled, 0.0001));
    // progress of point i is i / (maxPoints - 1); the head maps to remapped progress 1.
    this.activeRatioUniform.value = (active - 1) / (this.maxPoints - 1);
    this.line.visible = true;
  }

  dispose() {
    // @ts-expect-error makio-meshline raycast signature doesn't match Object3D
    this.scene.remove(this.line);
    this.line.geometry.dispose();
    const mat = this.line.material;
    if (Array.isArray(mat)) {
      mat.forEach(m => m.dispose());
    } else {
      mat.dispose();
    }
  }

  #resetState() {
    this.line.visible = false;
    this.points = [];
    this.#stepNum = 0;
    this.#lastRawCount = -1;
    this.#lastLive.set(Infinity, Infinity, Infinity);
    this.#commit.seg = 0;
    this.#commit.traveled = 0;
    this.#commit.nextTarget = 0;
    this.#commit.count = 0;
    this.#uploadedCommitted = 0;
    this.#activePoints = 0;
    this.#geometry.setDrawRange(0, 0);
  }

  /** Control point k: raw samples, followed by the live ball position (if it has moved). */
  #ctrl(k: number): THREE.Vector3 {
    return k < this.points.length ? this.points[k] : this.#live;
  }

  /** Emit arc-length-spaced spline points for segments [cur.seg, segEnd). */
  #runSegments(cur: Cursor, segEnd: number, m: number) {
    const pos = this.#positions;
    const spacing = this.resampleSpacing;
    const limit = this.maxPoints - 1; // keep one slot for the head

    for (; cur.seg < segEnd; cur.seg++) {
      const k = cur.seg;
      const a = this.#ctrl(k);
      const b = this.#ctrl(k + 1);
      const len = a.distanceTo(b);
      if (len === 0) continue;
      const p0 = k > 0 ? this.#ctrl(k - 1) : a;
      const p3 = k + 2 < m ? this.#ctrl(k + 2) : b;

      while (cur.traveled + len >= cur.nextTarget && cur.count < limit) {
        const t = (cur.nextTarget - cur.traveled) / len;
        const t2 = t * t, t3 = t2 * t;
        const o = cur.count * 3;
        pos[o]     = cr(p0.x, a.x, b.x, p3.x, t, t2, t3);
        pos[o + 1] = cr(p0.y, a.y, b.y, p3.y, t, t2, t3);
        pos[o + 2] = cr(p0.z, a.z, b.z, p3.z, t, t2, t3);
        cur.count++;
        cur.nextTarget += spacing;
      }
      cur.traveled += len;
    }
  }

  /**
   * Write position/previous/next for points [start, active) straight into the MeshLine
   * attributes (2 vertices per point, same layout as MeshLineGeometry.build) and flag
   * only that range for upload. Endpoints use the same extrapolation as MeshLine.
   */
  #writeAttributes(start: number, active: number) {
    const src = this.#positions;
    const P = this.#posAttr.array as Float32Array;
    const V = this.#prevAttr.array as Float32Array;
    const N = this.#nextAttr.array as Float32Array;
    const last = active - 1;

    for (let i = start; i < active; i++) {
      const o = i * 3;
      const x = src[o], y = src[o + 1], z = src[o + 2];

      let px: number, py: number, pz: number;
      if (i > 0) {
        px = src[o - 3]; py = src[o - 2]; pz = src[o - 1];
      } else {
        px = 2 * x - src[3]; py = 2 * y - src[4]; pz = 2 * z - src[5];
      }

      let nx: number, ny: number, nz: number;
      if (i < last) {
        nx = src[o + 3]; ny = src[o + 4]; nz = src[o + 5];
      } else {
        nx = 2 * x - src[o - 3]; ny = 2 * y - src[o - 2]; nz = 2 * z - src[o - 1];
      }

      const v = i * 6; // 2 vertices × 3 components
      P[v] = P[v + 3] = x; P[v + 1] = P[v + 4] = y; P[v + 2] = P[v + 5] = z;
      V[v] = V[v + 3] = px; V[v + 1] = V[v + 4] = py; V[v + 2] = V[v + 5] = pz;
      N[v] = N[v + 3] = nx; N[v + 1] = N[v + 4] = ny; N[v + 2] = N[v + 5] = nz;
    }

    const rStart = start * 6;
    const rCount = (active - start) * 6;
    flagRange(this.#posAttr, rStart, rCount);
    flagRange(this.#prevAttr, rStart, rCount);
    flagRange(this.#nextAttr, rStart, rCount);
  }
}

/**
 * Flag a range for upload. Keeps at most one pending range per attribute (merged), so
 * frames where the line isn't rendered (e.g. layer not on the active camera) can't pile
 * up ranges; the renderer clears the list after uploading.
 */
function flagRange(attr: THREE.BufferAttribute, start: number, count: number) {
  const ranges = attr.updateRanges;
  if (ranges.length === 0) {
    attr.addUpdateRange(start, count);
  } else {
    const r = ranges[0];
    const end = Math.max(r.start + r.count, start + count);
    r.start = Math.min(r.start, start);
    r.count = end - r.start;
  }
  attr.needsUpdate = true;
}