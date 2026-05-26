import * as THREE from 'three';

/**
 * SlopeGridShaderMaterial
 *
 * Extends MeshStandardMaterial with a slope-visualising grid overlay.
 *
 * Grid lines are rendered via a tiling texture with mipmapping and
 * anisotropic filtering, so they stay crisp at distance and at grazing
 * angles — the same approach Unity uses.  Dots are procedural so they
 * can animate along each grid line in the downhill direction.
 *
 * Usage:
 *   const slopeMat = new SlopeGridShaderMaterial(greenMesh.material);
 *   greenMesh.material = slopeMat;
 *
 *   // When setting up a new shot / repositioning the camera:
 *   slopeMat.lockOrientation(camera);
 *
 *   // Every frame:
 *   slopeMat.update(camera);
 *   renderer.render(scene, camera);
 */

// ── Grid texture generator ──────────────────────────────────────────────────

function createGridTexture(
  lineWidth: number,
  gridSpacing: number,
  texSize = 512,
  anisotropy = 16,
): THREE.DataTexture {
  const linePx = Math.max(1, Math.round((lineWidth / gridSpacing) * texSize));
  const data = new Uint8Array(texSize * texSize * 4);

  for (let y = 0; y < texSize; y++) {
    for (let x = 0; x < texSize; x++) {
      const i = (y * texSize + x) * 4;
      // Lines along the left and bottom edges of the cell.
      // When the texture repeats these become the grid intersections.
      const isLine = x < linePx || y < linePx;

      // White with alpha — colour is applied in the shader so it
      // can be changed at runtime without regenerating the texture.
      data[i]     = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = isLine ? 255 : 0;
    }
  }

  const tex = new THREE.DataTexture(data, texSize, texSize, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  return tex;
}

// ── GLSL chunks ─────────────────────────────────────────────────────────────

const uniformDeclarations = /* glsl */ `
  uniform float uTime;

  uniform float uGridSpacing;
  uniform sampler2D uGridTex;

  uniform float uDotRadius;
  uniform float uDotSpacing;
  uniform float uDotSpeed;

  uniform vec3  uGridLineColor;
  uniform float uGridLineAlpha;
  uniform vec3  uDotColor;
  uniform float uDotAlpha;

  uniform float uSlopeMin;
  uniform float uSlopeMax;

  uniform vec2  uGridForward;
  uniform vec3  uCameraWorldPos;
  uniform float uFadeNear;
  uniform float uFadeFar;
`;

const varyingDecl = /* glsl */ `
  varying vec3 vSlopeWorldPos;
  varying vec3 vSlopeWorldNormal;
`;

const vertexInjection = /* glsl */ `
  vSlopeWorldPos = worldPosition.xyz;
  vSlopeWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
`;

const gridOverlayFragment = /* glsl */ `
  {
    vec2 wxz = vSlopeWorldPos.xz;
    vec3 wNorm = normalize(vSlopeWorldNormal);

    // ── Slope (downhill = positive) ──────────────────────────────────────
    vec2 slopeDir = vec2(wNorm.x, wNorm.z) / max(wNorm.y, 0.001);
    float slopeMag = length(slopeDir);

    float slopeFade = (uSlopeMax <= uSlopeMin)
      ? 1.0
      : smoothstep(uSlopeMin, uSlopeMax, slopeMag);

    // ── Camera-aligned grid axes ─────────────────────────────────────────
    vec2 gridFwd   = length(uGridForward) > 0.001
                       ? normalize(uGridForward)
                       : vec2(0.0, 1.0);
    vec2 gridRight = vec2(gridFwd.y, -gridFwd.x);

    vec2 gxz       = vec2(dot(wxz, gridRight), dot(wxz, gridFwd));
    vec2 gridSlope = vec2(dot(slopeDir, gridRight), dot(slopeDir, gridFwd));

    // ── Distance fade ────────────────────────────────────────────────────
    float fragDist = distance(vSlopeWorldPos, uCameraWorldPos);
    float gridFade = (uFadeNear >= uFadeFar)
      ? 1.0
      : 1.0 - smoothstep(uFadeNear, uFadeFar, fragDist);

    // ── Grid lines (texture-based) ───────────────────────────────────────
    // The GPU's mipmap chain + anisotropic filtering keeps lines crisp at
    // distance and at grazing angles — no fract() discontinuities.
    vec2 gridUV = gxz / uGridSpacing;
    float gridLine = texture2D(uGridTex, gridUV).a;

    // ── Distance to nearest grid line (for constraining dots to lines) ───
    float distToH = abs(fract(gxz.y / uGridSpacing + 0.5) - 0.5) * uGridSpacing;
    float distToV = abs(fract(gxz.x / uGridSpacing + 0.5) - 0.5) * uGridSpacing;

    // ── Dots on horizontal lines ─────────────────────────────────────────
    float hPhase     = fract((gxz.x - gridSlope.x * uTime * uDotSpeed) / uDotSpacing);
    float hAlongDist = min(hPhase, 1.0 - hPhase) * uDotSpacing;
    float hDotDist   = length(vec2(hAlongDist, distToH));
    float hDot       = 1.0 - smoothstep(0.0, uDotRadius, hDotDist);

    // ── Dots on vertical lines ───────────────────────────────────────────
    float vPhase     = fract((gxz.y - gridSlope.y * uTime * uDotSpeed) / uDotSpacing);
    float vAlongDist = min(vPhase, 1.0 - vPhase) * uDotSpacing;
    float vDotDist   = length(vec2(distToV, vAlongDist));
    float vDot       = 1.0 - smoothstep(0.0, uDotRadius, vDotDist);

    float dots = max(hDot, vDot);

    // ── Composite ────────────────────────────────────────────────────────
    float lineA = gridLine * uGridLineAlpha * slopeFade * gridFade;
    float dotA  = dots     * uDotAlpha      * slopeFade * gridFade;

    vec3 withLines   = mix(diffuseColor.rgb, uGridLineColor, lineA);
    diffuseColor.rgb = mix(withLines, uDotColor, dotA);
  }
`;

// ── Options ──────────────────────────────────────────────────────────────────

type SlopeGridShaderMaterialOptions = {
  gridSpacing?: number;          // distance between lines in world units       (0.35)
  lineWidth?: number;            // line half-width in world units              (0.012)
  texSize?: number;              // grid texture resolution per cell            (512)
  anisotropy?: number;           // anisotropic filtering level                 (16)

  dotRadius?: number;            // dot radius in world units                   (0.028)
  dotSpacing?: number;           // gap between dot centres along a line        (0.18)
  dotSpeed?: number;             // animation speed multiplier                  (1.0)

  gridLineColor?: THREE.Vector3; // line colour                                (pale yellow)
  gridLineAlpha?: number;        // line opacity                               (0.3)
  dotColor?: THREE.Vector3;      // dot colour                                 (bright yellow)
  dotAlpha?: number;             // dot opacity                                (0.75)

  slopeMin?: number;             // slope mag below which grid fades out       (0 = off)
  slopeMax?: number;             // slope mag at which grid is fully visible   (0 = off)

  fadeNear?: number;             // world-unit distance where fade begins       (20)
  fadeFar?: number;              // world-unit distance where grid disappears   (35)
};

// ── Material ─────────────────────────────────────────────────────────────────

export class SlopeGridShaderMaterial extends THREE.MeshStandardMaterial {
  _slopeUniforms: Record<string, { value: any }>;
  baseMaterial: THREE.Material;
  _shader?: THREE.WebGLProgramParametersWithUniforms;

  private _startTime: number;
  private _camFwd: THREE.Vector3;
  private _gridTex: THREE.DataTexture;
  private _texSize: number;
  private _anisotropy: number;

  constructor(baseMaterial: THREE.Material, options: SlopeGridShaderMaterialOptions = {}) {
    super();
    this.copy(baseMaterial);

    this.name = `${baseMaterial.name || 'green'}_slopeGrid`;
    this.baseMaterial = baseMaterial;
    this._startTime = performance.now() / 1000;
    this._camFwd = new THREE.Vector3();
    this._texSize = options.texSize ?? 512;
    this._anisotropy = options.anisotropy ?? 16;

    const spacing = options.gridSpacing ?? 0.35;
    const lw = options.lineWidth ?? 0.012;

    this._gridTex = createGridTexture(lw, spacing, this._texSize, this._anisotropy);

    this._slopeUniforms = {
      uTime: { value: 0 },

      uGridSpacing: { value: spacing },
      uGridTex:     { value: this._gridTex },

      uDotRadius:  { value: options.dotRadius  ?? 0.028 },
      uDotSpacing: { value: options.dotSpacing ?? 0.18 },
      uDotSpeed:   { value: options.dotSpeed   ?? 1.0 },

      uGridLineColor: { value: options.gridLineColor ?? new THREE.Vector3(1.0, 1.0, 0.65) },
      uGridLineAlpha: { value: options.gridLineAlpha ?? 0.3 },
      uDotColor:      { value: options.dotColor      ?? new THREE.Vector3(1.0, 1.0, 0.25) },
      uDotAlpha:      { value: options.dotAlpha       ?? 0.75 },

      uSlopeMin: { value: options.slopeMin ?? 0.0 },
      uSlopeMax: { value: options.slopeMax ?? 0.0 },

      uGridForward:    { value: new THREE.Vector2(0, 1) },
      uCameraWorldPos: { value: new THREE.Vector3() },
      uFadeNear:       { value: options.fadeNear ?? 20 },
      uFadeFar:        { value: options.fadeFar  ?? 35 },
    };

    this.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this._slopeUniforms);

      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        '#include <common>\n' + varyingDecl
      );
      shader.vertexShader = shader.vertexShader.replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\n' + vertexInjection
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        '#include <common>\n' + uniformDeclarations + varyingDecl
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        '#include <map_fragment>\n' + gridOverlayFragment
      );

      this._shader = shader;
    };

    this.defines = this.defines || {};
    this.defines['USE_ENVMAP'] = '';
  }

  // ── Grid texture ───────────────────────────────────────────────────────

  /**
   * Regenerate the grid line texture.  Call after changing gridSpacing or
   * if you want a different line thickness at runtime.
   */
  rebuildGridTexture(lineWidth: number): void {
    this._gridTex.dispose();
    this._gridTex = createGridTexture(
      lineWidth,
      this._slopeUniforms.uGridSpacing.value,
      this._texSize,
      this._anisotropy,
    );
    this._slopeUniforms.uGridTex.value = this._gridTex;
  }

  // ── Orientation ────────────────────────────────────────────────────────

  /**
   * Capture the camera's current look direction and lock the grid to it.
   * Call once when setting up a new shot or repositioning the camera.
   */
  lockOrientation(camera: THREE.Camera): void {
    this._camFwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
    const fwd = this._slopeUniforms.uGridForward.value as THREE.Vector2;
    fwd.set(this._camFwd.x, this._camFwd.z);
    if (fwd.lengthSq() > 0.0001) fwd.normalize();
  }

  // ── Per-frame update ───────────────────────────────────────────────────

  /**
   * Advance dot animation and update camera position for distance fade.
   * Does NOT change grid orientation — call lockOrientation() for that.
   */
  update(camera?: THREE.Camera): void {
    this._slopeUniforms.uTime.value = performance.now() / 1000 - this._startTime;
    if (camera) {
      this._slopeUniforms.uCameraWorldPos.value.copy(camera.position);
    }
  }

  // ── Cleanup ────────────────────────────────────────────────────────────

  dispose(): void {
    this._gridTex.dispose();
    super.dispose();
  }

  // ── Accessors ──────────────────────────────────────────────────────────

  get time(): number             { return this._slopeUniforms.uTime.value; }
  set time(v: number)            { this._slopeUniforms.uTime.value = v; }

  get gridSpacing(): number      { return this._slopeUniforms.uGridSpacing.value; }
  set gridSpacing(v: number)     { this._slopeUniforms.uGridSpacing.value = v; }

  get dotRadius(): number        { return this._slopeUniforms.uDotRadius.value; }
  set dotRadius(v: number)       { this._slopeUniforms.uDotRadius.value = v; }

  get dotSpacing(): number       { return this._slopeUniforms.uDotSpacing.value; }
  set dotSpacing(v: number)      { this._slopeUniforms.uDotSpacing.value = v; }

  get dotSpeed(): number         { return this._slopeUniforms.uDotSpeed.value; }
  set dotSpeed(v: number)        { this._slopeUniforms.uDotSpeed.value = v; }

  get gridLineColor(): THREE.Vector3 { return this._slopeUniforms.uGridLineColor.value; }
  set gridLineColor(v: THREE.Vector3){ this._slopeUniforms.uGridLineColor.value = v; }

  get gridLineAlpha(): number    { return this._slopeUniforms.uGridLineAlpha.value; }
  set gridLineAlpha(v: number)   { this._slopeUniforms.uGridLineAlpha.value = v; }

  get dotColor(): THREE.Vector3  { return this._slopeUniforms.uDotColor.value; }
  set dotColor(v: THREE.Vector3) { this._slopeUniforms.uDotColor.value = v; }

  get dotAlpha(): number         { return this._slopeUniforms.uDotAlpha.value; }
  set dotAlpha(v: number)        { this._slopeUniforms.uDotAlpha.value = v; }

  get slopeMin(): number         { return this._slopeUniforms.uSlopeMin.value; }
  set slopeMin(v: number)        { this._slopeUniforms.uSlopeMin.value = v; }

  get slopeMax(): number         { return this._slopeUniforms.uSlopeMax.value; }
  set slopeMax(v: number)        { this._slopeUniforms.uSlopeMax.value = v; }

  get fadeNear(): number         { return this._slopeUniforms.uFadeNear.value; }
  set fadeNear(v: number)        { this._slopeUniforms.uFadeNear.value = v; }

  get fadeFar(): number          { return this._slopeUniforms.uFadeFar.value; }
  set fadeFar(v: number)         { this._slopeUniforms.uFadeFar.value = v; }
}