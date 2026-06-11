import { type CourseSurfaceProperties } from '@/courses/surfaces';
import { UnitConversions } from '@/utils/units';
import { type Collider } from '@dimforge/rapier3d-compat';

export type PhysicsLookUpTableRecord = {
  ballSpeed: number;
  // launchAngle: number;
  magnusCoeff: number;
  dragCoeff: number;
  spinDecayRate: number;
  sideSpinDecayRate: number;
}

// For more accurate physics, we use different constant values based on the type of shot.
// Mainly based on ball speed, harder hit shots like drives get a softer set of values, while chips
// and shorter shots will be more sensitive
export const PhysicsLookupTable: PhysicsLookUpTableRecord[] = [
  {
    // ballSpeed: 67, // m/s
    ballSpeed: UnitConversions.milesPerHourToMetersPerSecond(150),
    // launchAngle: 10, // VLA in degrees
    magnusCoeff: 0.0004, 
    dragCoeff: 0.27,
    spinDecayRate: 0.986,
    sideSpinDecayRate: 0.986
  },
  {
    // ballSpeed: 64,
    ballSpeed: UnitConversions.milesPerHourToMetersPerSecond(143),
    // launchAngle: 9,
    magnusCoeff: 0.00038,
    dragCoeff: 0.27,
    spinDecayRate: 0.985,
    sideSpinDecayRate: 0.97
  },
  {
    // ballSpeed: 60,
    ballSpeed: UnitConversions.milesPerHourToMetersPerSecond(134),
    // launchAngle: 12,
    magnusCoeff: 0.00035,
    dragCoeff: 0.30,
    spinDecayRate: 0.985,
    sideSpinDecayRate: 0.999
  },
  {
    // ballSpeed: 54,
    ballSpeed: UnitConversions.milesPerHourToMetersPerSecond(120),
    // launchAngle: 14,
    magnusCoeff: 0.0001,
    dragCoeff: 0.31,
    spinDecayRate: 0.985,
    sideSpinDecayRate: 0.95
  },
  {
    // ballSpeed: 48, // ~107 mph
    ballSpeed: UnitConversions.milesPerHourToMetersPerSecond(107),
    // launchAngle: 16,
    magnusCoeff: 0.00005,
    dragCoeff: 0.32,
    spinDecayRate: 0.98,
    sideSpinDecayRate: 0.95
  },
  {
    // ballSpeed: 42, // ~94 MPH
    ballSpeed: UnitConversions.milesPerHourToMetersPerSecond(94),
    // launchAngle: 22,
    magnusCoeff: 0.00005,
    dragCoeff: 0.34,
    spinDecayRate: 0.98,
    sideSpinDecayRate: 0.95
  },
  {
    // ballSpeed: 40, // ~89.5 MPH
    ballSpeed: UnitConversions.milesPerHourToMetersPerSecond(90),
    // launchAngle: 25,
    magnusCoeff: 0.00005,
    dragCoeff: 0.34,
    spinDecayRate: 0.97,
    sideSpinDecayRate: 0.95
  },
  {
    // ballSpeed: 20, // ~45 MPH
    ballSpeed: UnitConversions.milesPerHourToMetersPerSecond(45),
    magnusCoeff: 0.00001,
    dragCoeff: 0.34,
    spinDecayRate: 0.9,
    sideSpinDecayRate: 0.95
  },
];

export const GRAVITY = 9.81;
export const GRAVITY_VECTOR = { x: 0, y: -GRAVITY, z: 0 };


export interface ColliderWithUserData extends Collider {
  userData?: CourseSurfaceProperties;
}

export function isColliderWithUserData(collider: Collider & ColliderWithUserData): collider is ColliderWithUserData {
  return !!collider.userData;
}