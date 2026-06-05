import * as THREE from 'three';

export interface LightingParams {
  ambientColor?: THREE.Color;
  ambientIntensity?: number;
  sunColor?: THREE.Color;
  sunIntensity?: number;
  /** 0 = surface faces away from sun, 1 = directly facing it */
  sunFactor?: number;
}

export function extractLightingFromScene(scene: THREE.Scene): LightingParams {
  let ambientColor = new THREE.Color(0x000000);
  let ambientIntensity = 0;
  let sunColor = new THREE.Color(0xffffff);
  let sunIntensity = 0;
  let sunFactor = 0.5; // still an approximation without a real normal

  scene.traverse((obj) => {
    if (obj instanceof THREE.AmbientLight) {
      ambientColor = obj.color.clone();
      ambientIntensity = obj.intensity;
    } else if (obj instanceof THREE.DirectionalLight) {
      // Take the strongest directional light as "sun"
      if (obj.intensity > sunIntensity) {
        sunColor = obj.color.clone();
        sunIntensity = obj.intensity;
        // Rough estimate: how much does this light point downward?
        // Grass normals are mostly (0,1,0), so dot with -light.direction
        const dir = new THREE.Vector3();
        obj.getWorldDirection(dir);
        sunFactor = Math.max(0, -dir.y); // higher = more top-down
      }
    } else if (obj instanceof THREE.HemisphereLight) {
      // Hemisphere: blend sky/ground, bias toward sky for upward-facing grass
      ambientColor.lerp(obj.color, 0.7);
      ambientColor.lerp(obj.groundColor, 0.3);
      ambientIntensity = obj.intensity;
    }
  });

  return { ambientColor, ambientIntensity, sunColor, sunIntensity, sunFactor };
}


function applyLighting(color: THREE.Color, lighting?: LightingParams): THREE.Color {
  if (!lighting) return color;

  const {
    ambientColor = new THREE.Color(0xffffff),
    ambientIntensity = 0.3,
    sunColor = new THREE.Color(0xfff4e0),
    sunIntensity = 0.7,
    sunFactor = 0.5,
  } = lighting;

  // Ambient contribution (always present)
  const r = color.r * ambientColor.r * ambientIntensity
          + color.r * sunColor.r * sunIntensity * sunFactor;
  const g = color.g * ambientColor.g * ambientIntensity
          + color.g * sunColor.g * sunIntensity * sunFactor;
  const b = color.b * ambientColor.b * ambientIntensity
          + color.b * sunColor.b * sunIntensity * sunFactor;

  return new THREE.Color(
    Math.min(r, 1),
    Math.min(g, 1),
    Math.min(b, 1)
  );
}
export function getAverageTextureColor(material: THREE.MeshStandardMaterial, sampleSize = 64) {

  // Start with the main material color (usually 0x000000 to 0xffffff)
  const baseColor = material.color.clone();

  // Factor in the emissive color if one exists
  if (material.emissive) {
      baseColor.add(material.emissive);
  }

  // // Convert to RGB float values [0, 1]
  // let r = baseColor.r;
  // let g = baseColor.g;
  // let b = baseColor.b;

  const texture = material.map;

  if (texture?.image) {
    const canvas = document.createElement('canvas');
    canvas.width = sampleSize;
    canvas.height = sampleSize;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Unable to create canvas context');

    ctx.drawImage(texture.image as HTMLImageElement, 0, 0, sampleSize, sampleSize);
    const pixelData = ctx.getImageData(0, 0, sampleSize, sampleSize).data;

    const totalPixels = sampleSize * sampleSize;

    let sumR = 0, sumG = 0, sumB = 0;
    let minLum = Infinity, maxLum = -Infinity;
    let darkestR = 0, darkestG = 0, darkestB = 0;
    let lightestR = 0, lightestG = 0, lightestB = 0;

    for (let i = 0; i < pixelData.length; i += 4) {
      const r = pixelData[i] / 255;
      const g = pixelData[i + 1] / 255;
      const b = pixelData[i + 2] / 255;

      sumR += r;
      sumG += g;
      sumB += b;

      // Perceptual luminance — weights green highest since
      // human eyes are most sensitive to it
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;

      if (lum < minLum) {
        minLum = lum;
        darkestR = r; darkestG = g; darkestB = b;
      }
      if (lum > maxLum) {
        maxLum = lum;
        lightestR = r; lightestG = g; lightestB = b;
      }
    }


    // Blend with material base color (multiply, same as your original)
    const avg = new THREE.Color(
      baseColor.r * (sumR / totalPixels),
      baseColor.g * (sumG / totalPixels),
      baseColor.b * (sumB / totalPixels)
    );
    const dark = new THREE.Color(
      baseColor.r * darkestR,
      baseColor.g * darkestG,
      baseColor.b * darkestB
    );
    const light = new THREE.Color(
      baseColor.r * lightestR,
      baseColor.g * lightestG,
      baseColor.b * lightestB
    );

    const lighting: LightingParams = {
      ambientColor: new THREE.Color('#ffffff'),
      ambientIntensity: 0.1,
      sunColor: new THREE.Color(0xfff4e0),
      sunIntensity: 0.1,
      sunFactor: 0.5,
    };
    return {
      base: avg,
      dark,
      light
    };
  }

  // No texture — fall back to material color only
  const base = new THREE.Color(baseColor.r, baseColor.g, baseColor.b);
  
  const light = base.clone().multiplyScalar(1.3);
  light.r = Math.min(light.r, 1);
  light.g = Math.min(light.g, 1);
  light.b = Math.min(light.b, 1);

  return {
    base,
    dark: base.clone().multiplyScalar(0.5),
    light,
  };
}

export async function getTextureImageData(buffer: BlobPart) {
  // const bufferViewIndex = image.bufferView;
  // const buffer = await model.parser.getDependency('bufferView', bufferViewIndex);
  const blob = new Blob([buffer], { type: 'image/png' });
  const bitmap = await window.createImageBitmap(blob, { premultiplyAlpha: 'none' });
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Unable to get 2D context!');
  }
  ctx.drawImage(bitmap, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { data, width, height };
}