import * as THREE from 'three/webgpu';
import { MeshLine, MeshLineGeometry } from 'makio-meshline';
import {
  Fn, float, smoothstep,
  uniform as tslUniform,
  cameraPosition, positionWorld, distance,
} from 'three/tsl';
import type { UniformNode } from 'three/webgpu';

const MAX_POINTS = 4000;

function resampleByArcLength(points: THREE.Vector3[], spacing: number) {
  if (points.length < 2) return points.slice();

  const out = [points[0].clone()];
  let traveled = 0;
  let nextTarget = spacing;

  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const segLen = a.distanceTo(b);
    if (segLen === 0) continue;

    while (traveled + segLen >= nextTarget) {
      const t = (nextTarget - traveled) / segLen;
      out.push(a.clone().lerp(b, t));
      nextTarget += spacing;
    }
    traveled += segLen;
  }

  const last = points[points.length - 1];
  if (out[out.length - 1].distanceToSquared(last) > 1e-6) {
    out.push(last.clone());
  }
  return out;
}

type BallTrailOptions = {
  maxPoints?: number;
  lineWidth?: number;
  fadeLength?: number;
  resampleSpacing?: number;
  cameraFadeNear?: number;
  cameraFadeFar?: number;
  color?: THREE.Color | number;
};

export class BallTrail {
  scene: THREE.Scene;
  golfBall: THREE.Object3D;
  maxPoints: number;
  lineWidth: number;
  fadeLength: number;
  resampleSpacing: number;
  color: THREE.Color;

  points: THREE.Vector3[];
  frameNum: number;
  line: MeshLine;
  fadeFracUniform: UniformNode<"float", number>;
  camFadeNear: UniformNode<"float", number>;
  camFadeFar: UniformNode<"float", number>;
  activeRatioUniform: UniformNode<"float", number>;

  renderOrder = 1;
  #positions: Float32Array;
  #activePoints = 0;
  #needsFullFill = true;
  #built = false;

  constructor(scene: THREE.Scene, golfBall: THREE.Object3D, options: BallTrailOptions = {}) {
    this.scene = scene;
    this.golfBall = golfBall;
    this.maxPoints = options.maxPoints ?? MAX_POINTS;
    this.lineWidth = options.lineWidth ?? 0.03;
    this.fadeLength = options.fadeLength ?? 2.0;
    this.resampleSpacing = options.resampleSpacing ?? 0.15;
    this.color = options.color instanceof THREE.Color
      ? options.color
      : new THREE.Color(options.color ?? '#fc4723');

    this.points = [];
    this.frameNum = 0;

    // Uniforms for dynamic fade control
    this.fadeFracUniform = tslUniform(0.01);
    this.camFadeNear = tslUniform(options.cameraFadeNear ?? 20);
    this.camFadeFar = tslUniform(options.cameraFadeFar ?? 25);
    this.activeRatioUniform = tslUniform(1.0);

    // TSL hook: fade opacity at both ends of the trail.
    // Receives (alpha, progress, side) where progress is 0→1 along the line.
    // Returns modified alpha with smoothstep fade at both ends.
    // @ts-expect-error - makio-meshline Fn hook typing
    const trailOpacityFn = Fn(([alpha, progress, side]) => {
      // const fadeIn = smoothstep(float(0), this.fadeFracUniform, progress);
      // const fadeOut = smoothstep(float(0), this.fadeFracUniform, float(1).sub(progress));
      // Remap progress from [0, activeRatio] to [0, 1]
      const remapped = progress.div(this.activeRatioUniform).clamp(0, 1);
      const fadeIn = smoothstep(float(0), this.fadeFracUniform, remapped);
      const fadeOut = smoothstep(float(0), this.fadeFracUniform, float(1).sub(remapped));
      return alpha.mul(fadeIn).mul(fadeOut);
    });

    // TSL hook: fade based on camera distance.
    // Receives (alpha, uv, progress, side). Fully transparent when close
    // to the camera (< cameraFadeNear), fully opaque past cameraFadeFar.
    // @ts-expect-error - makio-meshline Fn hook typing
    const trailAlphaFn = Fn(([alpha, uv, progress, side]) => {
      const dist = distance(positionWorld, cameraPosition);
      const camFade = smoothstep(this.camFadeNear, this.camFadeFar, dist);
      return alpha.mul(camFade);
    });

    // Pre-allocate fixed-size positions buffer
    this.#positions = new Float32Array(this.maxPoints * 3);

    // Create the line with dummy points — updated in _rebuild
    this.line = new MeshLine({
      // lines: new Float32Array([0, 0, 0, 0.001, 0, 0]),
      lines: this.#positions,
      color: this.color,
      lineWidth: this.lineWidth,
      sizeAttenuation: true,
      transparent: true,
      opacity: 1.0,
      opacityFn: trailOpacityFn,
      fragmentAlphaFn: trailAlphaFn,
    });

    // Build immediately to pre-allocate GPU buffers and compile shaders
    this.line.lines(this.#positions).build();
    this.#built = true;

    this.line.layers.set(2);
    this.line.frustumCulled = false;
    this.line.visible = false;
    this.line.renderOrder = this.renderOrder;
    // @ts-expect-error makio-meshline raycast signature doesn't match Object3D
    scene.add(this.line);
  }

  clear() {
    this.points = [];
    this.#activePoints = 0;
    this.line.visible = false;
  }

  addPoint() {
    const p = this.golfBall.position;
    const last = this.points[this.points.length - 1];
    if (!last || last.distanceToSquared(p) > 1e-6) {
      this.points.push(p.clone());
    }
  }

  update(collectPoints = false) {
    // let dirty = false;

    // if (collectPoints && this.frameNum % 4 === 0 && this.points.length < this.maxPoints) {
    if (collectPoints && this.frameNum % 2 === 0 && this.points.length < this.maxPoints) {
      this.addPoint();
      // dirty = true;
    }

    // if (collectPoints && this.frameNum % 2 === 0) {
    //   dirty = true;
    // }

    this.frameNum++;

    // if (dirty) {
    //   this._rebuild();
    // }
    if (collectPoints && this.frameNum % 2 === 0) {
      this._updatePositions();
    }

  }

  _rebuild() {
    const live = this.golfBall.position;
    const last = this.points[this.points.length - 1];
    const raw = (!last || last.distanceToSquared(live) > 1e-6)
      ? [...this.points, live.clone()]
      : this.points;

    if (raw.length < 2) {
      this.line.visible = false;
      return;
    }

    const head = resampleByArcLength(raw, this.resampleSpacing);
    if (head.length < 2) {
      this.line.visible = false;
      return;
    }

    // Compute total arc length for fade fraction
    let total = 0;
    for (let i = 1; i < head.length; i++) {
      total += head[i].distanceTo(head[i - 1]);
    }

    // Update the fade fraction: fadeLength / totalLength
    // Capped at 0.49 so both ends don't overlap
    this.fadeFracUniform.value = Math.min(0.49, this.fadeLength / Math.max(total, 0.0001));

    // Build flat positions array
    const positions = new Float32Array(head.length * 3);
    for (let i = 0; i < head.length; i++) {
      positions[i * 3]     = head[i].x;
      positions[i * 3 + 1] = head[i].y;
      positions[i * 3 + 2] = head[i].z;
    }

    // Update the line geometry and rebuild
    this.line.lines(positions).build();
    this.line.visible = true;
    this.line.frustumCulled = false;
    this.line.layers.set(2);
    this.line.renderOrder = this.renderOrder;
  }

  dispose() {
    // @ts-expect-error makio-meshline raycast signature doesn't match Object3D
    this.scene.remove(this.line);
    this.line.geometry.dispose();
    // this.line.material.dispose();
    const mat = this.line.material;
    if (Array.isArray(mat)) {
      mat.forEach(m => m.dispose());
    } else {
      mat.dispose();
    }

  }

  reset(updatedTarget?: THREE.Object3D) {
    if (updatedTarget) {
      this.golfBall = updatedTarget;
    }
    this.line.visible = false;
    this.points = [];
    this.frameNum = 0;
    this.#activePoints = 0;
    this.#built = false;
    this.#needsFullFill = true;
  }

  _updatePositions() {
    const live = this.golfBall.position;
    const last = this.points[this.points.length - 1];
    const raw = (!last || last.distanceToSquared(live) > 1e-6)
      ? [...this.points, live.clone()]
      : this.points;

    if (raw.length < 2) {
      this.line.visible = false;
      return;
    }

    const head = resampleByArcLength(raw, this.resampleSpacing);
    if (head.length < 2) {
      this.line.visible = false;
      return;
    }

    let total = 0;
    for (let i = 1; i < head.length; i++) {
      total += head[i].distanceTo(head[i - 1]);
    }
    this.fadeFracUniform.value = Math.min(0.49, this.fadeLength / Math.max(total, 0.0001));
    this.activeRatioUniform.value = this.#activePoints / this.maxPoints;

    this.#activePoints = Math.min(head.length, this.maxPoints);
    for (let i = 0; i < this.#activePoints; i++) {
      this.#positions[i * 3]     = head[i].x;
      this.#positions[i * 3 + 1] = head[i].y;
      this.#positions[i * 3 + 2] = head[i].z;
    }

    // const lastPt = head[this.#activePoints - 1];
    // for (let i = this.#activePoints; i < this.maxPoints; i++) {
    //   this.#positions[i * 3]     = lastPt.x;
    //   this.#positions[i * 3 + 1] = lastPt.y;
    //   this.#positions[i * 3 + 2] = lastPt.z;
    // }
    if (this.#needsFullFill) {
      const lastPt = head[this.#activePoints - 1];
      for (let i = this.#activePoints; i < this.maxPoints; i++) {
        this.#positions[i * 3]     = lastPt.x;
        this.#positions[i * 3 + 1] = lastPt.y;
        this.#positions[i * 3 + 2] = lastPt.z;
      }
      this.#needsFullFill = false;
    }


    if (!this.#built) {
      this.line.lines(this.#positions).build();
      this.#built = true;
    } else {
      // this.line.geometry.setPositions(this.#positions, true);
      (this.line.geometry as MeshLineGeometry).setPositions(this.#positions, true);
    }

    this.line.visible = true;
    this.line.frustumCulled = false;
    this.line.layers.set(2);
    this.line.renderOrder = this.renderOrder;
  }
}