
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