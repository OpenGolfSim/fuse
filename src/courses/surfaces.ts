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
  type?: CourseColliderType,
  hasCollider?: boolean,
  spinGrip?: number,
}

export const CourseSurfaces: Record<CourseSurfaceType, CourseSurfaceProperties> = {
  [CourseSurfaceType.Green]: {
    hasCollider: true,
    friction: 0.5,
    spinGrip: 1.2,
    restitution: 0.40,
    rollResistance: 0.09,
    stopSpeed: 0.18,
    stopAngular: 4.8,
  },
  [CourseSurfaceType.Fringe]: {
    hasCollider: true,
    friction: 0.5,
    spinGrip: 1.4,
    restitution: 0.35,
    rollResistance: 0.10
  },
  [CourseSurfaceType.Fairway]: {
    hasCollider: true,
    friction: 0.3,
    restitution: 0.4,
    spinGrip: 0.5,
    rollResistance: 0.15
  },
  [CourseSurfaceType.FirstCut]: {
    hasCollider: true,
    friction: 0.4,
    spinGrip: 1.0,
    restitution: 0.3,
    rollResistance: 0.20
  },
  [CourseSurfaceType.Tee]: {
    hasCollider: true,
    friction: 0.3,
    restitution: 0.1,
    rollResistance: 0.2
  },
  [CourseSurfaceType.Rough]: {
    hasCollider: true,
    friction: 0.2,
    restitution: 0.3,
    rollResistance: 0.4,
    stopSpeed: 0.20,
  },
  [CourseSurfaceType.Base]: {
    hasCollider: true,
    friction: 0.8,
    restitution: 0.2,
    rollResistance: 0.40,
    stopSpeed: 0.30,
  },
  [CourseSurfaceType.Sand]: {
    hasCollider: true,
    friction: 1.0,
    restitution: 0.02,
    rollResistance: 0.3,
    stopSpeed: 0.15,
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