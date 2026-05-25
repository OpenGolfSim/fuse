import * as THREE from 'three';

export function isMeshObject(object: THREE.Object3D<THREE.Object3DEventMap>): object is THREE.Mesh {
  return 'isMesh' in object && !!object.isMesh;
}