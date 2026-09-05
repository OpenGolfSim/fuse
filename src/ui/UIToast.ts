import styles from '@/css/ui.module.css';
import { UIElementBase } from './UIElementBase';
import { UIDropDownMenu, type UIDropDownMenuItem } from './UIDropDownMenu';
import { app } from '..';

type UIToastOptions = {
  title?: string
  text?: string
}

interface UILaunchMonitorEvents {
  closed: () => void;
}

export class UIToast extends UIElementBase<UILaunchMonitorEvents> {
  bodyTitle: HTMLDivElement;
  bodyText: HTMLDivElement;
  timer?: number;

  constructor(parent: string | Element, options: UIToastOptions = {}) {
    super(parent);
    this.element.classList.add(styles.toastMain, styles.toastMainHidden);
    this.bodyTitle = document.createElement('div');
    this.bodyTitle.classList.add(styles.toastTitle);

    this.bodyText = document.createElement('div');
    this.bodyText.classList.add(styles.toastText);

    if (options.title) {
      this.bodyTitle.textContent = options.title;
    }
    if (options.text) {
      this.bodyText.textContent = options.text;
    }
    
    this.element.append(this.bodyTitle, this.bodyText);
  }

  #transitionEnd = () => {
    console.log('animation ended');
    this.element.classList.add(styles.toastMainHidden);
    this.element.removeEventListener('transitionend', this.#transitionEnd);
  }

  show(title: string, message: string, delay = 4000) {
    this.bodyTitle.textContent = title;
    this.bodyText.textContent = message;
    this.element.removeEventListener('transitionend', this.#transitionEnd);
    this.element.classList.add(styles.toastMainShow);
    this.element.classList.remove(styles.toastMainHidden);

    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.hide(), delay);
  }

  hide() {
    this.element.addEventListener('transitionend', this.#transitionEnd, { once: true });
    this.element.classList.remove(styles.toastMainShow);
  }
}