export enum CourseSurfaceType {
  Green = 'green',
  Fringe = 'fringe',
  Fairway = 'fairway',
  FirstCut = 'first_cut',
  Tee = 'tee',
  Rough = 'rough',
  Sand = 'sand',
  Water = 'water',
  River = 'river',
  CartPath = 'cart_path',
  PlaneLake = 'plane_lake',
  PlaneRiver = 'plane_river',
  PineStraw = 'pine_straw',
  Default = 'default',
  Base = 'base',
}

export enum CourseObjectType {
  Tree = 'tree',
  House = 'house',
}

export type CourseColliderType = CourseSurfaceType | CourseObjectType;

export type CourseSurfaceProperties = {
  friction: number,
  restitution: number,
  rollResistance: number,
  stopSpeed?: number,
  stopAngular?: number
  rollResistanceSpeedThreshold?: number
  type?: CourseColliderType,
  hasCollider?: boolean,
}

export const CourseSurfaces: Record<CourseSurfaceType, CourseSurfaceProperties> = {
  [CourseSurfaceType.Green]: {
    hasCollider: true,
    friction: 0.4,
    restitution: 0.45,
    rollResistance: 0.075,
    // rollResistanceSpeedThreshold: 0.0001,
    stopSpeed: 0.12,
    stopAngular: 4.8,
  },
  [CourseSurfaceType.Fringe]: {
    hasCollider: true,
    friction: 0.5,
    restitution: 0.1,
    rollResistance: 0.15
  },
  [CourseSurfaceType.Fairway]: {
    hasCollider: true,
    friction: 0.4,
    restitution: 0.4,
    rollResistance: 0.25
  },
  [CourseSurfaceType.FirstCut]: {
    hasCollider: true,
    friction: 0.4,
    restitution: 0.2,
    rollResistance: 0.14
  },
  [CourseSurfaceType.Tee]: {
    hasCollider: true,
    friction: 0.3,
    restitution: 0.1,
    rollResistance: 0.2
  },
  [CourseSurfaceType.Rough]: {
    hasCollider: true,
    friction: 0.5,
    restitution: 0.3,
    rollResistance: 0.40
  },
  [CourseSurfaceType.Base]: {
    hasCollider: true,
    friction: 0.8,
    restitution: 0.15,
    rollResistance: 0.20
  },
  [CourseSurfaceType.Sand]: {
    hasCollider: true,
    friction: 1.5,
    restitution: 0.02,
    rollResistance: 0.60
  },
  [CourseSurfaceType.Water]: {
    hasCollider: true,
    friction: 1.0,
    restitution: 0.00,
    rollResistance: 1.00
  },
  [CourseSurfaceType.River]: {
    hasCollider: true,
    friction: 1.0,
    restitution: 0.00,
    rollResistance: 1.00
  },
  [CourseSurfaceType.CartPath]: {
    hasCollider: true,
    friction: 0.3,
    restitution: 0.50,
    rollResistance: 0.01
  },
  [CourseSurfaceType.PlaneLake]: {
    hasCollider: false,
    friction: 0.3,
    restitution: 0.50,
    rollResistance: 0.01
  },
  [CourseSurfaceType.PlaneRiver]: {
    hasCollider: false,
    friction: 0.3,
    restitution: 0.50,
    rollResistance: 0.01
  },
  [CourseSurfaceType.PineStraw]: {
    hasCollider: true,
    friction: 0.8,
    restitution: 0.15,
    rollResistance: 0.20
  },
  [CourseSurfaceType.Default]: {
    hasCollider: true,
    friction: 0.5,
    restitution: 0.02,
    rollResistance: 0.05
  },
};

export function isCourseSurfaceType(value: string): value is CourseSurfaceType {
  return Object.values(CourseSurfaceType).includes(value as CourseSurfaceType);
}