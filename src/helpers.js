
const MAX_POINTS = 4000;

function createTrailAlphaMap() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 1;
  const ctx = canvas.getContext('2d');

  const gradient = ctx.createLinearGradient(0, 0, 256, 0);
  gradient.addColorStop(0.0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.90, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.98, 'rgba(255, 255, 255, 0)');
  gradient.addColorStop(1.0, 'rgba(255, 255, 255, 0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 1);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

export class BallTrail {
  constructor(scene, golfBall, options = { maxPoints: MAX_POINTS, lineWidth: 0.1, color: 0xfce323 }) {
    this.scene = scene;
    this.golfBall = golfBall;
    this.pointCount = 0;
    this.maxPoints = options.maxPoints;
    this.lineWidth = options.lineWidth;
    this.color = options.color;

    this.trailPoints = [];
    this.trailCurve = null;
    this.frameNum = 0;

    this.trailMaterial = new MeshLineMaterial({
      color: this.color,
      lineWidth: this.lineWidth,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      alphaTest: 0.01,
      resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
      side: THREE.DoubleSide,  // changed from DoubleSide
      useAlphaMap: 1,
      alphaMap: createTrailAlphaMap()
    });
  }

  clear() {
    this.trailPoints = [];
    this.update();
  }
  addPoint() {
    this.trailPoints.push(this.golfBall.position.clone());
  }

  update(collectPoints = false) {

    if (collectPoints && this.frameNum % 4 === 0 && this.pointCount < MAX_POINTS) {
      this.addPoint();
    }    
    this.frameNum++;

    if (this.trail) {
      this.scene.remove(this.trail);
      if (this.trailGeometry) this.trailGeometry.dispose();
      this.trail = null;
    }

    if (this.trailPoints.length < 1) {
      this.trailCurve = null;
      return;
    }

    const points = [...this.trailPoints, this.golfBall.position.clone()];

    // Need at least 4 points for stable Frenet frames
    if (points.length < 4) {
      this.trailCurve = null;
      return;
    }

    // Filter out duplicate / near-duplicate points that can confuse the curve
    const filtered = [points[0]];
    for (let i = 1; i < points.length; i++) {
      if (points[i].distanceTo(filtered[filtered.length - 1]) > 0.001) {
        filtered.push(points[i]);
      }
    }

    if (filtered.length < 4) {
      this.trailCurve = null;
      return;
    }

    try {
      this.trailCurve = new THREE.CatmullRomCurve3(filtered, false, 'centripetal');

      this.trailGeometry = new THREE.TubeGeometry(
        this.trailCurve,
        filtered.length * 4,
        0.04,
        8,
        false
      );

      this.trail = new THREE.Mesh(this.trailGeometry, this.trailMaterial);
      this.trail.frustumCulled = false;
      this.scene.add(this.trail);
    } catch (err) {
      console.warn('Trail build failed:', err, 'points:', filtered.length);
      this.trailCurve = null;
    }
  }
}

export class GroundUtils {
  static getGroundY(rapierInstance, world, x, z, startY = 1000, maxDistance = 2000) {
    const origin = { x, y: startY, z };
    const direction = { x: 0, y: -1, z: 0 };

    const ray = new rapierInstance.Ray(origin, direction);

    const solid = true; // treat colliders as solid (hit on entry)
    const hit = world.castRay(ray, maxDistance, solid);
    if (hit !== null) {
      // Distance along the ray to the hit point
      const hitY = startY + direction.y * hit.timeOfImpact;
      const collider = hit.collider; // the Collider that was hit
      return { y: hitY, collider };
    }
    return null;
  }
}