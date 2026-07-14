// src/fuse/SandBlendMaterial.js
import * as THREE from 'three/webgpu';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
  texture as tslTexture,
  vec2,
  vec3,
  vec4,
  float,
  mix,
  smoothstep,
  positionWorld,
  uniform,
  cameraPosition,
} from 'three/tsl';

type SurfaceConfig = {
  roughnessFactor?: number,
  tileSize?: number,
  tint?: string,
  blending?: {
    distance?: number,
    noiseFreq?: number,
    noiseAmp?: number,
    sandNoiseFreq?: number,
    sandBaseHeight?: number,
    sandLowDarken?: number,
    sandVariationStrength?: number,
    lipDarken?: number,
    dirtTint?: string,
    dirtWidth?: number,
    dirtStrength?: number,
    distanceExaggeration?: number,
  }
}


type SandMaterialOptions = {
  baseTexture?: THREE.Texture,
  neighborTexture?: THREE.Texture,
  noiseTexture?: THREE.Texture,
  blendMap?: {
    data: Uint8Array,
    width: number,
    height: number,
    bounds: { w: number, h: number, x: number, y: number },
  },
  config?: SurfaceConfig,
  neighborConfig?: SurfaceConfig,
}

export class SandMaterial {
  material;

  constructor(
    baseMesh: THREE.Mesh,
    noiseTexture: THREE.Texture,
    blendMap?: BlendMapData,
    neighborMesh?: THREE.Mesh,
    blendSettings: SurfaceConfig['blending'] = {}
  ) {
    const baseMat = baseMesh.material;
    if (!(baseMat instanceof THREE.MeshStandardMaterial)) {
      throw new Error('Base material requires a MeshStandardMaterial');
    }
    const baseTexture = baseMat.map;
    const baseTint = baseMat.color || new THREE.Color(1, 1, 1);
    const baseTileSize = baseMesh.userData.tileSize || 2.5;
    const baseRoughness = baseMat.roughness ?? 0.9;
    if (!baseTexture) {
      throw new Error('Base material requires a base texture map');
    }
    // Build the new node material
    this.material = new MeshStandardNodeMaterial({
      transparent: false,
    });
    this.material.roughness = baseRoughness;

    // Copy normal map if present
    if (baseMat.normalMap) {
      this.material.normalMap = baseMat.normalMap;
      this.material.normalScale = baseMat.normalScale?.clone() || new THREE.Vector2(1, 1);
    }

    // Base texture tiled by world position
    const baseTiledUV = positionWorld.xz.div(float(baseTileSize));
    const baseColorTex = tslTexture(baseTexture, baseTiledUV);
    const baseColor = baseColorTex.mul(vec3(baseTint.r, baseTint.g, baseTint.b));

    const sandNoiseFreq = float(blendSettings.sandNoiseFreq || 0.15);
    const sandNoiseUV1 = positionWorld.xz.mul(sandNoiseFreq);
    const sandNoise1 = tslTexture(noiseTexture, sandNoiseUV1).r;
    // const sandNoiseUV2 = positionWorld.xz.mul(float(blendSettings.sandNoiseFreq || 0.15).mul(4.0));
    const sandNoiseUV2 = positionWorld.xz.mul(sandNoiseFreq.mul(4.0));

    const sandNoise2 = tslTexture(noiseTexture, sandNoiseUV2).r;
    const sandVariation = sandNoise1.mul(0.6).add(sandNoise2.mul(0.4));

    const heightRef = float(blendSettings.sandBaseHeight || 0);
    const heightFactor = positionWorld.y.sub(heightRef).clamp(-2, 2).div(2.0);
    const lowSpotDarken = float(1.0).sub(
      float(1.0).sub(heightFactor).clamp(0, 1).mul(float(blendSettings.sandLowDarken || 0.25))
    );
    const sandDarkenAmount = float(1.0).sub(
      float(1.0).sub(sandVariation).mul(float(blendSettings.sandVariationStrength || 0.5))
    );
    const finalSand = baseColor.mul(sandDarkenAmount).mul(lowSpotDarken);


    // ── Combine ──
    // const surfaceColor = mix(tintedGrass, finalSand, isSand);
    // this.material.colorNode = surfaceColor.mul(lipDarken);

    // ── Edge blending (only if neighbor + blendMap provided) ──
    if (blendMap && neighborMesh) {
      const neighborMat = neighborMesh.material;
      if (!(neighborMat instanceof THREE.MeshStandardMaterial)) {
        console.warn(`baseMesh: ${baseMesh.name}`, baseMat);
        console.warn(`neighborMesh: ${neighborMesh.name}`, neighborMat);
        throw new Error('Neighbor material requires a MeshStandardMaterial');
      }
      const neighborTexture = neighborMat.map;
      if (!neighborTexture) {
        throw new Error('Neighbor material requires neighbors to have a base texture');
      }
      const neighborTint = neighborMat.color || new THREE.Color(1, 1, 1);
      const neighborTileSize = neighborMesh.userData.tileSize || 2.0;

      const neighborTiledUV = positionWorld.xz.div(float(neighborTileSize));
      const neighborColorTex = tslTexture(neighborTexture, neighborTiledUV);
      const neighborColor = neighborColorTex.mul(vec3(neighborTint.r, neighborTint.g, neighborTint.b));

      const blendTex = new THREE.DataTexture(
        new Uint8Array(blendMap.data),
        blendMap.width,
        blendMap.height,
        THREE.RGBAFormat
        // THREE.RedFormat,
      );
      blendTex.needsUpdate = true;
      blendTex.magFilter = THREE.LinearFilter;
      blendTex.minFilter = THREE.LinearFilter;
      blendTex.generateMipmaps = false;
      blendTex.colorSpace = THREE.NoColorSpace;
      blendTex.wrapS = THREE.ClampToEdgeWrapping;
      blendTex.wrapT = THREE.ClampToEdgeWrapping;

      const boundsX = uniform(blendMap.bounds.x);
      const boundsY = uniform(blendMap.bounds.y);
      const boundsW = uniform(blendMap.bounds.w);
      const boundsH = uniform(blendMap.bounds.h);

      const blendU = positionWorld.x.sub(boundsX).div(boundsW);
      const blendV = positionWorld.z.sub(boundsY).div(boundsH);
      const blendSample = tslTexture(blendTex, vec2(blendU, blendV)).r;

      const noiseFreq = float(blendSettings.noiseFreq || 0.5);
      const noiseAmp = float(blendSettings.noiseAmp || 0.3);
      const noiseUV = positionWorld.xz.mul(noiseFreq);
      const noiseSample = tslTexture(noiseTexture, noiseUV).r;

      const distFromEdge = blendSample.sub(0.5).mul(2.0).clamp(0, 1);

      const cameraDist = positionWorld.sub(cameraPosition).length();
      const distSoften = smoothstep(float(20.0), float(120.0), cameraDist);
      const distScale = smoothstep(float(10.0), float(100.0), cameraDist)
        .mul(float(blendSettings.distanceExaggeration || 1.5))
        .add(1.0);

      const noiseUV2 = positionWorld.xz.mul(noiseFreq.mul(3.2));
      const noiseSample2 = tslTexture(noiseTexture, noiseUV2).r;
      const combinedNoise = noiseSample.mul(0.6).add(noiseSample2.mul(0.4));

      const effectiveNoiseAmp = noiseAmp.mul(float(1.0).sub(distSoften.mul(0.7)));
      const scaledNoiseAmp = effectiveNoiseAmp.mul(distScale);
      const cutoff = combinedNoise.mul(scaledNoiseAmp);

      const transitionWidth = float(0.02).add(distSoften.mul(0.15));
      const isSand = smoothstep(cutoff, cutoff.add(transitionWidth), distFromEdge);

      const dirtColor = vec3(
        new THREE.Color(blendSettings.dirtTint || '#5a4a32').r,
        new THREE.Color(blendSettings.dirtTint || '#5a4a32').g,
        new THREE.Color(blendSettings.dirtTint || '#5a4a32').b,
      );
      const dirtWidth = float(blendSettings.dirtWidth || 0.15).mul(distScale);
      const dirtAmount = smoothstep(cutoff.sub(dirtWidth), cutoff, distFromEdge)
        .mul(float(blendSettings.dirtStrength || 0.5));
      const tintedGrass = mix(neighborColor, vec4(dirtColor, 1.0), dirtAmount);

      const lipWidth = float(0.08).mul(distScale);
      const lipStart = cutoff.sub(lipWidth);
      const lipEnd = cutoff.add(0.02);
      const lipStrength = float(blendSettings.lipDarken || 0.25);
      const lipAmount = smoothstep(lipStart, lipEnd, distFromEdge)
        .mul(float(1.0).sub(smoothstep(lipEnd, lipEnd.add(0.05), distFromEdge)));
      const lipDarken = float(1.0).sub(lipAmount.mul(lipStrength));

      const surfaceColor = mix(tintedGrass, finalSand, isSand);
      this.material.colorNode = surfaceColor.mul(lipDarken);
    } else {
      this.material.colorNode = finalSand;
    }

    // Apply to the mesh
    baseMesh.material = this.material;
  }

  dispose() {
    this.material.dispose();
  }
}

