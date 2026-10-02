import styles from '@/css/ui.module.css';
import { UIElementBase } from './UIElementBase';

export type UIToastOptions = {
  title?: string | HTMLDivElement,
  subtitle?: string | HTMLDivElement,
  text?: string | HTMLDivElement,
}

interface UIToastEvents {
  closed: () => void;
}

export class UIToast extends UIElementBase<UIToastEvents> {
  timer?: number;

  constructor(parent: string | Element, options: UIToastOptions = {}) {
    super(parent);
    this.element.classList.add(styles.toastMain, styles.toastMainHidden);
  }

  #transitionEnd = () => {
    this.element.classList.add(styles.toastMainHidden);
    this.element.removeEventListener('transitionend', this.#transitionEnd);
  }

  show(delay = 4000) {        
    this.element.removeEventListener('transitionend', this.#transitionEnd);
    this.element.classList.add(styles.toastMainShow);
    this.element.classList.remove(styles.toastMainHidden);

    if (delay) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.hide(), delay);
    }
  }

  hide() {
    this.element.addEventListener('transitionend', this.#transitionEnd, { once: true });
    this.element.classList.remove(styles.toastMainShow);
  }
}