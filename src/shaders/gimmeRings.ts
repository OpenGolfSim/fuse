import * as THREE from 'three/webgpu';
import { type Node, type UniformNode } from 'three/webgpu';
import {
  vec3, float,
  uniform as tslUniform,
  smoothstep as tslSmoothstep, mix, max,
  fwidth, Fn,
} from 'three/tsl';
import { GolfBall } from '@/objects/golfBall';

// --- TSL helper: anti-aliased ring outline ---
const ringOutline = Fn(([dist, radius, width]: [Node<'float'>, Node<'float'>, Node<'float'>]) => {
  const hw = width.mul(0.5);
  const fw = fwidth(dist);
  const edge = max(fw, float(0.01));
  const inner = tslSmoothstep(radius.sub(hw).sub(edge), radius.sub(hw).add(edge), dist);
  const outer = float(1.0).sub(
    tslSmoothstep(radius.add(hw).sub(edge), radius.add(hw).add(edge), dist)
  );
  return inner.mul(outer);
});

// --- TSL helper: anti-aliased zone fill between two radii ---
const zoneFill = Fn(([dist, lo, hi]: [Node<'float'>, Node<'float'>, Node<'float'>]) => {
  const fw = fwidth(dist);
  const edge = max(fw, float(0.01));
  const inner = tslSmoothstep(lo.sub(edge), lo.add(edge), dist);
  const outer = float(1.0).sub(
    tslSmoothstep(hi.sub(edge), hi.add(edge), dist)
  );
  return inner.mul(outer);
});

/**
 * Gimme rings (1–3) around the hole: white outlines, yellow fill + glow
 * on the ring containing the ball. Shared by TargetShaderMaterial and
 * PuttingGridMaterial.
 */
export class GimmeRings {
  readonly ringSizes: number[];
  readonly activeUniform: any = tslUniform(new THREE.Vector3(0, 0, 0));
  readonly visibleUniform: UniformNode<'float', number> = tslUniform(1.0); // 0 = hidden, 1 = shown
  lerpSpeed = 4.0;

  private currentActive = new THREE.Vector3(0, 0, 0);
  private ringWidth: number;
  private requiresGreen: boolean;

  constructor(gimmeDistances: number[], ringWidth = 0.05, requiresGreen = true) {
    // 1–3 rings supported (activeUniform is a vec3).
    // Non-positive distances = disabled ring; skip so nothing is drawn.
    this.ringSizes = gimmeDistances.filter(d => d > 0).slice(0, 3);
    this.ringWidth = ringWidth;
    this.requiresGreen = requiresGreen;
  }

  /**
   * Composite rings over `baseColor`.
   * `dist` = fragment's XZ distance to the hole.
   */
  build(baseColor: any, dist: any): { color: any, emissive: any } {
    const ringW = float(this.ringWidth);
    const glowIntensity = float(3.0); // > 1.0 so bloom picks it up
    const activeColorRGB = vec3(...new THREE.Color('#ffd900').toArray());
    const activeColorA = float(0.01);
    const inactiveColorRGB = vec3(...new THREE.Color('#ffffff').toArray());
    const inactiveColorA = float(0.8);

    const vis = this.visibleUniform;
    const active = this.activeUniform;
    const activeComps = [active.x, active.y, active.z];

    const outlines: any[] = [];
    const fills: any[] = [];
    this.ringSizes.forEach((r, i) => {
      const lo = i === 0 ? 0 : this.ringSizes[i - 1];
      outlines.push(ringOutline(dist, float(r), ringW));
      fills.push(zoneFill(dist, float(lo), float(r)));
    });

    let color: any = baseColor;

    // White outlines
    for (const o of outlines) {
      color = mix(color, inactiveColorRGB, o.mul(inactiveColorA).mul(vis));
    }

    // Yellow fill — fades in/out with activeUniform
    fills.forEach((f, i) => {
      color = mix(color, activeColorRGB, f.mul(activeColorA).mul(activeComps[i]));
    });

    // Emissive glow for the active ring (HDR, drives bloom)
    let fillGlow: any = float(0);
    let outlineGlow: any = float(0);
    this.ringSizes.forEach((_, i) => {
      fillGlow = fillGlow.add(fills[i].mul(activeComps[i]));
      outlineGlow = outlineGlow.add(outlines[i].mul(activeComps[i]));
    });

    const glowMask = fillGlow
      .mul(0.04)                   // soft fill glow
      .add(outlineGlow)            // bright ring edge
      .clamp(0.0, 1.0);

    const emissive = activeColorRGB.mul(glowMask.mul(glowIntensity).mul(vis));
    return { color, emissive };
  }

  update(golfBall: GolfBall, holePos: THREE.Vector3, dt: number) {
    if (!golfBall.object) {
      console.warn('No golfball object!');
      return;
    }

    const target = new THREE.Vector3(0, 0, 0);
    const active = this.requiresGreen
      ? golfBall.isOnGreen()
      : golfBall.physics?.isGrounded;
    if (active) {
      const dist = Math.hypot(
        golfBall.object.position.x - holePos.x,
        golfBall.object.position.z - holePos.z
      );

      // Activate the innermost ring containing the ball.
      // For original behavior (last ring stays active beyond its radius), use:
      //   target.setComponent(idx === -1 ? this.ringSizes.length - 1 : idx, 1.0);
      const idx = this.ringSizes.findIndex(r => dist <= r);
      if (idx !== -1) target.setComponent(idx, 1.0);
    }

    const t = 1.0 - Math.exp(-this.lerpSpeed * dt);
    this.currentActive.lerp(target, t);
    this.activeUniform.value.copy(this.currentActive);
  }

  setVisible(visible: boolean) {
    this.visibleUniform.value = visible ? 1.0 : 0.0;
    if (!visible) {
      this.currentActive.set(0, 0, 0);
      this.activeUniform.value.set(0, 0, 0);
    }
  }
}