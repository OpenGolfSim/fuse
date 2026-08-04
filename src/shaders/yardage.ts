import * as THREE from 'three/webgpu';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
  vec2, vec3, float,
  uniform as tslUniform,
  positionWorld, materialColor,
  texture as tslTexture,
  mix, dot, step,
} from 'three/tsl';

function nextPow2(v: number): number {
  return Math.pow(2, Math.ceil(Math.log2(v)));
}

export type YardageLinesMaterialOptions = {
  lineWidth?: number;
  lineLength?: number;
  lineColor?: [number, number, number, number];
  feather?: number;
  labels?: (string | number)[];
  labelSize?: [number, number];
  labelGap?: number;
  labelFont?: string;
  maxAnisotropy?: number;
  texelsPerMeter?: number;
  maxTextureSize?: number;
};

export class YardageLinesMaterial {
  material?: MeshStandardNodeMaterial;

  private lineLength: number;
  private maxDist: number;
  private pxPerMeter: number;
  private maxTexSize: number;
  private canvas: HTMLCanvasElement;
  private canvasTex: THREE.CanvasTexture;

  // TSL uniforms
  private teePosUniform: any;
  private rangeDirUniform: any;
  private perpDirUniform: any;
  private texWorldSizeUniform: any;
  private lineColorRGBUniform: any;
  private lineColorAUniform: any;

  constructor(
    object: THREE.Object3D,
    ballPos: THREE.Vector3,
    aimPoint: THREE.Vector3,
    distances: number[],
    options: YardageLinesMaterialOptions = {}
  ) {
    const lineLength = options.lineLength ?? 90;
    const lineColor  = options.lineColor  ?? [1.0, 1.0, 1.0, 0.6];
    const labelSize  = options.labelSize  ?? [5, 2.5];
    const labelGap   = options.labelGap   ?? 0.4;
    const maxAniso   = options.maxAnisotropy ?? 16;

    this.lineLength = lineLength;
    this.pxPerMeter = options.texelsPerMeter ?? 30;
    this.maxTexSize = Math.min(options.maxTextureSize ?? 4096, 8192);

    const dir = new THREE.Vector2(
      aimPoint.x - ballPos.x,
      aimPoint.z - ballPos.z
    ).normalize();

    const perpDir = new THREE.Vector2(dir.y, -dir.x);

    this.maxDist = Math.max(...distances) + labelGap + labelSize[1] + 2;

    // Create persistent canvas and texture
    this.canvas = document.createElement('canvas');
    const texW = Math.min(nextPow2(lineLength * this.pxPerMeter), this.maxTexSize);
    const texH = Math.min(nextPow2(this.maxDist * this.pxPerMeter), this.maxTexSize);
    this.canvas.width = texW;
    this.canvas.height = texH;

    this.drawLines(distances, options);

    this.canvasTex = new THREE.CanvasTexture(this.canvas);
    this.canvasTex.minFilter = THREE.LinearMipmapLinearFilter;
    this.canvasTex.magFilter = THREE.LinearFilter;
    this.canvasTex.wrapS = THREE.ClampToEdgeWrapping;
    this.canvasTex.wrapT = THREE.ClampToEdgeWrapping;
    this.canvasTex.generateMipmaps = true;
    this.canvasTex.anisotropy = maxAniso;
    this.canvasTex.needsUpdate = true;

    // TSL uniforms
    this.teePosUniform = tslUniform(new THREE.Vector3(ballPos.x, 0, ballPos.z));
    this.rangeDirUniform = tslUniform(dir);
    this.perpDirUniform = tslUniform(perpDir);
    this.texWorldSizeUniform = tslUniform(new THREE.Vector2(lineLength, this.maxDist));
    this.lineColorRGBUniform = tslUniform(new THREE.Color(lineColor[0], lineColor[1], lineColor[2]));
    this.lineColorAUniform = tslUniform(lineColor[3]);

    if (object instanceof THREE.Mesh) {
      const origMat = object.material as THREE.MeshStandardMaterial;

      const mat = new MeshStandardNodeMaterial();

      // Copy properties from original GLTF material
      if (origMat.color) mat.color = origMat.color.clone();
      if (origMat.map) mat.map = origMat.map;
      if (origMat.normalMap) mat.normalMap = origMat.normalMap;
      if (origMat.normalScale) mat.normalScale = origMat.normalScale.clone();
      if (origMat.roughnessMap) mat.roughnessMap = origMat.roughnessMap;
      if (origMat.metalnessMap) mat.metalnessMap = origMat.metalnessMap;
      if (origMat.emissive) mat.emissive = origMat.emissive.clone();
      if (origMat.emissiveMap) mat.emissiveMap = origMat.emissiveMap;
      mat.emissiveIntensity = origMat.emissiveIntensity ?? 1.0;
      mat.roughness = origMat.roughness ?? 1.0;
      mat.metalness = origMat.metalness ?? 0.0;
      mat.envMapIntensity = origMat.envMapIntensity ?? 1.0;
      if (origMat.aoMap) mat.aoMap = origMat.aoMap;
      mat.aoMapIntensity = origMat.aoMapIntensity ?? 1.0;
      if (origMat.lightMap) mat.lightMap = origMat.lightMap;
      mat.lightMapIntensity = origMat.lightMapIntensity ?? 1.0;
      mat.side = origMat.side;
      mat.toneMapped = origMat.toneMapped;

      // --- TSL: project world position onto range/perp axes ---
      const offset: any = positionWorld.xz.sub(this.teePosUniform.xz);
      const downrange = dot(offset, this.rangeDirUniform);
      const crossrange = dot(offset, this.perpDirUniform);

      // Map to texture UV
      const u: any = float(0.5).sub(crossrange.div(this.texWorldSizeUniform.x));
      const v: any = downrange.div(this.texWorldSizeUniform.y);

      // Bounds check: only show where UV is 0-1
      const inBounds: any = step(float(0), u)
        .mul(step(u, float(1)))
        .mul(step(float(0), v))
        .mul(step(v, float(1)));

      // Sample the line texture
      const lineSample: any = tslTexture(this.canvasTex, vec2(u, v));
      const mask: any = lineSample.a.mul(this.lineColorAUniform).mul(inBounds);

      // Overlay lines onto the base material color
      mat.colorNode = mix(materialColor.rgb, this.lineColorRGBUniform, mask);

      mat.needsUpdate = true;
      object.material = mat;
      this.material = mat;
    }
  }

  private drawLines(distances: number[], options: YardageLinesMaterialOptions) {
    const lineWidth = options.lineWidth ?? 0.4;
    const feather   = options.feather   ?? 0.08;
    const labelSize = options.labelSize ?? [5, 2.5];
    const labelGap  = options.labelGap  ?? 0.4;
    const labels    = options.labels;
    const font      = options.labelFont;

    const texW = this.canvas.width;
    const texH = this.canvas.height;

    const pxPerMX = texW / this.lineLength;
    const pxPerMY = texH / this.maxDist;
    const aspectCorrection = pxPerMX / pxPerMY;

    const ctx = this.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, texW, texH);

    for (let i = 0; i < distances.length; i++) {
      const d = distances[i];

      // Line stripe
      const lineY = texH - d * pxPerMY;
      const lineH = Math.max(lineWidth * pxPerMY, 1);

      const grad = ctx.createLinearGradient(0, 0, texW, 0);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(feather, 'rgba(255,255,255,1)');
      grad.addColorStop(1 - feather, 'rgba(255,255,255,1)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');

      ctx.fillStyle = grad;
      ctx.fillRect(0, lineY - lineH / 2, texW, lineH);

      // Text label
      const labelHPx     = labelSize[1] * pxPerMY;
      const labelCenterY = texH - (d + labelGap + labelSize[1] / 2) * pxPerMY;
      const fontSize     = Math.round(labelHPx * 0.8);

      const text = labels?.[i] != null ? `${labels[i]}` : `${distances[i]}`;

      ctx.save();
      ctx.translate(texW / 2, labelCenterY);
      ctx.scale(aspectCorrection, 1);
      ctx.fillStyle    = 'white';
      ctx.font         = font ?? `bold ${fontSize}px Arial`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 0, 0);
      ctx.restore();
    }
  }

  setDistances(distances: number[], options: YardageLinesMaterialOptions = {}) {
    this.maxDist = Math.max(...distances) + (options.labelGap ?? 0.4) + (options.labelSize?.[1] ?? 2.5) + 2;

    const texW = Math.min(nextPow2(this.lineLength * this.pxPerMeter), this.maxTexSize);
    const texH = Math.min(nextPow2(this.maxDist * this.pxPerMeter), this.maxTexSize);

    this.canvas.width = texW;
    this.canvas.height = texH;
    this.drawLines(distances, options);

    this.canvasTex.needsUpdate = true;
    this.texWorldSizeUniform.value.set(this.lineLength, this.maxDist);
  }

  setLineColor(r: number, g: number, b: number, a: number) {
    this.lineColorRGBUniform.value.setRGB(r, g, b);
    this.lineColorAUniform.value = a;
  }

  dispose() {
    this.canvasTex.dispose();
    if (this.material) {
      this.material.dispose();
      this.material = undefined;
    }
  }
}