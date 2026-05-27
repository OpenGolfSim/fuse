import * as THREE from 'three';

const MAX_LINES = 32;
const ATLAS_CELL_W = 256;
const ATLAS_CELL_H = 128;

export type YardageLinesMaterialOptions = {
  lineWidth?: number;
  lineLength?: number;
  lineColor?: [number, number, number, number];
  feather?: number;
  labels?: string[];                              // custom labels, defaults to distance values
  labelSize?: [number, number];                   // [width, height] in world units
  labelGap?: number;                              // gap between line and label (downrange)
  labelColor?: [number, number, number, number];
  labelFont?: string;
};

export class YardageLinesMaterial {
  customUniforms: Record<string, { value: any }>;
  material?: THREE.Material;

  constructor(
    object: THREE.Object3D,
    teeWorldPos: THREE.Vector3,
    direction: THREE.Vector3,
    distances: number[],
    options: YardageLinesMaterialOptions = {}
  ) {
    const lineWidth  = options.lineWidth  ?? 0.15;
    const lineLength = options.lineLength ?? 80;
    const lineColor  = options.lineColor  ?? [1.0, 1.0, 1.0, 0.6];
    const feather    = options.feather    ?? 0.08;

    const labelSize  = options.labelSize  ?? [5, 2.5];
    const labelGap   = options.labelGap   ?? 0.4;
    const labelColor = options.labelColor ?? [1.0, 1.0, 1.0, 0.85];
    const labels     = options.labels;

    const dir = new THREE.Vector2(direction.x, direction.z).normalize();

    const count = Math.min(distances.length, MAX_LINES);
    const paddedDistances = new Float32Array(MAX_LINES);
    for (let i = 0; i < count; i++) paddedDistances[i] = distances[i];

    // Build the text atlas
    const atlas = this.buildAtlas(distances, labels, options.labelFont);

    this.customUniforms = {
      teePos:        { value: new THREE.Vector3(teeWorldPos.x, 0, teeWorldPos.z) },
      rangeDir:      { value: new THREE.Vector2(dir.x, dir.y) },
      lineDistances: { value: paddedDistances },
      lineCount:     { value: count },
      lineWidth:     { value: lineWidth },
      lineLength:    { value: lineLength },
      lineColor:     { value: new THREE.Vector4(lineColor[0], lineColor[1], lineColor[2], lineColor[3]) },
      feather:       { value: feather },
      labelAtlas:    { value: atlas },
      labelSize:     { value: new THREE.Vector2(labelSize[0], labelSize[1]) },
      labelGap:      { value: labelGap },
      labelColor:    { value: new THREE.Vector4(labelColor[0], labelColor[1], labelColor[2], labelColor[3]) },
      labelCellCount:{ value: count },
    };

    if (object instanceof THREE.Mesh) {
      const mat = object.material.clone();

      mat.onBeforeCompile = (shader: THREE.WebGLProgramParametersWithUniforms) => {
        Object.assign(shader.uniforms, this.customUniforms);

        // ── Vertex shader ──
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

        // ── Fragment shader: declarations ──
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <common>',
          /* glsl */ `
            #include <common>
            varying vec3 vWorldPos;
            uniform vec3 teePos;
            uniform vec2 rangeDir;
            uniform float lineDistances[${MAX_LINES}];
            uniform float lineCount;
            uniform float lineWidth;
            uniform float lineLength;
            uniform vec4 lineColor;
            uniform float feather;

            uniform sampler2D labelAtlas;
            uniform vec2 labelSize;      // (width, height) in world units
            uniform float labelGap;
            uniform vec4 labelColor;
            uniform float labelCellCount;

            float stripeMask(float downrange, float targetDist, float width) {
              float hw   = width * 0.5;
              float fw   = fwidth(downrange);
              float edge = max(fw, 0.005);
              return smoothstep(targetDist - hw - edge, targetDist - hw + edge, downrange)
                   * (1.0 - smoothstep(targetDist + hw - edge, targetDist + hw + edge, downrange));
            }

            float lengthMask(float crossrange, float halfLen, float featherLen) {
              float fw   = fwidth(crossrange);
              float edge = max(fw, 0.005);
              float mask = smoothstep(-halfLen - edge, -halfLen + edge, crossrange)
                         * (1.0 - smoothstep(halfLen - edge, halfLen + edge, crossrange));
              if (featherLen > 0.0) {
                float innerEdge = halfLen - featherLen;
                mask *= 1.0 - smoothstep(innerEdge, halfLen, abs(crossrange));
              }
              return mask;
            }
          `
        );

        // ── Fragment shader: compositing ──
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <map_fragment>',
          /* glsl */ `
            #include <map_fragment>

            vec2 offset      = vWorldPos.xz - teePos.xz;
            float downrange  = dot(offset, rangeDir);
            vec2 perpDir = vec2(-rangeDir.y, rangeDir.x);
            float crossrange = dot(offset, perpDir);

            float halfLen    = lineLength * 0.5;
            float featherLen = feather * lineLength;
            float lMask      = lengthMask(crossrange, halfLen, featherLen);

            float totalLineMask  = 0.0;
            float totalLabelMask = 0.0;
            vec3  labelBlend     = vec3(0.0);
            int count = int(lineCount);

            for (int i = 0; i < ${MAX_LINES}; i++) {
              if (i >= count) break;
              float d = lineDistances[i];

              // ── Line stripe ──
              totalLineMask += stripeMask(downrange, d, lineWidth);

              // ── Label rectangle ──
              // Positioned just downrange of the line, centered on crossrange
              float labelMinD = d + labelGap;
              float labelMaxD = labelMinD + labelSize.y;
              float halfLabelW = labelSize.x * 0.5;

              // Normalized coords within the label rectangle
              float lu = (crossrange + halfLabelW) / labelSize.x;
              // float lv = 1.0 - (downrange - labelMinD) / labelSize.y; // flip V so text reads correctly from tee
              float lv = (downrange - labelMinD) / labelSize.y; // flip V so text reads correctly from tee

              // Bounds mask (no branching — always sample, mask out-of-bounds)
              float inBounds = step(0.001, lu) * step(lu, 0.999)
                             * step(0.001, lv) * step(lv, 0.999);

              // Atlas UV: each label occupies 1/cellCount horizontal strip
              vec2 atlasUV = vec2(
                (float(i) + clamp(lu, 0.0, 1.0)) / labelCellCount,
                clamp(lv, 0.0, 1.0)
              );
              float glyphAlpha = texture2D(labelAtlas, atlasUV).a;

              totalLabelMask += glyphAlpha * inBounds;
            }

            totalLineMask  = clamp(totalLineMask * lMask, 0.0, 1.0);
            totalLabelMask = clamp(totalLabelMask, 0.0, 1.0);

            // Composite lines
            diffuseColor.rgb = mix(diffuseColor.rgb, lineColor.rgb, totalLineMask * lineColor.a);
            // Composite labels on top
            diffuseColor.rgb = mix(diffuseColor.rgb, labelColor.rgb, totalLabelMask * labelColor.a);
          `
        );
      };

      mat.needsUpdate = true;
      object.material = mat;
      this.material = mat;
    }
  }

  /** Renders all yardage numbers into a single horizontal texture atlas. */
  private buildAtlas(
    distances: number[],
    labels?: string[],
    font?: string
  ): THREE.CanvasTexture {
    const count = Math.min(distances.length, MAX_LINES);
    const canvas = document.createElement('canvas');
    canvas.width  = ATLAS_CELL_W * count;
    canvas.height = ATLAS_CELL_H;

    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'white';
    ctx.font = font ?? 'bold 80px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let i = 0; i < count; i++) {
      const text = labels?.[i] ?? `${distances[i]}`;
      ctx.fillText(text, ATLAS_CELL_W * i + ATLAS_CELL_W / 2, ATLAS_CELL_H / 2);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    return tex;
  }

  /** Swap distances (and optionally labels) at runtime. */
  setDistances(distances: number[], labels?: string[], font?: string) {
    const count = Math.min(distances.length, MAX_LINES);
    const arr = this.customUniforms.lineDistances.value as Float32Array;
    arr.fill(0);
    for (let i = 0; i < count; i++) arr[i] = distances[i];

    this.customUniforms.lineCount.value = count;
    this.customUniforms.labelCellCount.value = count;

    // Rebuild the atlas with new labels
    const oldTex = this.customUniforms.labelAtlas.value as THREE.CanvasTexture;
    oldTex.dispose();
    this.customUniforms.labelAtlas.value = this.buildAtlas(distances, labels, font);
  }

  setLineColor(r: number, g: number, b: number, a: number) {
    this.customUniforms.lineColor.value.set(r, g, b, a);
  }

  setLabelColor(r: number, g: number, b: number, a: number) {
    this.customUniforms.labelColor.value.set(r, g, b, a);
  }

  dispose() {
    (this.customUniforms.labelAtlas.value as THREE.Texture)?.dispose();
  }
}