import * as THREE from 'three/webgpu';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
  texture as tslTexture,
  vec3, vec4, float,
  mix as tslMix,
  positionWorld,
  uniform as tslUniform,
  dot, length, smoothstep,
} from 'three/tsl';
import { sunDirectionFromAngles } from '@/utils/sun';

export type LightmapMaterialOptions = {
  worldSize?: number,
  strength?: number,   // 1 = full bake darkness
};

/**
 * Analytic golf-ball shadow: ray–sphere occlusion along the sun direction,
 * evaluated inside the existing surface shaders. No shadow map, no extra
 * pass or draw call.
 */
export const ballShadowUniforms = {
  ballPos: tslUniform(new THREE.Vector3(0, -1e4, 0)),
  toSun: tslUniform(new THREE.Vector3(0, 1, 0)), // unit vector toward the sun
  radius: tslUniform(0.0213),
  // scale: tslUniform(1.0),        // >1 exaggerates size for readability
  scale: tslUniform(2.0),        // shadow size multiplier (1 = real size)

  softness: tslUniform(0.0047),  // sun angular radius (rad): penumbra growth per metre
  edge: tslUniform(0.5),         // soft edge width as a fraction of shadow radius
  strength: tslUniform(0.45),    // darkness at shadow centre; match your baked tree shadows
  // strength: tslUniform(0.85),
  // strength: tslUniform(1.0),     // DEBUG: revert to 0.85
};

export function setBallShadowSun(elevationDeg?: number, azimuthDeg?: number) {
  const [x, y, z] = sunDirectionFromAngles(elevationDeg, azimuthDeg);
  ballShadowUniforms.toSun.value.set(-x, -y, -z).normalize();
}

export function ballShadowNode() {
  const u = ballShadowUniforms;
  // const toBall = u.ballPos.sub(positionWorld);
  const r = u.radius.mul(u.scale);
  // Lift the enlarged sphere so it rests on the ground instead of sinking into it
  const center = u.ballPos.add(vec3(0, r.sub(u.radius), 0));
  const toBall = center.sub(positionWorld);

  const t = dot(toBall, u.toSun);                          // distance along sun ray
  const miss = length(toBall.sub(u.toSun.mul(t)));         // closest approach to ball centre
  // const r = u.radius.mul(u.scale);
  // const pen = t.max(0).mul(u.softness).add(0.003);         // penumbra widens with height
  const blur = t.max(0).mul(u.softness);                   // penumbra widens with height
  const pen = blur.add(r.mul(u.edge));                     // plus a fixed soft edge

  const cover = float(1).sub(smoothstep(r.sub(pen), r.add(pen), miss));
  const energy = r.div(r.add(blur)).pow(2);               // fades as the ball rises
  const inFront = t.greaterThan(0).select(float(1), float(0));
  return float(1).sub(cover.mul(energy).mul(u.strength).mul(inFront));
}

export function lightmapShadowNode(
  lightmap: THREE.Texture,
  worldSize = 1000,
  strength = 0.85
) {
  const uvNode = positionWorld.xz.div(float(worldSize));
  const texNode = tslTexture(lightmap, uvNode);
  const node = tslMix(float(1.0), texNode.r, float(strength)).mul(ballShadowNode());
  return { node, texNode };
}
/**
 * Replaces a mesh's MeshStandardMaterial with a node material that multiplies
 * the baked course lightmap into the diffuse color. Multiplying the color
 * darkens ALL light (sun included) — aoMap only dims ambient, which left
 * baked shadows nearly invisible under a directional light.
 * Samples by world position (no UV attributes needed), same pattern as
 * SandMaterial's world-tiled textures.
 */
export class LightmapMaterial {
  material: MeshStandardNodeMaterial;
  #texNode;

  constructor(
    baseMesh: THREE.Mesh,
    lightmap: THREE.Texture,
    options: LightmapMaterialOptions = {}
  ) {
    const baseMat = baseMesh.material;
    if (!(baseMat instanceof THREE.MeshStandardMaterial)) {
      throw new Error('LightmapMaterial requires a MeshStandardMaterial');
    }
    const worldSize = options.worldSize ?? 1000;
    const strength = options.strength ?? 0.85;

    this.material = new MeshStandardNodeMaterial();
    this.material.roughness = baseMat.roughness ?? 0.9;
    if (baseMat.normalMap) {
      this.material.normalMap = baseMat.normalMap;
      this.material.normalScale = baseMat.normalScale?.clone() || new THREE.Vector2(1, 1);
    }
    this.material.side = baseMat.side;

    // Base color: keep the mesh's existing world/UV-tiled texture + tint
    const tint = baseMat.color || new THREE.Color(1, 1, 1);
    const base = baseMat.map
      ? tslTexture(baseMat.map).mul(vec3(tint.r, tint.g, tint.b))
      : vec3(tint.r, tint.g, tint.b);

    // Lightmap sampled by world position over the course extent
    const lightmapUV = positionWorld.xz.div(float(worldSize));
    this.#texNode = tslTexture(lightmap, lightmapUV);
    const shadowFactor = tslMix(float(1.0), this.#texNode.r, float(strength)).mul(ballShadowNode());

    this.material.colorNode = base.mul(shadowFactor);

    baseMesh.material = this.material;
  }

  /** Swap in a new bake (Meshery preview re-bakes). */
  updateTexture(lightmap: THREE.Texture) {
    this.#texNode.value = lightmap;
  }
}


/**
 * Apply baked shadows to any surface mesh:
 * - Existing TSL node material (sand, targets, putting grid): wraps its
 *   colorNode in place — rgb multiplied by the shadow factor, alpha kept.
 * - Plain MeshStandardMaterial: replaced via LightmapMaterial.
 * - Anything else (water): skipped.
 * Returns something swappable via updateTexture/swapLightmapTexture, or null.
 */
export function applyLightmapShadow(
  mesh: THREE.Mesh,
  lightmap: THREE.Texture,
  options: LightmapMaterialOptions = {}
): LightmapMaterial | THREE.Material | null {
  const mat: any = mesh.material;

  if (mat?.isNodeMaterial && mat.colorNode) {
    if (mat.userData.lightmapTexNode) return mat; // already applied — don't stack
    const { node, texNode } = lightmapShadowNode(
      lightmap, options.worldSize ?? 1000, options.strength ?? 0.85
    );
    mat.colorNode = vec4(mat.colorNode.rgb.mul(node), mat.colorNode.a);
    mat.userData.lightmapTexNode = texNode;
    mat.needsUpdate = true;
    return mat;
  }
  if (mat instanceof THREE.MeshStandardMaterial) {
    const old = mat;
    const lm = new LightmapMaterial(mesh, lightmap, options);
    old.dispose();
    return lm;
  }
  return null; // water / unsupported
}

/** Swap the bake texture on anything applyLightmapShadow returned. */
export function swapLightmapTexture(target: any, lightmap: THREE.Texture): boolean {
  if (!target) return false;
  if (target instanceof LightmapMaterial) { target.updateTexture(lightmap); return true; }
  if (target.userData?.lightmapTexNode) { target.userData.lightmapTexNode.value = lightmap; return true; }
  return false;
}

/** Configure a baked-lightmap texture (data, not color; clamped). */
export function configureLightmapTexture(tex: THREE.Texture) {
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}