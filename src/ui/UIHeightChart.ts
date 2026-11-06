import styles from '@/css/ui.module.css';
import { UIElementBase } from './UIElementBase';
import { UnitConversions } from '@/utils/units';

type UIHeightChartOptions = {
  units?: OpenGolfSim.SetupData['units'];
  /** Live shot trace color. */
  liveColor?: string;
  /** Past shot trace color (drawn faded). */
  historyColor?: string;
  /** Max number of past traces kept. Default 15. */
  maxHistory?: number;
  /** Target (aim) distance in meters. Drives the x scale. */
  targetDistance?: number;
  /** Landing zone half-width in meters. Draws a zone line at ground level when set. */
  targetSize?: number;
};

type Trace = { heights: number[], distances: number[] };

/**
 * Side-view shot chart: ball height over carry distance, drawn live during
 * flight on a 2D canvas. Previous shots stay as faded traces. All inputs are
 * meters (engine units); display converts to yards for imperial.
 *
 * Call setTarget() when the aim distance changes, beginShot() when a shot
 * launches, and updateLive() each frame with GolfBall stats samples —
 * redraws are skipped when no new samples have arrived.
 */
export class UIHeightChart extends UIElementBase {
  units: OpenGolfSim.SetupData['units'];
  canvas: HTMLCanvasElement;

  #ctx: CanvasRenderingContext2D;
  #observer: ResizeObserver;
  #live: Trace = { heights: [], distances: [] };
  #history: Trace[] = [];
  #liveLength = 0;
  #targetDistance: number;
  #targetSize?: number;
  #liveColor: string;
  #historyColor: string;
  #maxHistory: number;

  constructor(parent: string | Element, options: UIHeightChartOptions = {}) {
    super(parent);
    this.units = options.units ?? 'metric';
    this.#targetDistance = options.targetDistance ?? 0;
    this.#targetSize = options.targetSize;
    this.#liveColor = options.liveColor ?? '#ee5530';
    this.#historyColor = options.historyColor ?? '#8b8887';
    this.#maxHistory = options.maxHistory ?? 15;

    this.element.className = styles.uiChart;
    this.canvas = document.createElement('canvas');
    this.element.append(this.canvas);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('UIHeightChart: unable to get 2d context');
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

  /** Move the current live trace into faded history. Call when a shot launches. */
  beginShot() {
    if (this.#live.heights.length) {
      this.#history.push(this.#live);
      if (this.#history.length > this.#maxHistory) this.#history.shift();
    }
    this.#live = { heights: [], distances: [] };
    this.#liveLength = 0;
    this.#draw();
  }

  /** Feed live samples (meters). Skips the redraw when nothing new arrived. */
  updateLive(heightSamples: number[], distanceSamples: number[]) {
    const length = Math.min(heightSamples.length, distanceSamples.length);
    if (!length || length === this.#liveLength) return;
    this.#liveLength = length;
    this.#live = {
      heights: heightSamples.slice(0, length),
      distances: distanceSamples.slice(0, length)
    };
    this.#draw();
  }

  /** Wipe history and the live trace. */
  clear() {
    this.#history = [];
    this.#live = { heights: [], distances: [] };
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
  /** Heights display as feet (imperial) or meters. */
  #toDisplayHeight(meters: number) {
    return this.units === 'imperial' ? UnitConversions.metersToFeet(meters) : meters;
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
    const font = `600 ${fontSize}px ${theme.fontFamily || 'sans-serif'}`;

    ctx.font = font;

    // scales (display units)
    const target = this.#toDisplay(this.#targetDistance);
    let dataMaxX = 0;
    let dataMaxY = 0;
    for (const trace of [...this.#history, this.#live]) {
      for (const d of trace.distances) dataMaxX = Math.max(dataMaxX, this.#toDisplay(d));
      for (const y of trace.heights) dataMaxY = Math.max(dataMaxY, this.#toDisplayHeight(y));

    }
    // x: target distance + 20% headroom, grown by data; rounded up to the grid step
    const xStep = UIHeightChart.#niceStep(Math.max(target * 1.2, dataMaxX, 50) / 5);
    const xMax = Math.ceil(Math.max(target * 1.2, dataMaxX, 50) / xStep) * xStep;
    // y: suggested max 120 ft (35 m), grown by data
    const ySuggested = this.units === 'imperial' ? 120 : 35;
    const yStep = UIHeightChart.#niceStep(Math.max(ySuggested, dataMaxY * 1.1) / 4);
    const yMax = Math.ceil(Math.max(ySuggested, dataMaxY * 1.1) / yStep) * yStep;

    // padding sized to the labels, plus an outer margin at every edge
    const outer = fontSize * 0.75;
    const yLabelWidth = ctx.measureText(String(yMax)).width;
    const xMaxLabelWidth = ctx.measureText(String(xMax)).width;
    const pad = {
      left: outer + yLabelWidth + fontSize * 0.5,
      right: outer + xMaxLabelWidth / 2,
      top: outer + fontSize * 0.5,
      bottom: outer + fontSize * 1.5
    };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;
    if (plotW <= 0 || plotH <= 0) return;

    const px = (x: number) => pad.left + (x / xMax) * plotW;
    const py = (y: number) => pad.top + plotH - (y / yMax) * plotH;

    ctx.clearRect(0, 0, w, h);
    ctx.font = font;

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

    // x labels (no gridlines, like the Chart.js version)
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let x = xStep; x <= xMax; x += xStep) {
      ctx.fillText(String(x), px(x), pad.top + plotH + fontSize * 0.5);
    }

    // target marker + landing zone at ground level
    if (target > 0) {
      ctx.strokeStyle = targetColor;
      if (this.#targetSize) {
        const size = this.#toDisplay(this.#targetSize);
        ctx.lineWidth = 3;
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.moveTo(px(Math.max(target - size, 0)), py(0));
        ctx.lineTo(px(Math.min(target + size, xMax)), py(0));
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(px(target), py(0));
      ctx.lineTo(px(target), pad.top);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // history traces, older = more faded
    for (let i = 0; i < this.#history.length; i++) {
      const alpha = 0.15 + 0.3 * ((i + 1) / this.#history.length);
      this.#drawTrace(this.#history[i], this.#historyColor, alpha, 1.5, px, py);
    }

    // live trace
    this.#drawTrace(this.#live, this.#liveColor, 1, 2, px, py);
  }

  #drawTrace(
    trace: Trace,
    color: string,
    alpha: number,
    width: number,
    px: (x: number) => number,
    py: (y: number) => number
  ) {
    const length = Math.min(trace.heights.length, trace.distances.length);
    if (length < 2) return;
    const ctx = this.#ctx;
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(px(this.#toDisplay(trace.distances[0])), py(this.#toDisplayHeight(trace.heights[0])));

    for (let i = 1; i < length; i++) {
       ctx.lineTo(px(this.#toDisplay(trace.distances[i])), py(this.#toDisplayHeight(trace.heights[i])));
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
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