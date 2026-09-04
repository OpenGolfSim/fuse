import * as THREE from 'three/webgpu';
import {
  Fn, vec2, vec3, float, abs, max, round, cos, sin,
  normalize, cross, texture, cameraPosition, positionGeometry, uv,
  instancedBufferAttribute, varying,
  instancedDynamicBufferAttribute,
  vec4,
} from 'three/tsl';
import { QualityMode } from '@/utils/quality';

export type ImpostorMeta = {
  grid: number;
  hemi: boolean;
  radius: number;
  center: [number, number, number];
};

export function createImpostorMaterial(
  map: THREE.Texture,
  meta: ImpostorMeta,
  posScaleAttr: THREE.InstancedBufferAttribute, // xyz = quad center (world), w = scale (0 = hidden)
  yawAttr: THREE.InstancedBufferAttribute,      // baked per-tree Y rotation
  qualityLevel?: QualityMode,
  colorAttr?: THREE.InstancedBufferAttribute,   // per-tree tint (vec3); multiplies baked albedo
  bendNormals = true,
  occlusion = 0.8, // <1 darkens to compensate for missing canopy self-shadowing

) {
  const N = meta.grid;
  const mat = new THREE.MeshStandardNodeMaterial({
    roughness: 1,
    metalness: 0,
    side: THREE.DoubleSide,
  });

  // Match the batch cutout logic: no MSAA on Low → A2C unavailable
  if (qualityLevel === QualityMode.Low) {
    mat.alphaTest = 0.6;
    mat.alphaToCoverage = false;
  } else {
    mat.alphaTest = 0.4;
    mat.alphaToCoverage = true;
  }
  mat.transparent = false;
  mat.depthWrite = true;

  const inst = instancedDynamicBufferAttribute<'vec4'>(posScaleAttr, 'vec4');
  const yaw = instancedBufferAttribute<'float'>(yawAttr, 'float');
  const tint = colorAttr ? instancedBufferAttribute<'vec3'>(colorAttr, 'vec3') : null;

  const toCam = cameraPosition.sub(inst.xyz);
  const fwd = varying(normalize(toCam));
  const right = varying(normalize(cross(vec3(0, 1, 0), fwd)));
  const up = varying(cross(fwd, right)); // already unit (fwd ⟂ right)

  // Spherical billboard, expanded in world space. NOTE: assumes the mesh's own
  // transform is identity (treeGroup at world origin).
  mat.positionNode = Fn(() => {
    const half = float(meta.radius).mul(inst.w);
    return inst.xyz
      .add(right.mul(positionGeometry.x.mul(half)))
      .add(up.mul(positionGeometry.y.mul(half)));
  })();

  // Frame selection: view dir in tree-local space (undo baked yaw) →
  // hemi-octahedral encode (exact inverse of the bake's hemiOctaDir) →
  // snap to nearest baked view (single tap — cheapest; upgrade to 3-tap
  // blend later if frame snapping is visible).
  mat.colorNode = Fn(() => {
    const c = cos(yaw), s = sin(yaw);
    const lx = fwd.x.mul(c).sub(fwd.z.mul(s));
    const lz = fwd.x.mul(s).add(fwd.z.mul(c));
    const ly = max(fwd.y, float(0.02)); // clamp to hemisphere

    const sum = abs(lx).add(ly).add(abs(lz));
    const px = lx.div(sum), pz = lz.div(sum);
    const g = vec2(px.add(pz), px.sub(pz)).mul(0.5).add(0.5);

    const cell = round(g.mul(N - 1));
    // If trees render upside-down, replace uv() with vec2(uv().x, uv().y.oneMinus())
    const frameUV = cell.add(uv()).div(N);
    // return texture(map, frameUV);
    const t = texture(map, frameUV);
    const rgb = tint ? t.rgb.mul(occlusion).mul(tint) : t.rgb.mul(occlusion);
    return vec4(rgb, t.a);
    // return vec4(t.rgb.mul(occlusion), t.a);
  })();

  // if (bendNormals) {
  //   // Fake spherical canopy normal, anchored in WORLD space (not camera space):
  //   // normal = direction from quad center to the vertex, pulled toward world-up.
  //   // Camera-relative normals over-brighten whenever the camera is sun-side.
  //   mat.normalNode = normalize(
  //     right.mul(positionGeometry.x.mul(0.8))
  //       .add(up.mul(positionGeometry.y.mul(0.8)))
  //       .add(vec3(0, 1, 0)),
  //   );
  // }
  // Constant world-up normal: N·L is one fixed value (set by sun elevation),
  // identical for every tree from every angle — no view-dependent brightness
  // shifts. Curved fake normals always over-brighten at some sun/camera geometry;
  // 'occlusion' is the single knob that matches this constant level to the LODs.
  mat.normalNode = vec3(0, 1, 0);
  return mat;
}