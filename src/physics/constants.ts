import { type CourseSurfaceProperties } from '@/courses/surfaces';
import { type Collider } from '@dimforge/rapier3d-compat';

export type PhysicsLookUpTableRecord = {
  ballSpeed: number;
  launchAngle: number;
  magnusCoeff: number;
  dragCoeff: number;
  spinDecayRate: number;
}

// For more accurate physics, we use different constant values based on the type of shot.
// Mainly based on ball speed, harder hit shots like drives get a softer set of values, while chips
// and shorter shots will be more sensitive
export const PhysicsLookupTable: PhysicsLookUpTableRecord[] = [
  {
    ballSpeed: 67, // m/s
    launchAngle: 10, // VLA in degrees
    magnusCoeff: 0.0004, 
    dragCoeff: 0.27,
    spinDecayRate: 0.986
  },
  {
    ballSpeed: 64,
    launchAngle: 9,
    magnusCoeff: 0.00038,
    dragCoeff: 0.27,
    spinDecayRate: 0.985
  },
  {
    ballSpeed: 60,
    launchAngle: 12,
    magnusCoeff: 0.00035,
    dragCoeff: 0.30,
    spinDecayRate: 0.985
  },
  {
    ballSpeed: 54,
    launchAngle: 14,
    magnusCoeff: 0.0001,
    dragCoeff: 0.31,
    spinDecayRate: 0.985
  },
  {
    ballSpeed: 48,
    launchAngle: 16,
    magnusCoeff: 0.00005,
    dragCoeff: 0.32,
    spinDecayRate: 0.98
  },
  {
    ballSpeed: 42,
    launchAngle: 22,
    magnusCoeff: 0.00005,
    dragCoeff: 0.34,
    spinDecayRate: 0.90
  },
  {
    ballSpeed: 40,
    launchAngle: 25,
    magnusCoeff: 0.00005,
    dragCoeff: 0.34,
    spinDecayRate: 0.90
  }
];

export const GRAVITY = 9.81;
export const GRAVITY_VECTOR = { x: 0, y: -GRAVITY, z: 0 };


export interface ColliderWithUserData extends Collider {
  userData?: CourseSurfaceProperties;
}

export function isColliderWithUserData(collider: Collider & ColliderWithUserData): collider is ColliderWithUserData {
  return !!collider.userData;
}