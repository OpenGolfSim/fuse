/**
 *
 * Estimates club delivery (attack angle, club path, face angle, dynamic loft,
 * spin loft, club speed) from ball-only launch monitor data by inverting a
 * D-plane model.
 *
 * ASSUMPTIONS / LIMITS
 *  - Centered strike. Toe/heel hits (gear effect) corrupt spin axis -> face/path.
 *    High/low strikes corrupt spin -> spin loft -> AoA/dynamic loft.
 *  - Full swings only. Putts and partial chips will give unreliable results.
 *  - Coefficients default to values derived from PGA Tour average data
 *    (see TOUR_REFERENCE). Amateur smash factors are usually lower, so club
 *    speed will tend to read slightly high.
 *  - If the club has no loft, the club type is inferred from spin / ball speed.
 *  - Clubs with more loft than a PW (or more spin per mph) use PW coefficients.
 *
 * COORDINATE FRAME
 *  x = right, y = up, z = toward target.
 *
 * SIGN CONVENTION (same as OpenGolfSim.Shot / ballPhysics.launchShot)
 *  horizontalLaunchAngle > 0 : ball starts right of target
 *  spinAxis > 0              : ball curves right (fade/slice for a right-handed golfer)
 * Outputs use the same world frame:
 *  clubPath / faceAngle > 0 : pointing right of target
 *  faceToPath > 0           : face right of path
 *  attackAngle > 0          : ascending
 * Use toGolferRelative() for handedness-aware "in-to-out / open" values.
 */

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

// ---------- Types ----------

/** Raw club delivery values (also the input to simulateBallLaunch). */
export interface ClubDelivery {
  clubSpeed: number; // mph
  attackAngle: number; // deg, + = up
  clubPath: number; // deg, + = right
  faceAngle: number; // deg to target, + = right
  dynamicLoft: number; // deg
}

export interface ClubEstimate extends ClubDelivery {
  faceToPath: number; // deg, + = face right of path
  spinLoft: number; // deg
  /** Static loft used to select coefficients. */
  referenceLoft: number;
  /** 'club' if taken from Club.loft, 'inferred' if estimated from spin / ball speed. */
  referenceLoftSource: 'club' | 'inferred';
  /** True if the spin was too high for the model and spin loft was clamped. */
  spinLoftClamped: boolean;
}

export interface ClubCoefficients {
  smashFactor: number;
  /**
   * r: fraction of spin loft by which launch direction sits away from the club
   * path toward the face normal. VLA ~ AoA + r*SL, HLA ~ path + r*(face-path).
   */
  launchRatio: number;
  /** k in: spin(rpm) = k * ballSpeed(mph) * sin(spinLoft) */
  spinCoefficient: number;
}

// ---------- Default coefficients (PGA Tour averages) ----------

/**
 * Trackman PGA Tour averages. Static lofts and launch ratios are typical
 * values, not from the dataset. k is derived from these rows so a tour-average
 * shot inverts back to tour-average AoA.
 */
const TOUR_REFERENCE = [
  // loft, r,  clubSpd, AoA,  ballSpd, launch, spin
  [10.5, 0.85, 113, -1.3, 167, 10.9, 2686], // Driver
  [15, 0.84, 107, -2.9, 158, 9.2, 3655], // 3W
  [18, 0.83, 103, -3.3, 152, 9.4, 4350], // 5W
  [21, 0.82, 100, -3.5, 146, 10.2, 4437], // Hybrid
  [23, 0.81, 96, -3.4, 137, 11.0, 4836], // 4i
  [26, 0.8, 94, -3.7, 132, 12.1, 5361], // 5i
  [30, 0.79, 92, -4.1, 127, 14.1, 6231], // 6i
  [34, 0.78, 90, -4.3, 120, 16.3, 7097], // 7i
  [38, 0.77, 87, -4.5, 115, 18.1, 7998], // 8i
  [42, 0.76, 85, -4.7, 109, 20.4, 8647], // 9i
  [46, 0.75, 83, -5.0, 102, 24.2, 9304], // PW
] as const;

const DEFAULT_TABLE: Array<{ loft: number; spinPerMph: number } & ClubCoefficients> =
  TOUR_REFERENCE.map(([loft, r, clubSpd, aoa, ballSpd, launch, spin]) => {
    const spinLoft = (launch - aoa) / r;
    return {
      loft,
      spinPerMph: spin / ballSpd,
      launchRatio: r,
      smashFactor: ballSpd / clubSpd,
      spinCoefficient: spin / (ballSpd * Math.sin(spinLoft * D2R)),
    };
  });

/** Piecewise-linear lookup on a sorted table column, clamped at both ends. */
function interpolate<T>(table: readonly T[], x: number, key: (row: T) => number, value: (row: T) => number): number {
  if (x <= key(table[0])) return value(table[0]);
  const last = table[table.length - 1];
  if (x >= key(last)) return value(last);
  const i = table.findIndex((row) => key(row) >= x);
  const a = table[i - 1];
  const b = table[i];
  const f = (x - key(a)) / (key(b) - key(a));
  return value(a) + (value(b) - value(a)) * f;
}

/** Infer a reference static loft from spin per mph of ball speed. */
export function inferReferenceLoft(shot: OpenGolfSim.Shot): number {
  const spinPerMph = shot.spinSpeed / Math.max(shot.ballSpeed, 1);
  return interpolate(DEFAULT_TABLE, spinPerMph, (r) => r.spinPerMph, (r) => r.loft);
}

function coefficientsFor(loft: number, overrides?: Partial<ClubCoefficients>): ClubCoefficients {
  const lerp = (value: (r: (typeof DEFAULT_TABLE)[number]) => number) =>
    interpolate(DEFAULT_TABLE, loft, (r) => r.loft, value);
  return {
    smashFactor: overrides?.smashFactor ?? lerp((r) => r.smashFactor),
    launchRatio: overrides?.launchRatio ?? lerp((r) => r.launchRatio),
    spinCoefficient: overrides?.spinCoefficient ?? lerp((r) => r.spinCoefficient),
  };
}

// ---------- Vector helpers ----------

type V3 = [number, number, number];

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const normalize = (a: V3): V3 => scale(a, 1 / Math.hypot(a[0], a[1], a[2]));

/** Unit vector from horizontal (right +) and vertical (up +) angles in degrees. */
function dirFromAngles(horizontal: number, vertical: number): V3 {
  const h = horizontal * D2R;
  const v = vertical * D2R;
  return [Math.sin(h) * Math.cos(v), Math.sin(v), Math.cos(h) * Math.cos(v)];
}

function anglesFromDir(d: V3): { horizontal: number; vertical: number } {
  return {
    horizontal: Math.atan2(d[0], d[2]) * R2D,
    vertical: Math.asin(Math.max(-1, Math.min(1, d[1]))) * R2D,
  };
}

/** Orthonormal basis perpendicular to launch direction L: "up" and "right". */
function perpBasis(L: V3): { up: V3; right: V3 } {
  const Y: V3 = [0, 1, 0];
  const up = normalize(add(Y, scale(L, -dot(Y, L))));
  const right = cross(up, L);
  return { up, right };
}

// ---------- Inverse model: ball -> club ----------

export function estimateClubDelivery(
  shot: OpenGolfSim.Shot,
  club?: OpenGolfSim.Club,
  overrides?: Partial<ClubCoefficients>,
): ClubEstimate {
  const referenceLoftSource = club?.loft != null ? 'club' : 'inferred';
  const referenceLoft = club?.loft ?? inferReferenceLoft(shot);
  const { smashFactor, launchRatio: r, spinCoefficient: k } = coefficientsFor(referenceLoft, overrides);

  // 1. Club speed
  const clubSpeed = shot.ballSpeed / smashFactor;

  // 2. Spin loft from spin magnitude
  let sinSL = shot.spinSpeed / (k * shot.ballSpeed);
  const spinLoftClamped = sinSL > 0.99;
  sinSL = Math.max(0, Math.min(0.99, sinSL));
  const spinLoft = Math.asin(sinSL) * R2D;

  // 3. Build the D-plane: contains launch dir L, normal to the spin axis.
  //    u = unit vector in the D-plane, perpendicular to L, pointing toward the face normal.
  const L = dirFromAngles(shot.horizontalLaunchAngle, shot.verticalLaunchAngle);
  const { up, right } = perpBasis(L);
  const tilt = shot.spinAxis * D2R;
  const u = add(scale(up, Math.cos(tilt)), scale(right, Math.sin(tilt)));

  // 4. Face normal sits (1-r)*SL beyond L; club path sits r*SL behind L.
  const a = (1 - r) * spinLoft * D2R;
  const b = r * spinLoft * D2R;
  const n = add(scale(L, Math.cos(a)), scale(u, Math.sin(a)));
  const v = add(scale(L, Math.cos(b)), scale(u, -Math.sin(b)));

  const face = anglesFromDir(n);
  const path = anglesFromDir(v);

  return {
    clubSpeed,
    attackAngle: path.vertical,
    clubPath: path.horizontal,
    faceAngle: face.horizontal,
    dynamicLoft: face.vertical,
    faceToPath: face.horizontal - path.horizontal,
    spinLoft,
    referenceLoft,
    referenceLoftSource,
    spinLoftClamped,
  };
}

// ---------- Forward model: club -> ball (for tests / sanity checks) ----------

export function simulateBallLaunch(
  d: ClubDelivery,
  referenceLoft: number,
  overrides?: Partial<ClubCoefficients>,
): OpenGolfSim.Shot {
  const { smashFactor, launchRatio: r, spinCoefficient: k } = coefficientsFor(referenceLoft, overrides);
  const v = dirFromAngles(d.clubPath, d.attackAngle);
  const n = dirFromAngles(d.faceAngle, d.dynamicLoft);
  const SL = Math.acos(Math.max(-1, Math.min(1, dot(v, n))));
  const ballSpeed = d.clubSpeed * smashFactor;

  if (SL < 1e-9) {
    const { horizontal, vertical } = anglesFromDir(v);
    return { ballSpeed, verticalLaunchAngle: vertical, horizontalLaunchAngle: horizontal, spinSpeed: 0, spinAxis: 0 };
  }

  // Slerp from path toward face normal by fraction r.
  const L = normalize(add(scale(v, Math.sin((1 - r) * SL)), scale(n, Math.sin(r * SL))));
  const { up, right } = perpBasis(L);
  const uRaw = add(n, scale(L, -dot(n, L)));
  const spinAxis = Math.atan2(dot(uRaw, right), dot(uRaw, up)) * R2D;
  const { horizontal, vertical } = anglesFromDir(L);

  return {
    ballSpeed,
    verticalLaunchAngle: vertical,
    horizontalLaunchAngle: horizontal,
    spinSpeed: k * ballSpeed * Math.sin(SL),
    spinAxis,
  };
}

// ---------- Input normalization helpers ----------

/** For monitors that report backspin/sidespin instead of total/axis. sideSpin > 0 = curves right. */
export function spinFromComponents(backSpin: number, sideSpin: number): Pick<OpenGolfSim.Shot, 'spinSpeed' | 'spinAxis'> {
  return {
    spinSpeed: Math.hypot(backSpin, sideSpin),
    spinAxis: Math.atan2(sideSpin, backSpin) * R2D,
  };
}

/**
 * World-frame -> golfer-relative values for labels.
 * Returns pathInToOut > 0 = in-to-out, faceOpenToPath/faceOpenToTarget > 0 = open.
 */
export function toGolferRelative(e: ClubEstimate, handedness: OpenGolfSim.Player['handedness'] = 'right') {
  const s = handedness === 'right' ? 1 : -1;
  return {
    pathInToOut: e.clubPath * s,
    faceOpenToTarget: e.faceAngle * s,
    faceOpenToPath: e.faceToPath * s,
  };
}