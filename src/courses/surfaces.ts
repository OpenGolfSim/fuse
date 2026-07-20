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
  /** How grabby the ground is when the ball hits it. Higher = bounces kill more forward speed and spin bites harder. Does not affect rolling. */
  friction: number,

  /** How bouncy the ground is. Higher = taller hops. Lower = ball stays down. */
  restitution: number,

  /** How fast a rolling ball slows down. Higher = shorter rollout. Ignored on the Green (stimpLevel controls green roll instead). */
  rollResistance: number,

  /** The ball is considered stopped below this speed (m/s) and the shot ends. Raise it if balls creep forever on slight slopes. */
  stopSpeed?: number,

  /** What kind of surface this is. Green gets stimp rolling, water gets splash handling, etc. */
  type?: CourseColliderType,

  /** Whether the ball can land on this. false = ball passes through (e.g. decorative water planes). */
  hasCollider?: boolean,

  /** Extra grip for spinny shots only. Higher = high-spin chips check up harder. Low-spin shots don't notice it. 1.0 or absent = no extra grip. */
  spinGrip?: number,

  /** How much the ground "gives" on hard, steep landings (like a wedge making a pitch mark). Higher = those shots land dead. Putts and low skips don't notice it. */
  divot?: number,
}

export const CourseSurfaces: Record<CourseSurfaceType, CourseSurfaceProperties> = {
  [CourseSurfaceType.Green]: {
    hasCollider: true,
    friction: 0.5,
    spinGrip: 1.2,
    restitution: 0.35,
    divot: 0.01,
    rollResistance: 0.09,
    stopSpeed: 0.18,
  },
  [CourseSurfaceType.Fringe]: {
    hasCollider: true,
    friction: 0.5,
    spinGrip: 1.2,
    divot: 0.01,
    restitution: 0.3,
    rollResistance: 0.10
  },
  [CourseSurfaceType.Fairway]: {
    hasCollider: true,
    friction: 0.3,
    restitution: 0.3,
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
    restitution: 0.2,
    rollResistance: 0.35,
    stopSpeed: 0.20,
  },
  [CourseSurfaceType.Base]: {
    hasCollider: true,
    friction: 0.2,
    restitution: 0.2,
    rollResistance: 0.35,
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