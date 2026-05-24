import * as THREE from 'three';
import { GroundUtils } from '@/physics/groundPhysics';
import { type GolfBall } from '@/objects/golfBall';

export type AimKeys = { left: boolean, right: boolean, forward: boolean, backward: boolean };

type ShotPerspectiveCameraOptions = {
  trackingDelay?: number;
}

export class ShotPerspectiveCamera extends THREE.PerspectiveCamera {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  shotDirection: THREE.Vector3;
  staticCamPos: THREE.Vector3;
  staticLookAt: THREE.Vector3;
  currentLookAt: THREE.Vector3;
  desiredCamPos: THREE.Vector3;
  desiredLookAt: THREE.Vector3;
  isTracking: boolean;
  aimVelocity: { lateral: number, longitudinal: number };
  aimSpeed: number;
  aimKeys: AimKeys;
  trackingDelay: number;

  #lastGroundCheck: THREE.Vector3;
  #groundY: number;
  #right: THREE.Vector3;
  #up: THREE.Vector3;
  #trackTimeout: number;
  

  constructor(fov: number, near: number, far: number, renderer: THREE.WebGLRenderer, scene: THREE.Scene, options: ShotPerspectiveCameraOptions = {}) {
    const aspect = (window.innerWidth / window.innerHeight);
    super(fov, aspect, near, far);
    
    this.scene = scene;
    this.renderer = renderer;
    this.shotDirection = new THREE.Vector3();
    this.staticCamPos = new THREE.Vector3();
    this.staticLookAt = new THREE.Vector3();
    this.currentLookAt = new THREE.Vector3();
    this.desiredCamPos = new THREE.Vector3();
    this.desiredLookAt = new THREE.Vector3();
    
    this.isTracking = false;
    this.layers.enable(2);
    
    this.aimVelocity = { lateral: 0, longitudinal: 0 };
    this.#lastGroundCheck = new THREE.Vector3();
    this.#groundY = 0;
    this.#right = new THREE.Vector3();
    this.#up = new THREE.Vector3(0, 1, 0);

    this.aimSpeed = 10; // meters per second
    this.aimKeys = { left: false, right: false, forward: false, backward: false };    
    this.trackingDelay = options.trackingDelay ?? 3000;
    this.#trackTimeout = 0;
    
    window.addEventListener('resize', this._handleResize.bind(this));
  }
  _handleResize() {
    this.aspect = window.innerWidth / window.innerHeight;
    this.updateProjectionMatrix();
    if (this.renderer) {
      this.renderer.setSize(window.innerWidth, window.innerHeight);  
    }
  }

  setTracking(track: boolean, timeScale = 1) {
    clearTimeout(this.#trackTimeout);
    if (track) {
      const trackingDelay = Math.max(this.trackingDelay * timeScale, 500);
      this.#trackTimeout = setTimeout(() => {
        this.isTracking = true;
      }, trackingDelay);
    } else {
      this.isTracking = false;
    }
  }
  
  setPositions(startPoint: THREE.Vector3, aimPoint: THREE.Vector3) {
    const back = new THREE.Vector3().subVectors(startPoint, aimPoint).normalize();
    back.y = 0;
    back.normalize();
    this.staticCamPos.copy(startPoint).addScaledVector(back, 4);
    this.staticCamPos.y += 1.0;
    this.staticLookAt.copy(aimPoint);

    // this.position.copy(this.staticCamPos);
    // this.currentLookAt.copy(this.staticLookAt);
    // this.lookAt(this.currentLookAt);

    // Lock in the downrange direction for the whole shot.
    // Horizontal only so camera height stays stable.
    this.shotDirection.subVectors(aimPoint, startPoint);
    this.shotDirection.y = 0;
    this.shotDirection.normalize();
  }

  updateAim(dt: number, startPoint: THREE.Vector3, aimPoint: THREE.Vector3) {
    const { left, right, forward, backward } = this.aimKeys;
    // if (!(left || right || forward || backward)) return false;
    const ramp = 1 - Math.exp(-dt * 20);
    const decay = 1 - Math.exp(-dt * 12);

    const latTarget = left ? 1 : right ? -1 : 0;
    const lonTarget = forward ? 1 : backward ? -1 : 0;

    this.aimVelocity.lateral += (latTarget - this.aimVelocity.lateral) * (latTarget ? ramp : decay);
    this.aimVelocity.longitudinal += (lonTarget - this.aimVelocity.longitudinal) * (lonTarget ? ramp : decay);

    if (Math.abs(this.aimVelocity.lateral) < 0.001) this.aimVelocity.lateral = 0;
    if (Math.abs(this.aimVelocity.longitudinal) < 0.001) this.aimVelocity.longitudinal = 0;

    if (this.aimVelocity.lateral === 0 && this.aimVelocity.longitudinal === 0) return

    const dist = startPoint.distanceTo(aimPoint);
    const angleStep = this.aimSpeed * dt * (Math.PI / 180); // degrees per second

    if (this.aimVelocity.lateral !== 0) {
      const angle = this.aimVelocity.lateral * angleStep;
      const offset = new THREE.Vector3().subVectors(aimPoint, startPoint);
      offset.applyAxisAngle(this.#up, angle);
      aimPoint.copy(startPoint).add(offset);
    }

    if (this.aimVelocity.longitudinal !== 0) {
      aimPoint.addScaledVector(this.shotDirection, this.aimVelocity.longitudinal * dist * angleStep);
    }

    const dx = aimPoint.x - this.#lastGroundCheck.x;
    const dz = aimPoint.z - this.#lastGroundCheck.z;
    const threshold = dist * 0.01; // 1% of distance to aim point
    if (dx * dx + dz * dz > threshold * threshold) {
      const ground = GroundUtils.getGroundYFromScene(this.scene, aimPoint.x, aimPoint.z);
      if (ground) {
        this.#groundY = ground.y;
      }
      this.#lastGroundCheck.set(aimPoint.x, 0, aimPoint.z);
    }
    aimPoint.y = THREE.MathUtils.lerp(aimPoint.y, this.#groundY, 0.3);

    this.setPositions(startPoint, aimPoint);
    return true;
  }

  render(scene: THREE.Scene, fog: THREE.Fog) {
    scene.fog = fog;
    this.renderer.render(scene, this);
  }


  update(dt: number, golfBall: GolfBall, startPoint: THREE.Vector3, aimPoint: THREE.Vector3) {
    if (dt && this.isTracking && golfBall.object) {
      const posSmooth  = 1 - Math.exp(-dt * 2.5);
      const lookSmooth = 1 - Math.exp(-dt * 3.5);
      const tmpBack = new THREE.Vector3().copy(this.shotDirection).negate();

      this.desiredCamPos.copy(golfBall.object.position).addScaledVector(tmpBack, 6);
      this.desiredCamPos.y += 2.5;
      this.desiredLookAt.copy(golfBall.object.position);

      this.position.lerp(this.desiredCamPos, posSmooth);
      this.currentLookAt.lerp(this.desiredLookAt, lookSmooth);
      this.lookAt(this.currentLookAt);
      return false;
    }
    // Only allow aiming when no shot is active
    let aimChanged = false;
    if (!golfBall.isShotActive) {
      aimChanged = !!this.updateAim(dt, startPoint, aimPoint);
    }

    this.position.copy(this.staticCamPos);
    this.currentLookAt.copy(this.staticLookAt);
    this.lookAt(this.currentLookAt);
    if (aimChanged) return true;

    return false;
  }
}