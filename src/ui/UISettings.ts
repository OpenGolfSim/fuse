import styles from '@/css/ui.module.css';
import { UIElementBase } from './UIElementBase';

export type UISettingsSegmentOption = {
  label: string;
  value: string;
};

export type UISettingsRow =
  | {
    kind: 'segments';
    id: string;
    label: string;
    options: UISettingsSegmentOption[];
    value: string;
  }
  | {
    kind: 'slider';
    id: string;
    label: string;
    min: number;
    max: number;
    step?: number;
    value: number;
    /** Formats the value shown next to the slider, e.g. `(v) => `${v} m``. */
    format?: (value: number) => string;
  };

export type UISettingsOptions = {
  title?: string;
  rows: UISettingsRow[];
  confirmLabel?: string;
  cancelLabel?: string;
};

type SettingsValue = string | number;

let settingsId = 0;

interface UISettingsEvents {
  /** Fires on every user edit so changes can be applied live. */
  change: (id: string, value: SettingsValue) => void;
  confirm: () => void;
  /** Fires after the values have been reverted to their state on open. */
  cancel: () => void;
  open: () => void;
  close: () => void;
}

/**
 * Modal settings panel: labelled rows of segmented controls and sliders.
 *
 * Edits emit `change` immediately (apply them live), `confirm` keeps them and
 * `cancel` reverts every row to the value it had when the panel was opened.
 *
 *   const settings = new UISettings(document.body, {
 *     title: 'Settings',
 *     rows: [{ kind: 'slider', id: 'stimp', label: 'Green speed', min: 6, max: 14, value: 9 }],
 *   });
 *   settings.on('change', (id, value) => { … });
 *   settings.open();
 */
export class UISettings extends UIElementBase<UISettingsEvents> {
  title: string;
  rows: UISettingsRow[];
  isOpen = false;

  #values = new Map<string, SettingsValue>();
  #initial = new Map<string, SettingsValue>();
  #controls = new Map<string, HTMLElement>();
  #lastFocused: Element | null = null;
  #onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && this.isOpen) {
      event.preventDefault();
      this.cancel();
    }
  };

  constructor(parent: string | Element, options: UISettingsOptions) {
    super(parent);
    this.title = options.title ?? 'Settings';
    this.rows = options.rows;
    this.element.className = styles.settingsOverlay;
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-modal', 'true');

    const card = document.createElement('div');
    card.className = styles.settingsCard;

    const title = document.createElement('h2');
    title.className = styles.settingsTitle;
    title.id = `ui-settings-title-${++settingsId}`;
    title.textContent = this.title;
    this.element.setAttribute('aria-labelledby', title.id);
    card.append(title);

    for (const row of this.rows) {
      this.#values.set(row.id, row.value);
      this.#initial.set(row.id, row.value);
      card.append(this.#buildRow(row));
    }

    const actions = document.createElement('div');
    actions.className = styles.settingsActions;

    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = styles.settingsPrimary;
    confirm.textContent = options.confirmLabel ?? 'Done';
    confirm.addEventListener('click', () => {
      this.emit('confirm');
      this.close();
    });

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = styles.settingsSecondary;
    cancel.textContent = options.cancelLabel ?? 'Cancel';
    cancel.addEventListener('click', () => this.cancel());

    actions.append(confirm, cancel);
    card.append(actions);
    this.element.append(card);
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    for (const row of this.rows) this.#initial.set(row.id, this.#values.get(row.id) ?? row.value);
    this.#lastFocused = document.activeElement;
    this.element.classList.add(styles.settingsOverlayOpen);
    document.addEventListener('keydown', this.#onKeyDown);
    const first = this.element.querySelector<HTMLElement>('button, input');
    first?.focus();
    this.emit('open');
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.element.classList.remove(styles.settingsOverlayOpen);
    document.removeEventListener('keydown', this.#onKeyDown);
    if (this.#lastFocused instanceof HTMLElement) this.#lastFocused.focus();
    this.#lastFocused = null;
    this.emit('close');
  }

  /** Reverts every row to its value at open time, emitting change for each. */
  cancel() {
    for (const row of this.rows) {
      const initial = this.#initial.get(row.id);
      if (initial === undefined || initial === this.#values.get(row.id)) continue;
      this.#applyValue(row, initial);
    }
    this.emit('cancel');
    this.close();
  }

  /** Updates controls from outside without emitting (e.g. a keyboard club change). */
  setValues(values: Record<string, SettingsValue>) {
    for (const row of this.rows) {
      if (!(row.id in values)) continue;
      const value = values[row.id];
      this.#values.set(row.id, value);
      this.#renderValue(row, value);
    }
  }

  getValues(): Record<string, SettingsValue> {
    return Object.fromEntries(this.#values);
  }

  #buildRow(row: UISettingsRow): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = styles.settingsRow;

    const label = document.createElement('span');
    label.className = styles.settingsRowLabel;
    label.id = `ui-settings-label-${row.id}`;
    label.textContent = row.label;
    wrapper.append(label);

    if (row.kind === 'segments') {
      const group = document.createElement('div');
      group.className = styles.settingsSegments;
      group.setAttribute('role', 'group');
      group.setAttribute('aria-labelledby', label.id);

      for (const option of row.options) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = styles.settingsSegment;
        button.textContent = option.label;
        button.dataset.value = option.value;
        button.setAttribute('aria-pressed', String(option.value === row.value));
        button.addEventListener('click', () => this.#applyValue(row, option.value));
        group.append(button);
      }

      this.#controls.set(row.id, group);
      wrapper.append(group);
      return wrapper;
    }

    const control = document.createElement('div');
    control.className = styles.settingsSliderWrap;

    const input = document.createElement('input');
    input.type = 'range';
    input.className = styles.settingsSlider;
    input.min = String(row.min);
    input.max = String(row.max);
    input.step = String(row.step ?? 1);
    input.value = String(row.value);
    input.id = `ui-settings-input-${row.id}`;
    input.setAttribute('aria-labelledby', label.id);

    const value = document.createElement('span');
    value.className = styles.settingsSliderValue;
    value.textContent = this.#format(row, row.value);

    const sync = (next: number) => {
      const clamped = Math.min(row.max, Math.max(row.min, next));
      input.value = String(clamped);
      value.textContent = this.#format(row, clamped);
      this.#paintFill(input);
    };

    input.addEventListener('input', () => {
      const next = Number(input.value);
      this.#values.set(row.id, next);
      value.textContent = this.#format(row, next);
      this.#paintFill(input);
      this.emit('change', row.id, next);
    });

    control.append(input, value);
    this.#controls.set(row.id, control);
    wrapper.append(control);
    sync(row.value);
    return wrapper;
  }

  #applyValue(row: UISettingsRow, value: SettingsValue) {
    this.#values.set(row.id, value);
    this.#renderValue(row, value);
    this.emit('change', row.id, value);
  }

  #renderValue(row: UISettingsRow, value: SettingsValue) {
    const control = this.#controls.get(row.id);
    if (!control) return;

    if (row.kind === 'segments') {
      control.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
        button.setAttribute('aria-pressed', String(button.dataset.value === value));
      });
      return;
    }

    const input = control.querySelector<HTMLInputElement>('input');
    const label = control.querySelector<HTMLElement>(`.${styles.settingsSliderValue}`);
    const numeric = Number(value);
    if (input) {
      input.value = String(numeric);
      this.#paintFill(input);
    }
    if (label) label.textContent = this.#format(row, numeric);
  }

  #format(row: UISettingsRow, value: number) {
    if (row.kind !== 'slider') return String(value);
    return row.format ? row.format(value) : String(value);
  }

  /** Fills the track up to the thumb using the --fill custom property. */
  #paintFill(input: HTMLInputElement) {
    const min = Number(input.min);
    const max = Number(input.max);
    const value = Number(input.value);
    const ratio = max === min ? 0 : (value - min) / (max - min);
    input.style.setProperty('--fill', `${Math.round(ratio * 100)}%`);
  }
}
