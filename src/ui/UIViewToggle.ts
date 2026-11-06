import styles from '@/css/ui.module.css';
import { UIElementBase } from './UIElementBase';
import frameCornersIcon from '@phosphor-icons/core/assets/regular/frame-corners.svg?raw';
import chartLineIcon from '@phosphor-icons/core/assets/regular/chart-line.svg?raw';

export type UIViewMode = 'game' | 'charts';

type UIViewToggleOptions = {
  /** Root element that becomes the view grid. Must contain the game pane. */
  layout: string | Element;
  /** Pane containing the render canvas (the renderer's container). */
  gamePane: string | Element;
  /** Initial mode. Defaults to 'game'. */
  mode?: UIViewMode;
  /** localStorage key. When set, the selected mode persists between
   *  sessions and overrides the mode option on load. */
  storageKey?: string;
}

interface UIViewToggleEvents {
  change: (mode: UIViewMode) => void;
}

/**
 * Button group for switching between a full-screen game view and a chart
 * view where the game shrinks to the top-left, with a pane to its right and
 * a pane along the bottom (e.g. for top-down and side-view shot charts).
 *
 * The renderer and camera follow the game pane automatically via their own
 * ResizeObservers, provided the renderer's container is the game pane and
 * the camera was given the canvas element.
 */
export class UIViewToggle extends UIElementBase<UIViewToggleEvents> {
  mode: UIViewMode = 'game';
  layout: Element;
  gamePane: Element;
  /** Pane to the right of the game in chart view. Empty; mount content here. */
  rightPane: HTMLDivElement;
  /** Pane along the bottom in chart view. Empty; mount content here. */
  bottomPane: HTMLDivElement;
  gameButton: HTMLButtonElement;
  chartsButton: HTMLButtonElement;
  #storageKey?: string;

  constructor(parent: string | Element, options: UIViewToggleOptions) {
    super(parent);
    this.layout = UIViewToggle.#resolve(options.layout, 'layout');
    this.gamePane = UIViewToggle.#resolve(options.gamePane, 'gamePane');

    this.layout.classList.add(styles.viewLayout);
    this.gamePane.classList.add(styles.gamePane);

    this.rightPane = document.createElement('div');
    this.rightPane.className = styles.chartPaneRight;
    this.bottomPane = document.createElement('div');
    this.bottomPane.className = styles.chartPaneBottom;
    this.layout.append(this.rightPane, this.bottomPane);

    this.element.className = styles.viewToggleGroup;
    this.gameButton = this.#createButton(frameCornersIcon, 'Game view', 'game');
    this.chartsButton = this.#createButton(chartLineIcon, 'Chart view', 'charts');
    this.element.append(this.gameButton, this.chartsButton);

    this.#storageKey = options.storageKey;
    this.setMode(this.#storedMode() ?? options.mode ?? 'game', true);
  }

  toggle() {
    this.setMode(this.mode === 'game' ? 'charts' : 'game');
  }

  setMode(mode: UIViewMode, force = false) {
    if (mode === this.mode && !force) return;
    this.mode = mode;
    this.layout.classList.toggle(styles.viewLayoutCharts, mode === 'charts');
    this.gameButton.classList.toggle(styles.viewToggleButtonActive, mode === 'game');
    this.chartsButton.classList.toggle(styles.viewToggleButtonActive, mode === 'charts');
    if (this.#storageKey) {
      // localStorage can throw (private browsing, blocked storage)
      try { localStorage.setItem(this.#storageKey, mode); } catch { /* non-fatal */ }
    }
    this.emit('change', mode);
  }

  #createButton(icon: string, label: string, mode: UIViewMode): HTMLButtonElement {
    const button = document.createElement('button');
    button.classList.add(styles.viewToggleButton, styles.clickableArea);
    button.innerHTML = icon;
    button.title = label;
    button.setAttribute('aria-label', label);
    button.addEventListener('click', () => this.setMode(mode));
    return button;
  }

  static #resolve(target: string | Element, name: string): Element {
    if (target instanceof Element) return target;
    const match = document.querySelector(target);
    if (!match) throw new Error(`UIViewToggle: unable to find ${name} element (${target})`);
    return match;
  }

  #storedMode(): UIViewMode | undefined {
    if (!this.#storageKey) return undefined;
    try {
      const stored = localStorage.getItem(this.#storageKey);
      if (stored === 'game' || stored === 'charts') return stored;
    } catch { /* non-fatal */ }
    return undefined;
  }
}