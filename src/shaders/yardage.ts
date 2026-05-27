import * as THREE from 'three';

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
};

export class YardageLinesMaterial {
  customUniforms: Record<string, { value: any }>;
  material?: THREE.Material;

  private lineLength: number;
  private maxDist: number;
  private pxPerMeter: number;
  private maxTexSize: number;

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
    this.maxTexSize = 8192;

    const dir = new THREE.Vector2(
      aimPoint.x - ballPos.x,
      aimPoint.z - ballPos.z
    ).normalize();

    const perpDir = new THREE.Vector2(dir.y, -dir.x);

    this.maxDist = Math.max(...distances) + labelGap + labelSize[1] + 2;

    const texW = Math.min(nextPow2(lineLength * this.pxPerMeter), this.maxTexSize);
    const texH = Math.min(nextPow2(this.maxDist * this.pxPerMeter), this.maxTexSize);

    const tex = this.buildLineTexture(texW, texH, distances, options);
    tex.anisotropy = maxAniso;

    this.customUniforms = {
      teePos:       { value: new THREE.Vector3(ballPos.x, 0, ballPos.z) },
      rangeDir:     { value: dir },
      perpDir:      { value: perpDir },
      lineTexture:  { value: tex },
      texWorldSize: { value: new THREE.Vector2(lineLength, this.maxDist) },
      lineColor:    { value: new THREE.Vector4(lineColor[0], lineColor[1], lineColor[2], lineColor[3]) },
    };

    if (object instanceof THREE.Mesh) {
      const mat = object.material.clone();

      mat.onBeforeCompile = (shader: THREE.WebGLProgramParametersWithUniforms) => {
        Object.assign(shader.uniforms, this.customUniforms);

        shader.vertexShader = shader.vertexShader.replace(
          '#include <common>',
          /* glsl */ `
            #include <common>
            varying vec3 vWorldPos;
          `
        );
        shader.vertexShader = shader.vertexShader.replace(
          '#include <worldpos_vertex>',
          /* glsl */ `
            #include <worldpos_vertex>
            vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
          `
        );

        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <common>',
          /* glsl */ `
            #include <common>
            varying vec3 vWorldPos;
            uniform vec3 teePos;
            uniform vec2 rangeDir;
            uniform vec2 perpDir;
            uniform sampler2D lineTexture;
            uniform vec2 texWorldSize;
            uniform vec4 lineColor;
          `
        );

        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <map_fragment>',
          /* glsl */ `
            #include <map_fragment>

            vec2 offset      = vWorldPos.xz - teePos.xz;
            float downrange  = dot(offset, rangeDir);
            float crossrange = dot(offset, perpDir);

            float u = 0.5 - crossrange / texWorldSize.x;
            float v = downrange / texWorldSize.y;

            float inBounds = step(0.0, u) * step(u, 1.0)
                           * step(0.0, v) * step(v, 1.0);

            vec4 lineSample = texture2D(lineTexture, vec2(u, v));
            float mask = lineSample.a * lineColor.a * inBounds;

            diffuseColor.rgb = mix(diffuseColor.rgb, lineColor.rgb, mask);
          `
        );
      };

      mat.needsUpdate = true;
      object.material = mat;
      this.material = mat;
    }
  }

  private buildLineTexture(
    texW: number, texH: number,
    distances: number[],
    options: YardageLinesMaterialOptions
  ): THREE.CanvasTexture {
    const lineWidth = options.lineWidth ?? 0.4;
    const feather   = options.feather   ?? 0.08;
    const labelSize = options.labelSize ?? [5, 2.5];
    const labelGap  = options.labelGap  ?? 0.4;
    const labels    = options.labels;
    const font      = options.labelFont;

    const pxPerMX = texW / this.lineLength;
    const pxPerMY = texH / this.maxDist;
    const aspectCorrection = pxPerMX / pxPerMY;

    const canvas = document.createElement('canvas');
    canvas.width  = texW;
    canvas.height = texH;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, texW, texH);

    for (let i = 0; i < distances.length; i++) {
      const d = distances[i];

      // ── Line stripe ──
      const lineY = texH - d * pxPerMY;
      const lineH = Math.max(lineWidth * pxPerMY, 1);

      const grad = ctx.createLinearGradient(0, 0, texW, 0);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(feather, 'rgba(255,255,255,1)');
      grad.addColorStop(1 - feather, 'rgba(255,255,255,1)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');

      ctx.fillStyle = grad;
      ctx.fillRect(0, lineY - lineH / 2, texW, lineH);

      // ── Text label ──
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

    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter       = THREE.LinearMipmapLinearFilter;
    tex.magFilter       = THREE.LinearFilter;
    tex.wrapS           = THREE.ClampToEdgeWrapping;
    tex.wrapT           = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = true;
    tex.needsUpdate     = true;
    return tex;
  }

  setDistances(distances: number[], options: YardageLinesMaterialOptions = {}) {
    this.maxDist = Math.max(...distances) + (options.labelGap ?? 0.4) + (options.labelSize?.[1] ?? 2.5) + 2;

    const texW = Math.min(nextPow2(this.lineLength * this.pxPerMeter), this.maxTexSize);
    const texH = Math.min(nextPow2(this.maxDist * this.pxPerMeter), this.maxTexSize);

    const oldTex = this.customUniforms.lineTexture.value as THREE.CanvasTexture;
    const aniso  = oldTex.anisotropy;
    oldTex.dispose();

    const tex = this.buildLineTexture(texW, texH, distances, options);
    tex.anisotropy = aniso;
    this.customUniforms.lineTexture.value = tex;
    this.customUniforms.texWorldSize.value.set(this.lineLength, this.maxDist);
  }

  setLineColor(r: number, g: number, b: number, a: number) {
    this.customUniforms.lineColor.value.set(r, g, b, a);
  }

  dispose() {
    (this.customUniforms.lineTexture.value as THREE.Texture)?.dispose();
  }
}