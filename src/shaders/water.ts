import * as THREE from 'three';
import { Water } from 'three/examples/jsm/Addons.js';
import normals from '@/images/waternormals.jpg';


type WaterSurfaceOptions = {
  speed?: number,
  textureScale?: number,
  water?: {
    textureWidth?: number,
    textureHeight?: number,
    alpha?: number,
    fog?: boolean,
    sunColor?: THREE.Color,
    waterColor?: THREE.Color,
    distortionScale?: number,
  },
  shader?: {
    scatterFloor?: number,
    normalStrength?: number,
    reflectAmount?: number,
    reflectMax?: number,
    skyTint?: number[],
    skyTintBlend?: number,
    glintStrength?: number,
  }
}
export class WaterSurface {
  speed: number;
  water: Water;
  _shaderRef?: THREE.WebGLProgramParametersWithUniforms;
  
  constructor(waterObject: THREE.Mesh, options: Partial<WaterSurfaceOptions> = {}) {
    // const { speed, textureScale, water: waterOptions, shader: shaderOptions } = Object.assign({ ...defaultOptions }, options);
    const merged = {
      speed: 0.3,
      textureScale: 1,
      ...options,
      water: {
        textureWidth: 512,
        textureHeight: 512,
        alpha: 0.5,
        fog: false,
        sunColor: new THREE.Color('#fff5e6'),
        waterColor: new THREE.Color('#0a2f1f'),
        distortionScale: 1.0,
        ...options.water || {},
      },
      shader: {
        scatterFloor: 0.35,
        normalStrength: 0.8,
        reflectAmount: 0.05,
        reflectMax: 0.1,
        skyTint: [0.443, 0.749, 0.596],
        skyTintBlend: 0.8,
        glintStrength: 0.4,
        ...options.shader || {},
      },
    };
    const { speed, textureScale, water: waterOptions, shader: shaderOptions } = merged;

    this.speed = speed;

    const textureLoader = new THREE.TextureLoader();
    const waterNormals = textureLoader.load(
      normals,
      (texture) => {
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      }
    );
    
    const sun = new THREE.Vector3();
    // phi = elevation, theta = azimuth
    const phi = THREE.MathUtils.degToRad(80);  // sun high up
    const theta = THREE.MathUtils.degToRad(45);
    sun.setFromSphericalCoords(1, phi, theta);

    this.water = new Water(waterObject.geometry.clone(), {      
      sunDirection: sun,
      waterNormals,
      ...waterOptions,
    });

    if (textureScale) {
      // This is the big one most people miss — it controls
      // how much the normal map tiles. Default is 1.0, which
      // makes huge blurry waves. Crank it up for finer ripples.
      this.water.material.uniforms['size'].value = textureScale;
    }

    this.water.material.onBeforeCompile = (shader) => {
      // Add custom uniforms
      shader.uniforms.scatterFloor = { value: shaderOptions.scatterFloor };
      shader.uniforms.normalStrength = { value: shaderOptions.normalStrength };
      shader.uniforms.reflectAmount = { value: shaderOptions.reflectAmount };
      shader.uniforms.reflectMax = { value: shaderOptions.reflectMax };
      shader.uniforms.skyTint = { value: new THREE.Vector3(...shaderOptions.skyTint) };
      shader.uniforms.skyTintBlend = { value: shaderOptions.skyTintBlend };
      shader.uniforms.glintStrength = { value: shaderOptions.glintStrength };

      // Declare uniforms in the shader
      shader.fragmentShader = shader.fragmentShader.replace(
        'uniform vec3 waterColor;',
        `uniform vec3 waterColor;
        uniform float scatterFloor;
        uniform float normalStrength;
        uniform float reflectAmount;
        uniform float reflectMax;
        uniform vec3 skyTint;
        uniform float skyTintBlend;
        uniform float glintStrength;`
      );

      // Soften normals using uniform
      shader.fragmentShader = shader.fragmentShader.replace(
        /vec3 surfaceNormal\s*=\s*normalize\(\s*noise\.xzy\s*\*\s*vec3\(\s*1\.5\s*,\s*1\.0\s*,\s*1\.5\s*\)\s*\);/,
        'vec3 surfaceNormal = normalize( noise.xzy * vec3( normalStrength, 1.0, normalStrength ) );'
      );

      // Scatter using uniform
      shader.fragmentShader = shader.fragmentShader.replace(
        /vec3 scatter\s*=\s*max\(\s*0\.0\s*,\s*dot\(\s*surfaceNormal\s*,\s*eyeDirection\s*\)\s*\)\s*\*\s*waterColor\s*;/,
        'vec3 scatter = (scatterFloor + (1.0 - scatterFloor) * max(0.0, dot(surfaceNormal, eyeDirection))) * waterColor;'
      );

      // Reflections using uniforms (no local variable redeclarations)
      shader.fragmentShader = shader.fragmentShader.replace(
        /vec3 albedo = mix\(\s*\(.*?\)\s*\*\s*getShadowMask\(\)\s*,\s*reflectionSample\s*\+\s*specularLight\s*,\s*reflectance\s*\);/s,
        `vec3 tintedReflection = mix(reflectionSample, skyTint, skyTintBlend);
        float pondReflectance = min(reflectance * reflectAmount, reflectMax);
        vec3 albedo = mix(scatter, tintedReflection, pondReflectance) + specularLight * glintStrength;`
      );

      shader.fragmentShader = shader.fragmentShader.replace('#include <fog_fragment>', '');
      shader.fragmentShader = shader.fragmentShader.replace('#include <tonemapping_fragment>', '');

      this._shaderRef = shader;
    };



    this.water.material.transparent = true;
    this.water.material.needsUpdate = true;
  }

  update() {
    this.water.material.uniforms['time'].value += this.speed / 60.0;
  }
}