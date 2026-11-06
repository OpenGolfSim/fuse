import styles from '@/css/ui.module.css';
import { UIElementBase } from './UIElementBase';
import { UnitConversions } from '@/utils/units';

type UIDispersionChartOptions = {
  units?: OpenGolfSim.SetupData['units'];
  /** Live shot trace color, also used for the last landed shot. */
  liveColor?: string;
  /** Past landed shots color (drawn faded). */
  historyColor?: string;
  /** Max number of landed shots kept. Default 20. */
  maxHistory?: number;
  /** Target (aim) distance in meters. Drives the y scale. */
  targetDistance?: number;
  /** Target circle radius in meters. Draws the circle when set. */
  targetSize?: number;
};

type Shot = { lateral: number, distance: number };

/**
 * Top-down dispersion chart: downrange distance vertical, lateral offset
 * horizontal, centered on the aim line. Drawn on a 2D canvas with an
 * equal-unit scale on both axes (the x range is derived from the y range and
 * the plot's aspect ratio), so shot shape is not distorted.
 *
 * Landed shots stay as dots (latest highlighted, older faded). The live shot
 * draws as a trace during flight. All inputs are meters (engine units);
 * positive lateral = right of the aim line.
 *
 * Call setTarget() when the aim distance changes, beginShot() when a shot
 * launches, updateLive() each frame with GolfBall stats samples, and
 * addShot() when the shot ends.
 */
export class UIDispersionChart extends UIElementBase {
  units: OpenGolfSim.SetupData['units'];
  canvas: HTMLCanvasElement;

  #ctx: CanvasRenderingContext2D;
  #observer: ResizeObserver;
  #live: Shot[] = [];
  #liveLength = 0;
  #shots: Shot[] = [];
  #targetDistance: number;
  #targetSize?: number;
  #liveColor: string;
  #historyColor: string;
  #maxHistory: number;

  constructor(parent: string | Element, options: UIDispersionChartOptions = {}) {
    super(parent);
    this.units = options.units ?? 'metric';
    this.#targetDistance = options.targetDistance ?? 0;
    this.#targetSize = options.targetSize;
    this.#liveColor = options.liveColor ?? '#ee5530';
    this.#historyColor = options.historyColor ?? '#8b8887';
    this.#maxHistory = options.maxHistory ?? 20;

    this.element.className = styles.uiChart;
    this.canvas = document.createElement('canvas');
    this.element.append(this.canvas);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('UIDispersionChart: unable to get 2d context');
    this.#ctx = ctx;

    this.#observer = new ResizeObserver(() => this.#resize());
    this.#observer.observe(this.element);
    this.#resize();
  }

  /** Update the target/aim distance (meters). No-op when unchanged. */
  setTarget(distance: number, size?: number) {
    if (distance === this.#targetDistance && size === this.#targetSize) return;
    this.#targetDistance = distance;
    this.#targetSize = size ?? this.#targetSize;
    this.#draw();
  }

  /** Clear the live trace. Call when a shot launches. */
  beginShot() {
    this.#live = [];
    this.#liveLength = 0;
    this.#draw();
  }

  /** Feed live samples (meters). Skips the redraw when nothing new arrived. */
  updateLive(lateralSamples: number[], distanceSamples: number[]) {
    const length = Math.min(lateralSamples.length, distanceSamples.length);
    if (!length || length === this.#liveLength) return;
    this.#liveLength = length;
    this.#live = [];
    for (let i = 0; i < length; i++) {
      this.#live.push({ lateral: lateralSamples[i], distance: distanceSamples[i] });
    }
    this.#draw();
  }

  /** Record a landed shot (meters). Call when the shot ends. */
  addShot(lateral: number, distance: number) {
    this.#shots.push({ lateral, distance });
    if (this.#shots.length > this.#maxHistory) this.#shots.shift();
    this.#live = [];
    this.#liveLength = 0;
    this.#draw();
  }

  /** Wipe landed shots and the live trace. */
  clear() {
    this.#shots = [];
    this.#live = [];
    this.#liveLength = 0;
    this.#draw();
  }

  destroy() {
    this.#observer.disconnect();
    this.element.remove();
  }

  #toDisplay(meters: number) {
    return this.units === 'imperial' ? UnitConversions.metersToYards(meters) : meters;
  }

  #resize() {
    const { clientWidth, clientHeight } = this.element;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(clientWidth * dpr);
    this.canvas.height = Math.round(clientHeight * dpr);
    this.#ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.#draw();
  }

  #draw() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.width / dpr;
    const h = this.canvas.height / dpr;
    if (w < 40 || h < 30) return; // hidden or too small to draw

    const ctx = this.#ctx;
    const theme = getComputedStyle(this.element);
    const fontSize = Math.max(9, parseFloat(theme.fontSize) * 0.75 || 10);
    const labelColor = theme.getPropertyValue('--text-disabled').trim() || '#7e9a9a';
    const targetColor = theme.getPropertyValue('--primary-color').trim() || '#21d48d';
    ctx.font = `600 ${fontSize}px ${theme.fontFamily || 'sans-serif'}`;

    // y scale (display units): target distance + 50 headroom, grown by data
    const target = this.#toDisplay(this.#targetDistance);
    let dataMaxY = 0;
    for (const shot of [...this.#shots, ...this.#live]) {
      dataMaxY = Math.max(dataMaxY, this.#toDisplay(shot.distance));
    }
    const ySuggested = Math.floor(target / 10) * 10 + 50;
    const yStep = UIDispersionChart.#niceStep(Math.max(ySuggested, dataMaxY * 1.05) / 5);
    const yMax = Math.ceil(Math.max(ySuggested, dataMaxY * 1.05) / yStep) * yStep;

    // padding sized to the labels, plus an outer margin at every edge
    const outer = fontSize * 0.75;
    const yLabelWidth = ctx.measureText(String(yMax)).width;
    const pad = {
      left: outer + yLabelWidth + fontSize * 0.5,
      right: outer,
      top: outer + fontSize * 0.5,
      bottom: outer
    };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;
    if (plotW <= 0 || plotH <= 0) return;

    // equal-unit scale on both axes: px per display unit comes from y alone
    const scale = plotH / yMax;
    const centerX = pad.left + plotW / 2;
    const px = (lateral: number) => centerX + lateral * scale;
    const py = (distance: number) => pad.top + plotH - distance * scale;

    ctx.clearRect(0, 0, w, h);

    // y gridlines + labels
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.fillStyle = labelColor;
    ctx.lineWidth = 1;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let y = 0; y <= yMax; y += yStep) {
      ctx.beginPath();
      ctx.moveTo(pad.left, py(y));
      ctx.lineTo(w - pad.right, py(y));
      ctx.stroke();
      ctx.fillText(String(y), pad.left - fontSize * 0.5, py(y));
    }

    // aim line (lateral 0)
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(centerX, py(0));
    ctx.lineTo(centerX, pad.top);
    ctx.stroke();
    ctx.setLineDash([]);

    // clip data drawing to the plot area
    ctx.save();
    ctx.beginPath();
    ctx.rect(pad.left, pad.top, plotW, plotH);
    ctx.clip();

    // target: circle when a size is set, otherwise a dashed distance line
    if (target > 0) {
      ctx.strokeStyle = targetColor;
      if (this.#targetSize) {
        const radius = this.#toDisplay(this.#targetSize) * scale;
        ctx.lineWidth = 2;
        ctx.fillStyle = 'rgba(146, 190, 41, 0.2)';
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.arc(centerX, py(target), radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else {
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.moveTo(pad.left, py(target));
        ctx.lineTo(w - pad.right, py(target));
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // landed shots: older = more faded, latest highlighted
    const dotRadius = Math.max(2.5, fontSize * 0.3);
    for (let i = 0; i < this.#shots.length; i++) {
      const shot = this.#shots[i];
      const isLast = i === this.#shots.length - 1;
      ctx.fillStyle = isLast ? this.#liveColor : this.#historyColor;
      ctx.globalAlpha = isLast ? 1 : 0.25 + 0.4 * ((i + 1) / this.#shots.length);
      ctx.beginPath();
      ctx.arc(px(this.#toDisplay(shot.lateral)), py(this.#toDisplay(shot.distance)), dotRadius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // live trace
    if (this.#live.length >= 2) {
      ctx.strokeStyle = this.#liveColor;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(px(this.#toDisplay(this.#live[0].lateral)), py(this.#toDisplay(this.#live[0].distance)));
      for (let i = 1; i < this.#live.length; i++) {
        ctx.lineTo(px(this.#toDisplay(this.#live[i].lateral)), py(this.#toDisplay(this.#live[i].distance)));
      }
      ctx.stroke();
    }

    ctx.restore();
  }

  /** Round a raw step up to a tidy 1/2/2.5/5 × 10^n value. */
  static #niceStep(raw: number) {
    const mag = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))));
    for (const m of [1, 2, 2.5, 5, 10]) {
      if (raw <= m * mag) return m * mag;
    }
    return 10 * mag;
  }
}