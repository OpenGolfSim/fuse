import * as THREE from 'three';

export class SkyBox {
  constructor(renderer, exrPath) {
    this.pmremGenerator = new THREE.PMREMGenerator(renderer);
    this.pmremGenerator.compileEquirectangularShader();
    this.exrLoader = new EXRLoader();
    this.sky = null;
  }

  async load(exrPath) {
    
    const texture = await this.exrLoader.loadAsync(exrPath);
    texture.mapping = THREE.EquirectangularReflectionMapping;

    // Use PMREM version only for lighting
    const envMap = this.pmremGenerator.fromEquirectangular(texture).texture;
    scene.environment = envMap;
    this.pmremGenerator.dispose();

    // Render background on a manually controlled sphere
    const skyGeo = new THREE.SphereGeometry(400, 60, 40);
    const skyMat = new THREE.MeshBasicMaterial({ map: texture, depthWrite: false, fog: false });
    this.sky = new THREE.Mesh(skyGeo, skyMat);

    this.sky.geometry.scale(-1, 1, 1); // flip inside-out so we see it from within
    this.sky.scale.set(2, 1, 2);      // additionally squash to lower the horizon
    this.sky.position.set(0, 50, 0);      // additionally squash to lower the horizon
    // sky.scale.set(1, 0.6, 1);      // additionally squash to lower the horizon
    this.sky.rotation.y = -0.5;
    // sky.rotation.x = -0.1;

    // const texture = await exrLoader.loadAsync(exrPath);

    // texture.mapping = THREE.EquirectangularReflectionMapping;

    // // Use PMREM version only for lighting
    // const envMap = this.pmremGenerator.fromEquirectangular(texture).texture;
    // scene.environment = envMap;
    // this.pmremGenerator.dispose();
    
    // scene.add(this.sky);
    return this.sky;
  }
}

export class VolumetricClouds {
  constructor(camera, options = {}) {
    this.camera = camera;
    const density = options.density ?? 0.4;
    const opacity = options.opacity ?? 0.8;
    const scale = options.scale ?? 5.0;
    const radius = options.radius ?? 800;
    const position = options.position ?? new THREE.Vector3(0, 0, 0);
    // colors
    const skyColor = options.skyColor ?? new THREE.Color(0.53, 0.81, 0.92);
    const cloudColor = options.cloudColor ?? new THREE.Color(1.0, 1.0, 1.0);
    const fogColor = options.fogColor ?? new THREE.Color(0.75, 0.82, 0.92);

    this.cloudMaterial = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        densityThreshold: { value: density },
        opacity: { value: opacity },
        scale: { value: scale },
        sphereCenter: { value: position.clone() },
        cloudColor: { value: cloudColor },
        skyColor: { value: skyColor },
        fogColor: { value: fogColor },
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        varying vec3 vLocalPosition;
        void main() {
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPos.xyz;
          vLocalPosition = position;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
          gl_Position.z = gl_Position.w;
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform float densityThreshold;
        uniform float opacity;
        uniform float scale;
        uniform vec3 sphereCenter;
        uniform vec3 cloudColor;
        uniform vec3 skyColor;
        uniform vec3 fogColor;
        varying vec3 vWorldPosition;
        varying vec3 vLocalPosition;

        float hash(vec3 p) {
          p = fract(p * vec3(443.897, 441.423, 437.195));
          p += dot(p, p.yxz + 19.19);
          return fract((p.x + p.y) * p.z);
        }

        float smoothNoise(vec3 p) {
          vec3 i = floor(p);
          vec3 f = fract(p);
          vec3 u = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(mix(hash(i),               hash(i + vec3(1,0,0)), u.x),
                mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), u.x), u.y),
            mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), u.x),
                mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), u.x), u.y),
            u.z
          );
        }

        float fbm(vec3 p) {
          float value = 0.0;
          float amplitude = 0.5;
          float frequency = 1.0;
          for (int i = 0; i < 6; i++) {
            value += amplitude * smoothNoise(p * frequency);
            amplitude *= 0.5;
            frequency *= 2.0;
          }
          return value;
        }

        void main() {
          vec3 p = vLocalPosition * (0.05 / scale) + vec3(time * 0.02, 0.0, 0.0);
          float d = fbm(p);
          d = smoothstep(densityThreshold, densityThreshold + 0.3, d);
          // height fade: 0 at equator, 1 at top              // <-- added
          vec3 dir = normalize(vWorldPosition - sphereCenter);
          float heightFactor = dot(dir, vec3(0.0, 1.0, 0.0));
          // float horizonFade = smoothstep(0.1, 0.2, heightFactor);
          // 1 at horizon, 0 higher up
          // float horizonBlend = 0.8 - smoothstep(0.0, 0.3, heightFactor);
          // smooth fog blend: full fog below horizon, fades out above
          float horizonBlend = 1.0 - smoothstep(-0.05, 0.25, heightFactor);
          // thin out cloud density near the fog zone
          float cloudFade = smoothstep(0.0, 0.2, heightFactor);
          d *= cloudFade;

          // blend sky → cloud based on density
          vec3 baseColor = mix(skyColor, cloudColor, d);
          // blend toward fog at the horizon
          vec3 finalColor = mix(baseColor, fogColor, horizonBlend);

          // sky is visible at a low base alpha; clouds add opacity on top
          float baseAlpha = 0.15;
          float finalAlpha = mix(baseAlpha + d * opacity, 1.0, horizonBlend);

          gl_FragColor = vec4(finalColor, finalAlpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    
    // A large flat box works well for a cloud layer
    // const geometry = new THREE.BoxGeometry(500, 80, 500);
    const geometry = new THREE.SphereGeometry(radius, 32, 32);
    this.object = new THREE.Mesh(geometry, this.cloudMaterial);
    this.object.frustumCulled = false;
    this.object.renderOrder = -1;
    this.cloudMaterial.depthWrite = false; // you already have this    
    this.object.position.copy(position);
  }

  update() {
    // this.cloudMaterial.uniforms.time.value += 0.01; // increment each frame
    // keep sphere centered on camera so horizon stays level
    this.object.position.x = this.camera.position.x;
    this.object.position.z = this.camera.position.z;
    this.cloudMaterial.uniforms.sphereCenter.value.copy(this.object.position);
  }
}
