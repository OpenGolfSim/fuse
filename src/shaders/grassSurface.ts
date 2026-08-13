import * as THREE from 'three/webgpu';
import { MeshStandardNodeMaterial, Node } from 'three/webgpu';
import {
  texture as tslTexture,
  vec2,
  vec3,
  float,
  mix,
  smoothstep,
  sin,
  positionWorld,
  cameraPosition,
  uniform,
  normalMap,
  uv,
  mx_fractal_noise_float,
  normalWorldGeometry,
  tanh,
  hash,
  floor,
  log2,
  exp2,
  fract,
  screenCoordinate,
} from 'three/tsl';
import type { UniformNode } from 'three/webgpu';

export type GrassSurfaceOptions = {
  /** Distance where fade begins (full texture inside this) */
  fadeStart?: number,
  /** Distance where surface is fully flat color */
  fadeEnd?: number,
  /** Override the flat color; otherwise averaged from the texture */
  flatColor?: THREE.Color,
  mowLines?: {
    /** Stripe direction in degrees (0 = stripes run along Z) */
    direction?: number,
    /** Width of one stripe in world units */
    width?: number,
    /** Brightness contrast 0-1. Try 0.06-0.12 */
    strength?: number,
    /** Edge wobble in world units. Try 0.2-0.6 (0 = perfectly straight) */
    wobble?: number,
    /** How much lines fade in patches, 0-1. Try 0.3-0.6 */
    fadeVariation?: number,
  },
  discolor?: {
    // /** Tiling noise texture (reuse grassAssets.noiseTexture) */
    // noiseTexture: THREE.Texture,
    /** World size of one large patch cycle, in units. Try 30-60 */
    patchScale?: number,
    /** Dry grass color to blend toward */
    dryColor?: THREE.ColorRepresentation,
    /** Max blend amount 0-1. Try 0.25-0.5 */
    strength?: number,
    /** Noise threshold — higher = fewer/smaller patches. Try 0.5-0.7 */
    coverage?: number,
  },
  shading?: {
    /** Sun elevation/azimuth in degrees (from course sun settings) */
    elevation: number,
    azimuth: number,
    /** Hillshade contrast boost. Try 1.5-3 */
    contrast?: number,
    /** Steepness darkening 0-1. Try 0.1-0.25 */
    slopeTint?: number,
  },
  /** Subtle noise in the flat-color zone, mimicking distant blade variation */
  distantDetail?: {
    /** World size of variation patches in units. Try 1-3 */
    scale?: number,
    /** Max darkening 0-1. Try 0.06-0.12 */
    strength?: number,
    /** Tiling noise texture (grassAssets.noiseTexture) */
    noiseTexture: THREE.Texture,
    /** Noise ramp start/end distances. Defaults to fadeStart/fadeEnd */
    rampStart?: number,
    rampEnd?: number,
    /** Strength multiplier at 0 distance, 0-1. 0.2 = 20% of full near camera */
    nearAmount?: number,

  },
}

/**
 * GrassSurface
 *
 * Renders the base texture normally within `fadeStart` of the camera,
 * then fades to a flat (averaged) color by `fadeEnd`.
 *
 * Usage:
 *   mesh.material = new GrassSurface(mesh.material, {
 *     fadeStart: 50,
 *     fadeEnd: 150,
 *   });
 */
export class GrassSurface extends MeshStandardNodeMaterial {
  fadeStart: UniformNode<'float', number>;
  fadeEnd: UniformNode<'float', number>;
  /** Final composed color graph, typed for downstream composition */
  surfaceColor: Node<'vec3'>;

  constructor(baseMat: THREE.MeshStandardMaterial, options: GrassSurfaceOptions = {}) {
    super();

    const baseTexture = baseMat.map;
    if (!baseTexture) {
      throw new Error('GrassSurface requires a base texture map');
    }

    this.roughness = baseMat.roughness ?? 0.9;
    this.metalness = baseMat.metalness ?? 0.0;
    // Expose base map/color: colorNode drives rendering, but consumers
    // (GrassBlades ground-matching) read these properties.
    if (baseMat.map) this.map = baseMat.map;
    if (baseMat.color) this.color = baseMat.color.clone();
    if (baseMat.roughnessMap) this.roughnessMap = baseMat.roughnessMap;
    if (baseMat.metalnessMap) this.metalnessMap = baseMat.metalnessMap;
    if (baseMat.emissive) this.emissive = baseMat.emissive.clone();
    if (baseMat.emissiveMap) this.emissiveMap = baseMat.emissiveMap;
    this.emissiveIntensity = baseMat.emissiveIntensity ?? 1.0;
    if (baseMat.aoMap) this.aoMap = baseMat.aoMap;
    this.aoMapIntensity = baseMat.aoMapIntensity ?? 1.0;
    this.envMapIntensity = baseMat.envMapIntensity ?? 1.0;
    if (baseMat.lightMap) this.lightMap = baseMat.lightMap;
    this.lightMapIntensity = baseMat.lightMapIntensity ?? 1.0;
    this.side = baseMat.side;
    this.toneMapped = baseMat.toneMapped;

    this.fadeStart = uniform(options.fadeStart ?? 50);
    this.fadeEnd = uniform(options.fadeEnd ?? 150);

    const tint = baseMat.color || new THREE.Color(1, 1, 1);

    // Textured color (standard UVs — swap for positionWorld.xz.div(tileSize) if world-tiled)
    const texColor = tslTexture(baseTexture, uv()).rgb
      .mul(vec3(tint.r, tint.g, tint.b));

    // Flat color: sample the top mip (~single averaged texel).
    // Works for compressed (KTX2) textures — decoded on GPU.
    const flatColor = options.flatColor
      ? vec3(...options.flatColor.clone().multiply(tint).toArray())
      : tslTexture(baseTexture, uv()).level(float(12)).rgb
          .mul(vec3(tint.r, tint.g, tint.b));

    // 0 inside fadeStart → 1 past fadeEnd
    const camDist = positionWorld.sub(cameraPosition).length();
    const fade = smoothstep(this.fadeStart, this.fadeEnd, camDist);

    // this.colorNode = mix(
    let color = mix(
      texColor,
      flatColor,
      fade
    );

    // --- Distant blade variation: noise fades IN as the texture fades OUT,
    // so the flat zone reads as grass, not paint ---
    if (options.distantDetail) {
      const dScale = options.distantDetail.scale ?? 0.5;
      const dStrength = uniform(options.distantDetail.strength ?? 0.08);
      // World-space grain texture: mipmaps filter with distance —
      // sharp specks near, averaged far, no shimmer, ground-locked.
      // dScale = world size of one texture tile.
      const raw = tslTexture(
        options.distantDetail.noiseTexture,
        positionWorld.xz.div(dScale)
      ).r;
      // const dShade = float(1.0).sub(raw.mul(dStrength).mul(fade));
      // Own distance ramp: nearAmount at camera → 1.0 past rampEnd
      const rampStart = uniform(options.distantDetail.rampStart ?? options.fadeStart ?? 50);
      const rampEnd = uniform(options.distantDetail.rampEnd ?? options.fadeEnd ?? 150);
      const nearAmount = options.distantDetail.nearAmount ?? 0.2;
      const dRamp = mix(
        float(nearAmount),
        float(1.0),
        smoothstep(rampStart, rampEnd, camDist)
      );
      const dShade = float(1.0).sub(raw.mul(dStrength).mul(dRamp));

      color = color.mul(dShade);

    }

    // --- Natural discoloration: large dry patches (satellite-style) ---
    if (options.discolor) {
      const d = options.discolor;
      const scale = d.patchScale ?? 40;
      // const dry = new THREE.Color(d.dryColor ?? '#8a8a4a');
      // const dry = new THREE.Color(d.dryColor ?? '#adb56f');
      // Additive color: keep it dim — it's an offset, not a paint color.
      const dry = new THREE.Color(d.dryColor ?? '#4d4d14');
      
      const strength = uniform(d.strength ?? 0.35);
      const threshold = d.coverage ?? 0.55;

      // Large-scale stress field, kept continuous (no hard threshold) so
      // yellowing ramps in gradually instead of filling patches uniformly.
      const wp = vec3(positionWorld.x.div(scale), positionWorld.z.div(scale), 0);
      const n = mx_fractal_noise_float(wp, 3).mul(0.5).add(0.5);
      // Very soft ramp: most of the field is a weak gradient
      const base = smoothstep(float(threshold - 0.15), float(threshold + 0.35), n);
      // Finer noise varies intensity WITHIN patches (breaks the "paint" fill)
      const detail = mx_fractal_noise_float(wp.mul(6.0), 2).mul(0.5).add(0.5);
      const patch = base.mul(detail.mul(0.6).add(0.4)); // detail scales 0.4-1.0

      // Subtle desaturate-and-warm instead of a brown multiply:
      // pull green down toward luminance (fades the green), nudge red up.
      // const lum = color.r.mul(0.3).add(color.g.mul(0.6)).add(color.b.mul(0.1));
      // const stressed = vec3(
      //   mix(color.r, lum.mul(1.25), 0.8),  // warmer
      //   mix(color.g, lum.mul(1.05), 0.6),  // less green
      //   mix(color.b, lum.mul(0.7), 0.6)    // less blue
      // );
      // color = mix(color, stressed, patch.mul(strength));      
      // Additive lightening: add a yellow-green cast where the patch mask
      // is high. Texture stays fully intact underneath.
      const cast = vec3(dry.r, dry.g, dry.b).mul(patch.mul(strength));
      color = color.add(cast);      
    }

    // --- Mow lines: world-space alternating bands ---
    if (options.mowLines) {
      const rad = (options.mowLines.direction ?? 0) * Math.PI / 180;
      const axis = vec2(Math.cos(rad), Math.sin(rad));
      const width = options.mowLines.width ?? 4;
      const strength = uniform(options.mowLines.strength ?? 0.08);
      const wobble = options.mowLines.wobble ?? 0.3;
      const fadeVar = options.mowLines.fadeVariation ?? 0.4;

      const wp3 = vec3(positionWorld.x, positionWorld.z, 0);
      // Edge wobble: offset the stripe coordinate with low-freq noise so
      // lines bend slightly instead of being ruler-straight.
      const bend = mx_fractal_noise_float(wp3.div(width * 4), 2).mul(wobble);
      const t = positionWorld.xz.dot(axis).add(bend).div(width);

      const wave = sin(t.mul(Math.PI));
      const stripe = smoothstep(float(-0.3), float(0.3), wave); // 0..1

      // const shade = mix(float(1.0).sub(strength), float(1.0).add(strength), stripe);
      // Patchy fading: large-scale noise scales contrast, so lines wash
      // out in spots (worn/thin turf) instead of uniform intensity.
      const fadeNoise = mx_fractal_noise_float(wp3.div(width * 10), 2)
        .mul(0.5).add(0.5);
      const localStrength = strength.mul(
        float(1.0).sub(fadeNoise.mul(fadeVar))
      );

      const shade = mix(
        float(1.0).sub(localStrength),
        float(1.0).add(localStrength),
        stripe
      );

      color = color.mul(shade);
    }

    // --- Terrain relief shading: exaggerate slope visibility ---
    if (options.shading) {
      const s = options.shading;
      const el = s.elevation * Math.PI / 180;
      const az = s.azimuth * Math.PI / 180;
      // three.js convention: azimuth 0 = +Z (south), measured toward +X
      const sunDir = vec3(
        Math.cos(el) * Math.sin(az),
        Math.sin(el),
        Math.cos(el) * Math.cos(az)
      );

      // // Hillshade: N·L remapped so flat ground = 1.0, then contrast-boosted
      // const ndl = normalWorld.dot(sunDir).clamp(0, 1);
      // const flatNdl = Math.sin(el); // N·L of perfectly flat ground
      // const contrast = uniform(s.contrast ?? 2.0);
      // const hillshade = ndl.sub(flatNdl).mul(contrast).add(1.0).clamp(0.5, 1.4);
      // Hillshade: deviation from flat, through a saturating curve.
      // tanh gives high gain near zero (subtle slopes pop) but compresses
      // large deviations, so steep slopes cap at ±maxSwing instead of black.
      // const ndl = normalWorld.dot(sunDir).clamp(0, 1);
      const ndl = normalWorldGeometry.dot(sunDir).clamp(0, 1);
      const flatNdl = Math.sin(el); // N·L of perfectly flat ground
      const contrast = uniform(s.contrast ?? 8.0);
      const maxSwing = 0.3; // brightness never leaves [0.7, 1.3]
      const hillshade = tanh(ndl.sub(flatNdl).mul(contrast)).mul(maxSwing).add(1.0);

      // Slope tint: darken by steepness (catches sun-parallel slopes)
      // const steep = float(1.0).sub(normalWorld.y.clamp(0, 1));
      const steep = float(1.0).sub(normalWorldGeometry.y.clamp(0, 1));
      // const slopeShade = float(1.0).sub(steep.mul(uniform(s.slopeTint ?? 0.15).mul(8.0)).clamp(0, 0.3));
      const slopeShade = float(1.0).sub(
        tanh(steep.mul(8.0)).mul(uniform(s.slopeTint ?? 0.1))
      );
      color = color.mul(hillshade).mul(slopeShade);
    }


    // this.colorNode = color;
    this.surfaceColor = vec3(color);
    this.colorNode = this.surfaceColor;    
    // Optional: kill normal-map detail at distance too, so the far
    // surface reads truly flat rather than flat-colored-but-bumpy.
    if (baseMat.normalMap) {
      const scale = baseMat.normalScale || new THREE.Vector2(1, 1);
      const fadedScale = vec2(scale.x, scale.y).mul(float(1.0).sub(fade));
      this.normalNode = normalMap(tslTexture(baseMat.normalMap, uv()), fadedScale);
    }
  }
}