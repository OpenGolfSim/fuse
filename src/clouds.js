export class VolumetricClouds {
  constructor(options = {}) {
    const density = options.density ?? 0.4;
    const scale = options.scale ?? 5.0;
    const radius = options.radius ?? 800;
    const position = options.position ?? new THREE.Vector3(0, 0, 0);

    this.cloudMaterial = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        densityThreshold: { value: density },
        scale: { value: scale },
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPos.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform float densityThreshold;
        uniform float scale;
        varying vec3 vWorldPosition;

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
          vec3 p = vWorldPosition * (0.05 / scale) + vec3(time * 0.02, 0.0, 0.0);
          float d = fbm(p);
          d = smoothstep(densityThreshold, densityThreshold + 0.3, d);
          vec3 cloudColor = mix(vec3(0.8, 0.85, 0.9), vec3(1.0), d);
          gl_FragColor = vec4(cloudColor, d * 0.9);
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
    this.object.position.copy(position);
  }

  update() {
    // this.cloudMaterial.uniforms.time.value += 0.01; // increment each frame
  }
}
