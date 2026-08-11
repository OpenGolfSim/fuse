import * as THREE from 'three/webgpu';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
  texture as tslTexture,
  vec2,
  vec3,
  float,
  mix,
  smoothstep,
  positionWorld,
  cameraPosition,
  uniform,
  normalMap,
  uv,
} from 'three/tsl';
import type { UniformNode } from 'three/webgpu';

type DistanceFadeOptions = {
  /** Distance where fade begins (full texture inside this) */
  fadeStart?: number,
  /** Distance where surface is fully flat color */
  fadeEnd?: number,
  /** Override the flat color; otherwise averaged from the texture */
  flatColor?: THREE.Color,
}

/**
 * DistanceFadeMaterial
 *
 * Renders the base texture normally within `fadeStart` of the camera,
 * then fades to a flat (averaged) color by `fadeEnd`.
 *
 * Usage:
 *   mesh.material = new DistanceFadeMaterial(mesh.material, {
 *     fadeStart: 50,
 *     fadeEnd: 150,
 *   });
 */
export class DistanceFadeMaterial extends MeshStandardNodeMaterial {
  fadeStart: UniformNode<'float', number>;
  fadeEnd: UniformNode<'float', number>;

  constructor(baseMat: THREE.MeshStandardMaterial, options: DistanceFadeOptions = {}) {
    super();

    const baseTexture = baseMat.map;
    if (!baseTexture) {
      throw new Error('DistanceFadeMaterial requires a base texture map');
    }

    this.roughness = baseMat.roughness ?? 0.9;

    this.fadeStart = uniform(options.fadeStart ?? 50);
    this.fadeEnd = uniform(options.fadeEnd ?? 150);

    const tint = baseMat.color || new THREE.Color(1, 1, 1);
    const flat = options.flatColor || averageTextureColor(baseTexture);
    const flatTinted = flat.clone().multiply(tint);

    // Textured color (standard UVs — swap for positionWorld.xz.div(tileSize) if world-tiled)
    const texColor = tslTexture(baseTexture, uv()).rgb
      .mul(vec3(tint.r, tint.g, tint.b));

    // 0 inside fadeStart → 1 past fadeEnd
    const camDist = positionWorld.sub(cameraPosition).length();
    const fade = smoothstep(this.fadeStart, this.fadeEnd, camDist);

    this.colorNode = mix(
      texColor,
      vec3(flatTinted.r, flatTinted.g, flatTinted.b),
      fade
    );

    // Optional: kill normal-map detail at distance too, so the far
    // surface reads truly flat rather than flat-colored-but-bumpy.
    if (baseMat.normalMap) {
      const scale = baseMat.normalScale || new THREE.Vector2(1, 1);
      const fadedScale = vec2(scale.x, scale.y).mul(float(1.0).sub(fade));
      this.normalNode = normalMap(tslTexture(baseMat.normalMap, uv()), fadedScale);
    }
  }
}

/**
 * CPU-side average of a texture's pixels via a 1x1 canvas downsample.
 * Runs once at construction; falls back to mid-gray if image isn't ready.
 */
function averageTextureColor(tex: THREE.Texture): THREE.Color {
  const img = tex.image as HTMLImageElement | ImageBitmap | undefined;
  if (!img || !('width' in img) || !img.width) {
    return new THREE.Color(0.5, 0.5, 0.5);
  }
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img as CanvasImageSource, 0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  // Canvas gives sRGB bytes; convert to linear to match render pipeline
  return new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
}