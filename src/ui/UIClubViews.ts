import styles from '@/css/ui.module.css';
import { UIElementBase } from './UIElementBase';
import type { ClubEstimate } from '@/physics/estimator';
import ironTop from '@/images/iron-top.png?url';
import ironSide from '@/images/iron-side.png?url';
import ironFront from '@/images/iron-front.png?url';
import driverTop from '@/images/driver-top.png?url';
import driverSide from '@/images/driver-side.png?url';
import driverFront from '@/images/driver-front.png?url';

export type ClubViewName = 'top' | 'side' | 'front';
export type ClubViewSet = 'driver' | 'iron';

/** Built-in club art. Strike point is the image center. */
export const CLUB_VIEW_SETS: Record<ClubViewSet, ClubViewImages> = {
  driver: { top: { src: driverTop }, side: { src: driverSide }, front: { src: driverFront } },
  iron: { top: { src: ironTop }, side: { src: ironSide }, front: { src: ironFront } },
};

/** Driver art for clubs with id 'DR' or 'driver' in the id/name; iron art for everything else. */
export function clubViewSetFor(club?: OpenGolfSim.Club): ClubViewSet {
  if (!club) return 'iron';
  const isDriver = club.id.toUpperCase() === 'DR' || /driver/i.test(club.id) || /driver/i.test(club.name);
  return isDriver ? 'driver' : 'iron';
}

export type ClubViewImage = {
  /**
   * Image URL. Art is a right-handed club at address with the target to the LEFT:
   *  - top:   looking straight down, golfer at the bottom
   *  - side:  looking at the toe
   *  - front: looking at the face from the target (toe on the left)
   */
  src: string;
  /** Strike point (face center) in image pixels. Defaults to the image center. */
  pivot?: [number, number];
  /** Ball radius in image pixels. Used to draw the ball in the front view. Defaults to 16% of the image width. */
  ballRadius?: number;
};

export type ClubViewImages = Record<ClubViewName, ClubViewImage>;

type UIClubViewsOptions = {
  /** Custom art. Defaults to the built-in set picked by setClub(). */
  images?: ClubViewImages;

  /** Ball launch lines (HLA, VLA, spin axis). Defaults to the theme primary color. */
  launchColor?: string;
  /** Club path / attack angle lines. */
  pathColor?: string;
  /** Face angle / dynamic loft lines. */
  faceColor?: string;
};

type Cell = {
  label: string;
  /** Line color shown as the cell's top border. */
  color: string;
  value: (shot: OpenGolfSim.Shot, estimate: ClubEstimate) => { digit: string; unit: string };
  labelElement?: HTMLDivElement;
  valueElement?: HTMLDivElement;
  digit?: HTMLDivElement;
  unit?: HTMLDivElement;
};


type Panel = {
  view: ClubViewName;
  element: HTMLDivElement;
  cells: Cell[];
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  config: ClubViewImage;
  image: HTMLImageElement;
};

type Vec = [number, number];

const TITLES: Record<ClubViewName, string> = { top: 'TOP', side: 'SIDE', front: 'FRONT' };

/**
 * Three stacked club panels (top, side, front) with the last shot's launch
 * and club delivery drawn over fixed club art, and the values in cells below each panel.
 *
 *  - top:   HLA, club path, face angle
 *  - side:  VLA, attack angle, dynamic loft
 *  - front: spin axis
 *
 * Call setClub() when the club changes, update() with the shot and its
 * estimateClubDelivery() result, and clear() to reset.
 */
export class UIClubViews extends UIElementBase {
  #panels: Panel[];
  #observer: ResizeObserver;
  #shot?: OpenGolfSim.Shot;
  #estimate?: ClubEstimate;
  #launchColor?: string;
  #pathColor: string;
  #faceColor: string;
  #set?: ClubViewSet;

  constructor(parent: string | Element, options: UIClubViewsOptions = {}) {
    super(parent);
    this.#launchColor = options.launchColor;
    this.#pathColor = options.pathColor ?? '#4da3ff';
    this.#faceColor = options.faceColor ?? '#ff8a3d';
    this.element.className = styles.clubViews;
    const images = options.images ?? CLUB_VIEW_SETS.iron;
    if (!options.images) this.#set = 'iron';

    this.#panels = (['top', 'side', 'front'] as const).map(view => {
      const group = document.createElement('div');
      group.className = styles.clubViewGroup;
      const element = document.createElement('div');
      element.className = styles.clubViewPanel;
      const canvas = document.createElement('canvas');
      element.append(canvas);
      const cells = this.#cellsFor(view);
      group.append(element, this.#createCells(cells));
      this.element.append(group);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('UIClubViews: unable to get 2d context');
      const panel: Panel = { view, element, cells, canvas, ctx, config: images[view], image: new Image() };

      this.#loadImage(panel);
      return panel;
    });

    // the container (cell fit) and each panel (canvas size, which changes when the cells stack)
    this.#observer = new ResizeObserver(() => {
      this.#fitCells();
      this.#resize();
    });

    this.#observer.observe(this.element);
    for (const panel of this.#panels) this.#observer.observe(panel.element);
    this.#fitCells();
    this.#resize();
  }

  /** Show the built-in art for this club (driver or iron). No-op when the art is unchanged. */
  setClub(club?: OpenGolfSim.Club) {
    const set = clubViewSetFor(club);
    if (set === this.#set) return;
    this.#set = set;
    this.#applyImages(CLUB_VIEW_SETS[set]);
  }

  setImages(images: ClubViewImages) {
    this.#set = undefined;
    this.#applyImages(images);
  }

  #applyImages(images: ClubViewImages) {
    for (const panel of this.#panels) {
      panel.config = images[panel.view];
      this.#loadImage(panel);
    }
  }

  /** Show a shot. The estimate comes from estimateClubDelivery(shot, club). */
  update(shot: OpenGolfSim.Shot, estimate: ClubEstimate) {
    this.#shot = shot;
    this.#estimate = estimate;
    this.#drawAll();
    this.#updateCells();
  }

  /** Remove the shot lines and values and keep the club art. */
  clear() {
    this.#shot = undefined;
    this.#estimate = undefined;
    this.#drawAll();
    this.#updateCells();
  }

  destroy() {
    this.#observer.disconnect();
    this.element.remove();
  }

  #cellsFor(view: ClubViewName): Cell[] {
    // the launch color falls back to the theme color via CSS
    const launch = this.#launchColor ?? 'var(--primary-color)';
    if (view === 'top') return [
      { label: 'Launch', color: launch, value: shot => horizontal(shot.horizontalLaunchAngle) },
      { label: 'Path', color: this.#pathColor, value: (_, est) => horizontal(est.clubPath) },
      { label: 'Face', color: this.#faceColor, value: (_, est) => horizontal(est.faceAngle) },
    ];
    if (view === 'side') return [
      { label: 'Launch', color: launch, value: shot => vertical(shot.verticalLaunchAngle) },
      { label: 'Attack', color: this.#pathColor, value: (_, est) => vertical(est.attackAngle) },
      { label: 'Loft', color: this.#faceColor, value: (_, est) => vertical(est.dynamicLoft) },
    ];
    return [
      { label: 'Spin axis', color: launch, value: shot => horizontal(shot.spinAxis) },
    ];
  }

  #createCells(cells: Cell[]): HTMLDivElement {
    const row = document.createElement('div');
    row.className = styles.clubViewCells;
    for (const cell of cells) {
      const element = document.createElement('div');
      element.className = styles.clubViewCell;
      element.style.setProperty('--cell-color', cell.color);
      const label = document.createElement('div');
      label.className = styles.clubViewCellLabel;
      label.textContent = cell.label;
      const value = document.createElement('div');
      value.className = styles.clubViewCellValue;
      cell.labelElement = label;
      cell.valueElement = value;
      cell.digit = document.createElement('div');
      cell.digit.className = styles.clubViewCellDigit;
      cell.digit.textContent = '–';
      cell.unit = document.createElement('div');
      cell.unit.className = styles.clubViewCellUnit;
      value.append(cell.digit, cell.unit);
      element.append(label, value);
      row.append(element);
    }
    return row;
  }

  #updateCells() {
    for (const panel of this.#panels) {
      for (const cell of panel.cells) {
        if (!cell.digit || !cell.unit) continue;
        const v = this.#shot && this.#estimate ? cell.value(this.#shot, this.#estimate) : { digit: '–', unit: '' };
        cell.digit.textContent = v.digit;
        cell.unit.textContent = v.unit;
      }
    }
    this.#fitCells();
  }

  /**
   * Show the cells side by side when every label and value fits, otherwise
   * stack them as rows. Always measures the side-by-side layout, so the
   * result doesn't flip back and forth.
   */
  #fitCells() {
    const stacked = styles.clubViewsStacked;
    this.element.classList.remove(stacked);
    const overflows = (el?: HTMLElement) => !!el && el.scrollWidth > el.clientWidth + 1;
    const tooNarrow = this.#panels.some(panel =>
      panel.cells.some(cell => overflows(cell.labelElement) || overflows(cell.valueElement))
    );
    this.element.classList.toggle(stacked, tooNarrow);
  }

  #loadImage(panel: Panel) {
    const image = new Image();
    image.onload = () => this.#draw(panel);
    image.src = panel.config.src;
    panel.image = image;
  }

  #resize() {
    const dpr = window.devicePixelRatio || 1;
    for (const panel of this.#panels) {
      const { clientWidth, clientHeight } = panel.element;
      panel.canvas.width = Math.round(clientWidth * dpr);
      panel.canvas.height = Math.round(clientHeight * dpr);
      panel.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    this.#drawAll();
  }

  #drawAll() {
    for (const panel of this.#panels) this.#draw(panel);
  }

  #draw(panel: Panel) {
    const dpr = window.devicePixelRatio || 1;
    const w = panel.canvas.width / dpr;
    const h = panel.canvas.height / dpr;
    if (w < 40 || h < 30) return; // hidden or too small to draw

    const { ctx, image, config } = panel;
    const theme = getComputedStyle(this.element);
    const fontSize = Math.max(9, parseFloat(theme.fontSize) * 0.75 || 10);
    const labelColor = theme.getPropertyValue('--text-disabled').trim() || '#7e9a9a';
    const launchColor = this.#launchColor ?? (theme.getPropertyValue('--primary-color').trim() || '#21d48d');
    const font = `600 ${fontSize}px ${theme.fontFamily || 'sans-serif'}`;

    ctx.clearRect(0, 0, w, h);

    // club art, scaled to fit ("contain") and centered
    let pivot: Vec = [w / 2, h / 2];
    let scale = 1;
    if (image.complete && image.naturalWidth) {
      const iw = image.naturalWidth;
      const ih = image.naturalHeight;
      scale = Math.min(w / iw, h / ih);
      const ox = (w - iw * scale) / 2;
      const oy = (h - ih * scale) / 2;
      ctx.drawImage(image, ox, oy, iw * scale, ih * scale);
      const [px, py] = config.pivot ?? [iw / 2, ih / 2];
      pivot = [ox + px * scale, oy + py * scale];
    }

    // panel title
    ctx.font = font;
    ctx.fillStyle = labelColor;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const margin = fontSize * 0.75;
    ctx.fillText(TITLES[panel.view], margin, margin);

    const shot = this.#shot;
    const est = this.#estimate;
    if (!shot || !est) return;

    const ray = Math.min(w, h) * 0.45; // arrow length
    const face = Math.min(w, h) * 0.22; // half-length of face/loft segments

    if (panel.view === 'top') {
      // target is left; right of target is up the panel (away from the golfer)
      this.#arrow(ctx, pivot, toward(shot.horizontalLaunchAngle), ray, launchColor);
      this.#arrow(ctx, pivot, toward(est.clubPath), ray * 0.85, this.#pathColor);
      this.#segment(ctx, pivot, perpendicular(toward(est.faceAngle)), face, this.#faceColor);
    } else if (panel.view === 'side') {
      // target is left; up is up
      this.#arrow(ctx, pivot, toward(shot.verticalLaunchAngle), ray, launchColor);
      this.#arrow(ctx, pivot, toward(est.attackAngle), ray * 0.85, this.#pathColor);
      this.#segment(ctx, pivot, perpendicular(toward(est.dynamicLoft)), face, this.#faceColor);

    } else {
      // looking from the target, so the golfer's right is on the left:
      // a positive (fade) axis dips toward the left side of the panel
      const radius = (config.ballRadius ?? (image.naturalWidth || 800) * 0.16) * scale;
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(pivot[0], pivot[1], radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.globalAlpha = 1;
      const tilt = (-shot.spinAxis * Math.PI) / 180;
      this.#segment(ctx, pivot, [Math.cos(tilt), Math.sin(tilt)], radius * 1.5, launchColor);
    }

  }

  #arrow(ctx: CanvasRenderingContext2D, from: Vec, dir: Vec, length: number, color: string) {
    const to: Vec = [from[0] + dir[0] * length, from[1] + dir[1] * length];
    const head = Math.max(6, length * 0.08);
    const back: Vec = [-dir[0], -dir[1]];
    const side: Vec = [-dir[1], dir[0]];
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(from[0], from[1]);
    ctx.lineTo(to[0] + back[0] * head * 0.6, to[1] + back[1] * head * 0.6);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(to[0], to[1]);
    ctx.lineTo(to[0] + (back[0] + side[0] * 0.5) * head, to[1] + (back[1] + side[1] * 0.5) * head);
    ctx.lineTo(to[0] + (back[0] - side[0] * 0.5) * head, to[1] + (back[1] - side[1] * 0.5) * head);
    ctx.closePath();
    ctx.fill();
  }

  /** Line through `center` along `dir`, extending `half` each way. */
  #segment(ctx: CanvasRenderingContext2D, center: Vec, dir: Vec, half: number, color: string) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(center[0] - dir[0] * half, center[1] - dir[1] * half);
    ctx.lineTo(center[0] + dir[0] * half, center[1] + dir[1] * half);
    ctx.stroke();
  }
}

/** Unit vector pointing at the target (left), turned `degrees` toward the top of the panel. */
function toward(degrees: number): Vec {
  const r = (degrees * Math.PI) / 180;
  return [-Math.cos(r), -Math.sin(r)];
}

/** The face line, at right angles to the face normal. */
function perpendicular([x, y]: Vec): Vec {
  return [-y, x];
}

/** Left/right angle, e.g. 2.8 with unit "° L". */
function horizontal(degrees: number) {
  const digit = Math.abs(degrees).toFixed(1);
  if (digit === '0.0') return { digit, unit: '°' };
  return { digit, unit: `° ${degrees > 0 ? 'R' : 'L'}` };
}

/** Up/down angle, signed. */
function vertical(degrees: number) {
  return { digit: degrees.toFixed(1), unit: '°' };
}