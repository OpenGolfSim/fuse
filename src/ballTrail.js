import { MeshLineGeometry, MeshLineMaterial, raycast } from 'meshline'

const MAX_POINTS = 4000;

function resampleByArcLength(points, spacing) {
  if (points.length < 2) return points.slice();

  const out = [points[0].clone()];
  let traveled = 0;
  let nextTarget = spacing;

  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const segLen = a.distanceTo(b);
    if (segLen === 0) continue;

    while (traveled + segLen >= nextTarget) {
      const t = (nextTarget - traveled) / segLen;
      out.push(a.clone().lerp(b, t));
      nextTarget += spacing;
    }
    traveled += segLen;
  }

  const last = points[points.length - 1];
  if (out[out.length - 1].distanceToSquared(last) > 1e-6) {
    out.push(last.clone());
  }
  return out;
}

function createTrailAlphaMap() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 1;
  const ctx = canvas.getContext('2d');

  const gradient = ctx.createLinearGradient(0, 0, 256, 0);
  // Fade at the OLD end of the trail (U=0). Flip stops if you want
  // the fade at the ball end instead.
  gradient.addColorStop(0.00, 'rgba(255, 255, 255, 0)');
  gradient.addColorStop(0.05, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(1.00, 'rgba(255, 255, 255, 1)');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 1);

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

export class BallTrail {
  constructor(scene, golfBall, options = {}) {
    this.scene = scene;
    this.golfBall = golfBall;
    this.maxPoints = options.maxPoints ?? MAX_POINTS;
    this.lineWidth = options.lineWidth ?? 0.1;
    this.color = options.color ?? 0x237afc;
    this.fadeLength = options.fadeLength ?? 10.0;        // world units
    this.resampleSpacing = options.resampleSpacing ?? 0.15;
    // Camera-distance fade controls (in world units)
    this._camFade = {
      uCamFadeNear: { value: options.cameraFadeNear ?? 2.0 }, // fully transparent here
      uCamFadeFar:  { value: options.cameraFadeFar  ?? 4.5 }, // fully opaque past here
    };

    this.points = [];
    this.frameNum = 0;
    this.trail = null;
    this.geom = null;

    // Reusable alpha-map canvas; we redraw the gradient each frame
    this._alphaCanvas = document.createElement('canvas');
    this._alphaCanvas.width = 256;
    this._alphaCanvas.height = 1;
    this._alphaCtx = this._alphaCanvas.getContext('2d');
    this._alphaTex = new THREE.CanvasTexture(this._alphaCanvas);
    this._alphaTex.minFilter = THREE.LinearFilter;
    this._alphaTex.magFilter = THREE.LinearFilter;
    this._alphaTex.generateMipmaps = false;

    this.material = new MeshLineMaterial({
      color: this.color,
      lineWidth: this.lineWidth,
      transparent: true,
      depthWrite: true,
      depthTest: true,
      resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
      sizeAttenuation: 1,
      useAlphaMap: 1,
      alphaMap: this._alphaTex,
    });

    this.material.uniforms.uCamFadeNear = this._camFade.uCamFadeNear;
    this.material.uniforms.uCamFadeFar  = this._camFade.uCamFadeFar;

    // Vertex shader: forward world position to fragment shader
    this.material.vertexShader = this.material.vertexShader
      .replace(
        'void main()',
        'varying vec3 vWorldPos;\nvoid main()'
      )
      .replace(
        'void main() {',
        'void main() {\n  vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;'
      );

    // Fragment shader: fade alpha based on world-space distance to camera
    this.material.fragmentShader = this.material.fragmentShader
      .replace(
        'void main()',
        `uniform float uCamFadeNear;
        uniform float uCamFadeFar;
        varying vec3 vWorldPos;
        void main()`
      )
      .replace(
        'gl_FragColor = diffuseColor;',
        `diffuseColor.a *= smoothstep(uCamFadeNear, uCamFadeFar, distance(vWorldPos, cameraPosition));
        gl_FragColor = diffuseColor;`
      );      

    this.material.needsUpdate = true;

  }

  _updateAlphaMap(totalLength) {
    const ctx = this._alphaCtx;
    // Fraction of U that should be the fade region at each end
    const fade = Math.min(0.49, this.fadeLength / Math.max(totalLength, 0.0001));

    ctx.clearRect(0, 0, 256, 1);
    const g = ctx.createLinearGradient(0, 0, 256, 0);
    g.addColorStop(0.0,        'rgba(255,255,255,0)');
    g.addColorStop(fade,       'rgba(255,255,255,1)');
    g.addColorStop(1.0 - fade, 'rgba(255,255,255,1)');
    g.addColorStop(1.0,        'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 1);
    this._alphaTex.needsUpdate = true;
  }
  clear() {
    this.points = [];
    this._rebuild();
  }

  addPoint() {
    // Skip duplicates so MeshLine doesn't choke on zero-length segments
    const p = this.golfBall.position;
    const last = this.points[this.points.length - 1];
    if (!last || last.distanceToSquared(p) > 1e-6) {
      this.points.push(p.clone());
    }
  }

  update(collectPoints = false) {
    if (collectPoints && this.frameNum % 4 === 0 && this.points.length < this.maxPoints) {
      this.addPoint();
    }
    this.frameNum++;
    this._rebuild();
  }

  _rebuild() {
    if (this.trail) {
      this.scene.remove(this.trail);
      this.geom.dispose();
      this.trail = null;
      this.geom = null;
    }

    const live = this.golfBall.position;
    const last = this.points[this.points.length - 1];
    const raw = (!last || last.distanceToSquared(live) > 1e-6)
      ? [...this.points, live.clone()]
      : this.points;

    if (raw.length < 2) return;

    // Densify so UV ≈ arc length, and so the fade region has plenty of vertices
    const head = resampleByArcLength(raw, this.resampleSpacing);
    if (head.length < 2) return;

    // Total arc length, used to size the fade region
    let total = 0;
    for (let i = 1; i < head.length; i++) total += head[i].distanceTo(head[i - 1]);
    this._updateAlphaMap(total);

    const flat = new Float32Array(head.length * 3);
    for (let i = 0; i < head.length; i++) {
      flat[i * 3]     = head[i].x;
      flat[i * 3 + 1] = head[i].y;
      flat[i * 3 + 2] = head[i].z;
    }

    this.geom = new MeshLineGeometry();
    this.geom.setPoints(flat);

    this.trail = new THREE.Mesh(this.geom, this.material);
    this.trail.frustumCulled = false;
    this.scene.add(this.trail);
  }


  remove() {
    if (this.trail) this.scene.remove(this.trail);
  }
}
