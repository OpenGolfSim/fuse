import * as THREE from 'three/webgpu';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import type { Node } from 'three/webgpu';
import {
  vec2, vec3, vec4, float,
  uniform as tslUniform,
  positionWorld, materialColor,
  smoothstep as tslSmoothstep, mix,
  fwidth,
  Fn, Discard,
} from 'three/tsl';
import { type ShotPerspectiveCamera } from '@/camera';

type FloatNode = Node<'float'>;
type Vec2Node = Node<'vec2'>;

export type PuttingGridMaterialOptions = {
  /** Hole world position (required for cup cutout) */
  holeWorldPos?: THREE.Vector3,
  /** Grid cell size in meters (default 1.0) */
  gridSize?: number,
  /** Grid line thickness in meters (default 0.025) */
  lineWidth?: number,
  /** Grid line color (default warm white) */
  lineColor?: THREE.Color,
  /** Grid line opacity 0..1 (default 0.3) */
  lineOpacity?: number,
  /** Dot sphere radius in meters (default 0.015) */
  dotRadius?: number,
  /** Dot color (default white) */
  dotColor?: THREE.Color,
  dotOpacity?: number,
  /** Base speed multiplier — scaled by slope (default 5) */
  baseSpeed?: number,
  /** Minimum dot speed in m/s (default 0.02) */
  minSpeed?: number,
};

// ---------------------------------------------------------------------------
// Edge timing: one moving dot between two adjacent grid intersections
// ---------------------------------------------------------------------------
interface EdgeTiming {
  start: THREE.Vector3;
  end: THREE.Vector3;
  slope: number;
  duration: number;     // base duration (slope-derived, before compensation)
  valid: boolean;
}

// ---------------------------------------------------------------------------
// Pristine Grid — one axis
// ---------------------------------------------------------------------------
const pristineGridAxis = (coord: FloatNode, uvLW: FloatNode): FloatNode => {
  const gridDist = coord.fract().mul(2.0).sub(1.0).abs().oneMinus();
  const dd = fwidth(coord);
  const drawW = uvLW.max(dd.mul(2.0));
  const aa = dd.mul(1.5);
  const mask = tslSmoothstep(drawW.add(aa), drawW.sub(aa), gridDist)
    .mul(uvLW.div(drawW).clamp(0.3, 1.0));
  const moire = dd.mul(2.0).sub(1.0).clamp(0.0, 1.0);
  return mix(mask, uvLW, moire);
};

// ---------------------------------------------------------------------------
// PuttingGridMaterial
// ---------------------------------------------------------------------------
export class PuttingGridMaterial {
  fadeSpeed = 6.0;

  readonly gridAngleUniform = tslUniform(0.0);
  readonly intensityUniform = tslUniform(0.0);
  readonly cellSizeVUniform = tslUniform(1.0);
  readonly holePosUniform = tslUniform(new THREE.Vector3());
  readonly cameraPosUniform = tslUniform(new THREE.Vector3());

  material?: MeshStandardNodeMaterial;
  dotsMesh?: THREE.InstancedMesh;

  private targetIntensity = 1.0;
  private currentIntensity = 0.0;
  private elapsed = 0;
  private edges: EdgeTiming[] = [];
  private mesh: THREE.Mesh | null = null;
  private gridCenter = new THREE.Vector3();
  private currentAngle = 0;
  private compression = 1.0;
  private gridSize: number;
  private lineWidth: number;
  private lineColor: THREE.Color;
  private lineOpacity: number;
  private dotRadius: number;
  private dotColor: THREE.Color;
  private dotOpacity: number;
  private baseSpeed: number;
  private minSpeed: number;

  constructor(object: THREE.Object3D, options: PuttingGridMaterialOptions = {}) {
    this.gridSize    = options.gridSize    ?? 0.7;
    this.lineWidth   = options.lineWidth   ?? 0.025;
    this.lineColor   = options.lineColor   ?? new THREE.Color(1.0, 0.9, 0.02);
    this.lineOpacity = options.lineOpacity ?? 0.07;
    this.dotRadius   = options.dotRadius   ?? 0.015;
    this.dotColor    = options.dotColor    ?? new THREE.Color(1.0, 1.0, 1.0);
    this.dotOpacity  = options.dotOpacity  ?? 0.8;
    this.baseSpeed   = options.baseSpeed   ?? 5;
    this.minSpeed    = options.minSpeed    ?? 0.05;

    if (options.holeWorldPos) {
      this.holePosUniform.value.set(options.holeWorldPos.x, 0, options.holeWorldPos.z);
    }

    if (!(object instanceof THREE.Mesh)) return;
    this.mesh = object;

    this.setupMaterial(object);
    this.buildGrid(0);
  }

  // -----------------------------------------------------------------
  // Grid line shader (Pristine Grid — lines only, no dots)
  // -----------------------------------------------------------------
  private setupMaterial(object: THREE.Mesh) {
    const origMat = object.material as THREE.MeshStandardMaterial;
    const mat = new MeshStandardNodeMaterial();

    if (origMat.color) mat.color = origMat.color.clone();
    if (origMat.map) mat.map = origMat.map;
    if (origMat.normalMap) mat.normalMap = origMat.normalMap;
    mat.roughness = origMat.roughness ?? 1.0;
    mat.metalness = origMat.metalness ?? 0.0;
    if (origMat.roughnessMap) mat.roughnessMap = origMat.roughnessMap;
    if (origMat.metalnessMap) mat.metalnessMap = origMat.metalnessMap;
    if (origMat.emissive) mat.emissive = origMat.emissive.clone();
    if (origMat.emissiveMap) mat.emissiveMap = origMat.emissiveMap;
    mat.emissiveIntensity = origMat.emissiveIntensity ?? 1.0;
    if (origMat.aoMap) mat.aoMap = origMat.aoMap;
    mat.aoMapIntensity = origMat.aoMapIntensity ?? 1.0;
    mat.envMapIntensity = origMat.envMapIntensity ?? 1.0;
    if (origMat.lightMap) mat.lightMap = origMat.lightMap;
    mat.lightMapIntensity = origMat.lightMapIntensity ?? 1.0;
    mat.side = origMat.side;
    mat.toneMapped = origMat.toneMapped;
    if (origMat.normalScale) mat.normalScale = origMat.normalScale.clone();

    const cellSizeU    = float(this.gridSize);
    const uvLW         = float(this.lineWidth / this.gridSize);
    const lineColorRGB = vec3(this.lineColor.r, this.lineColor.g, this.lineColor.b);
    const lineOpacityU = float(this.lineOpacity);

    const xz = positionWorld.xz;

    const rotate2D = (v: Vec2Node, angle: FloatNode): Vec2Node => {
      const c = angle.cos();
      const s = angle.sin();
      return vec2(
        v.x.mul(c).sub(v.y.mul(s)),
        v.x.mul(s).add(v.y.mul(c)),
      );
    };

    const xzGrid = rotate2D(xz, this.gridAngleUniform);
    const uvU = xzGrid.x.div(cellSizeU);
    const uvV = xzGrid.y.div(this.cellSizeVUniform);

    const lineU = pristineGridAxis(uvU, uvLW);
    const lineV = pristineGridAxis(uvV, uvLW);
    const grid = lineU.add(lineV).sub(lineU.mul(lineV));

    const gridBlend = grid.mul(lineOpacityU).mul(this.intensityUniform);

    // @ts-expect-error -- @types/three 0.184: materialColor is bare MaterialNode
    const baseColor = materialColor.rgb;
    // const color = mix(baseColor, lineColorRGB, gridBlend);
    const color = baseColor.add(lineColorRGB.mul(gridBlend));

    // Distance fade: grid lines fade out between 50m and 60m
    const fragDist = positionWorld.sub(this.cameraPosUniform).length();
    const distFade = tslSmoothstep(float(40.0), float(20.0), fragDist);
    const fadedColor = mix(baseColor, color, distFade);

    // mat.colorNode = vec4(color, 1.0);
    // mat.transparent = false;
    // --- Hole cutout (same as TargetShaderMaterial) ---
    const holeRadius = float(0.054);
    const holeDist = positionWorld.xz.sub(this.holePosUniform.xz).length();
    const g = fwidth(holeDist).clamp(0.0008, 0.02);
    const holeMask = tslSmoothstep(holeRadius.sub(g), holeRadius.add(g), holeDist);

    // const finalColor = color;
    const finalColor = fadedColor;
    mat.colorNode = Fn(() => {
      Discard(holeMask.lessThan(0.5));
      // @ts-expect-error - RGB type issue
      return vec4(finalColor.rgb, 1.0);
    })();
    mat.transparent = false;

    mat.needsUpdate = true;
    object.material = mat;
    this.material = mat;
  }

  // -----------------------------------------------------------------
  // Raycast to find the green surface at a world XZ position
  // -----------------------------------------------------------------
  private sampleSurface(x: number, z: number): { point: THREE.Vector3; found: boolean } {
    if (!this.mesh) return { point: new THREE.Vector3(x, 0, z), found: false };
    const rc = new THREE.Raycaster(
      new THREE.Vector3(x, 100, z),
      new THREE.Vector3(0, -1, 0),
    );
    const hits = rc.intersectObject(this.mesh, false);
    if (hits.length > 0) return { point: hits[0].point.clone(), found: true };
    return { point: new THREE.Vector3(x, 0, z), found: false };
  }

  // -----------------------------------------------------------------
  // Build / rebuild the dot grid at a given angle + compression
  // -----------------------------------------------------------------
  buildGrid(angle: number, compression = 1.0) {
    if (!this.mesh) return;

    if (this.dotsMesh) {
      this.dotsMesh.parent?.remove(this.dotsMesh);
      this.dotsMesh.geometry.dispose();
      (this.dotsMesh.material as THREE.Material).dispose();
      this.dotsMesh = undefined;
    }

    this.currentAngle = angle;
    this.compression = compression;
    this.gridAngleUniform.value = angle;
    this.edges = [];
    this.elapsed = 0;

    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);

    const box = new THREE.Box3().setFromObject(this.mesh);
    this.gridCenter.copy(box.getCenter(new THREE.Vector3()));

    const gsH = this.gridSize;
    const gsV = this.gridSize * compression;
    this.cellSizeVUniform.value = gsV;

    let minN = Infinity, maxN = -Infinity;
    let minM = Infinity, maxM = -Infinity;
    for (let i = 0; i < 8; i++) {
      const cx = (i & 1) ? box.max.x : box.min.x;
      const cz = (i & 4) ? box.max.z : box.min.z;
      const rotX = cx * cosA - cz * sinA;
      const rotY = cx * sinA + cz * cosA;
      minN = Math.min(minN, rotX / gsH); maxN = Math.max(maxN, rotX / gsH);
      minM = Math.min(minM, rotY / gsV); maxM = Math.max(maxM, rotY / gsV);
    }
    const n0 = Math.floor(minN);
    const n1 = Math.ceil(maxN);
    const m0 = Math.floor(minM);
    const m1 = Math.ceil(maxM);

    const cols = n1 - n0 + 1;
    const rows = m1 - m0 + 1;

    const pts: (THREE.Vector3 | null)[][] = [];
    for (let mi = 0; mi < rows; mi++) {
      pts[mi] = [];
      for (let ni = 0; ni < cols; ni++) {
        const n = n0 + ni;
        const m = m0 + mi;
        const wx = n * gsH * cosA + m * gsV * sinA;
        const wz = -n * gsH * sinA + m * gsV * cosA;
        const s = this.sampleSurface(wx, wz);
        pts[mi][ni] = s.found ? s.point : null;
      }
    }

    const addEdge = (a: THREE.Vector3 | null, b: THREE.Vector3 | null) => {
      if (!a || !b) {
        this.edges.push({ start: new THREE.Vector3(), end: new THREE.Vector3(), slope: 0, duration: 1, valid: false });
        return;
      }
      const dy = a.y - b.y;
      const start = dy >= 0 ? a : b;
      const end   = dy >= 0 ? b : a;
      const dist  = start.distanceTo(end);
      const slope = Math.abs(dy) / Math.max(dist, 0.001);
      const speed = Math.max(this.minSpeed, this.baseSpeed * slope);
      this.edges.push({
        start: start.clone(),
        end: end.clone(),
        slope,
        duration: dist / speed,
        valid: true,
      });
    };

    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols - 1; c++)
        addEdge(pts[r][c], pts[r][c + 1]);

    for (let r = 0; r < rows - 1; r++)
      for (let c = 0; c < cols; c++)
        addEdge(pts[r][c], pts[r + 1][c]);

    if (this.edges.length === 0) return;

    const geo = new THREE.SphereGeometry(1, 8, 6);
    const dotMat = new THREE.MeshStandardMaterial({ color: this.dotColor, opacity: this.dotOpacity });
    this.dotsMesh = new THREE.InstancedMesh(geo, dotMat, this.edges.length);
    this.dotsMesh.frustumCulled = false;

    if (this.mesh.parent) {
      this.mesh.parent.add(this.dotsMesh);
    }
  }

  // -----------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------
  setEnabled(enabled: boolean, immediate = false) {
    this.targetIntensity = enabled ? 1.0 : 0.0;
    if (immediate) {
      this.currentIntensity = this.targetIntensity;
      this.intensityUniform.value = this.targetIntensity;
    }
    if (this.dotsMesh) this.dotsMesh.visible = enabled;
  }
  setHolePosition(position: THREE.Vector3) {
    this.holePosUniform.value.set(position.x, 0, position.z);
  }
  update(dt: number, camera: ShotPerspectiveCamera) {
    this.elapsed += dt;

    // Fade grid lines
    const t = 1.0 - Math.exp(-this.fadeSpeed * dt);
    this.currentIntensity += (this.targetIntensity - this.currentIntensity) * t;
    this.intensityUniform.value = this.currentIntensity;

    // Update grid angle + compression from camera
    if (!camera.isTracking && !camera.isAiming) {
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      const newAngle = Math.atan2(dir.x, dir.z);

      // const elevation = Math.asin(Math.abs(dir.y));
      // const newCompression = Math.min(Math.pow(1 / Math.max(Math.sin(elevation), 0.17), 0.75), 5);
      // Measure the actual perspective compression by projecting a 1m H
      // and 1m V edge at the grid center. This accounts for FOV, distance,
      // and elevation all at once — no formula to get wrong.
      const cosA = Math.cos(newAngle);
      const sinA = Math.sin(newAngle);
      const c = this.gridCenter;
      // const pA = new THREE.Vector3(c.x, c.y, c.z).project(camera);
      // const pH = new THREE.Vector3(c.x + cosA, c.y, c.z - sinA).project(camera);
      // const pV = new THREE.Vector3(c.x + sinA, c.y, c.z + cosA).project(camera);
      // Measure compression between camera and grid center (biased toward
      // near cells where foreshortening is most visible). 0.35 = measure
      // point is 35% of the way from camera to center. Lower = more
      // compression, higher = less.
      const mx = camera.position.x + (c.x - camera.position.x) * 0.35;
      const mz = camera.position.z + (c.z - camera.position.z) * 0.35;
      const pA = new THREE.Vector3(mx, c.y, mz).project(camera);
      const pH = new THREE.Vector3(mx + cosA, c.y, mz - sinA).project(camera);
      const pV = new THREE.Vector3(mx + sinA, c.y, mz + cosA).project(camera);

      const screenH = Math.sqrt((pH.x - pA.x) ** 2 + (pH.y - pA.y) ** 2);
      const screenV = Math.sqrt((pV.x - pA.x) ** 2 + (pV.y - pA.y) ** 2);
      const newCompression = screenV > 0.001
        ? Math.min(Math.max(screenH / screenV, 1.0), 5.0)
        : this.compression;

      if (Math.abs(newAngle - this.currentAngle) > 0.035 ||
          Math.abs(newCompression - this.compression) > 0.3) {
        this.buildGrid(newAngle, newCompression);
      }
    }

    // Animate dots with per-edge perspective compensation.
    //
    // For each edge, project start/end to screen (NDC) and measure the
    // screen-space length. Multiply by camera distance to the edge
    // midpoint to isolate the ANGULAR compression — this factors out
    // the uniform distance-based shrinking (which affects both axes
    // equally) and leaves only the anisotropic foreshortening.
    //
    // Normalize by the maximum so H edges (least compressed) keep their
    // base duration, and V edges (more compressed) get proportionally
    // shorter durations (faster dots).
    this.cameraPosUniform.value.copy(camera.position);
    if (!this.dotsMesh) return;

    const mat4 = new THREE.Matrix4();
    const sc = this.dotRadius;
    const projA = new THREE.Vector3();
    const projB = new THREE.Vector3();

    // Consistent screen-space speed: project each edge to screen,
    // set duration = screenDist / (targetScreenSpeed * slopeSpeed).
    // Same slope = same screen speed, regardless of camera distance,
    // angle, FOV, or perspective compression.
    const targetScreenSpeed = 0.15;

    for (let i = 0; i < this.edges.length; i++) {
      const e = this.edges[i];
      if (!e.valid) {
        mat4.makeTranslation(0, -1000, 0);
      } else {
        projA.copy(e.start).project(camera);
        projB.copy(e.end).project(camera);

        if (projA.z > 1 || projB.z > 1) {
          mat4.makeTranslation(0, -1000, 0);
          this.dotsMesh.setMatrixAt(i, mat4);
          continue;
        }

        const screenDist = Math.sqrt(
          (projB.x - projA.x) ** 2 + (projB.y - projA.y) ** 2,
        );
        const slopeSpeed = Math.max(this.minSpeed, this.baseSpeed * e.slope);
        const duration = Math.max(screenDist / (targetScreenSpeed * slopeSpeed), 0.3);
        // Fade dot size to 0 between 50m and 60m from camera
        const dotDist = Math.sqrt(
          ((e.start.x + e.end.x) * 0.5 - camera.position.x) ** 2 +
          ((e.start.y + e.end.y) * 0.5 - camera.position.y) ** 2 +
          ((e.start.z + e.end.z) * 0.5 - camera.position.z) ** 2,
        );
        const dotFade = Math.max(0, Math.min(1, (60 - dotDist) / 10));
        if (dotFade <= 0) {
          mat4.makeTranslation(0, -1000, 0);
          this.dotsMesh.setMatrixAt(i, mat4);
          continue;
        }


        const tt = (this.elapsed % duration) / duration;
        const px = e.start.x + (e.end.x - e.start.x) * tt;
        const py = e.start.y + (e.end.y - e.start.y) * tt;
        const pz = e.start.z + (e.end.z - e.start.z) * tt;
        // mat4.makeScale(sc, sc, sc);
        mat4.makeScale(sc * dotFade, sc * dotFade, sc * dotFade);
        mat4.setPosition(px, py, pz);
      }
      this.dotsMesh.setMatrixAt(i, mat4);
    }
    this.dotsMesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    if (this.material) {
      this.material.dispose();
      this.material = undefined;
    }
    if (this.dotsMesh) {
      this.dotsMesh.parent?.remove(this.dotsMesh);
      this.dotsMesh.geometry.dispose();
      (this.dotsMesh.material as THREE.Material).dispose();
      this.dotsMesh = undefined;
    }
  }
}