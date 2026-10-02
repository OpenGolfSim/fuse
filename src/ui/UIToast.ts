import styles from '@/css/ui.module.css';
import { UIElementBase } from './UIElementBase';
import { UIDropDownMenu, type UIDropDownMenuItem } from './UIDropDownMenu';
import { app } from '..';

export type UIToastOptions = {
  title?: string | HTMLDivElement,
  subtitle?: string | HTMLDivElement,
  text?: string | HTMLDivElement,
}

interface UIToastEvents {
  closed: () => void;
}

export class UIToast extends UIElementBase<UIToastEvents> {
  // bodyTitle: HTMLDivElement;
  // bodyText: HTMLDivElement;
  // bodySubtitle: HTMLDivElement;
  timer?: number;

  constructor(parent: string | Element, options: UIToastOptions = {}) {
    super(parent);
    this.element.classList.add(styles.toastMain, styles.toastMainHidden);
    // this.bodyTitle = document.createElement('div');
    // this.bodyTitle.classList.add(styles.toastTitle);
    
    // this.bodySubtitle = document.createElement('div');
    // this.bodySubtitle.classList.add(styles.toastSubtitle);

    // this.bodyText = document.createElement('div');
    // this.bodyText.classList.add(styles.toastText);

    // if (typeof options.title === 'string') {
    //   this.bodyTitle.textContent = options.title;
    // } else if (options.title) {
    //   this.bodyTitle.replaceChildren(options.title);
    // }
    // if (typeof options.subtitle === 'string') {
    //   this.bodySubtitle.textContent = options.subtitle;
    // } else if (options.subtitle) {
    //   this.bodySubtitle.replaceChildren(options.subtitle);
    // }
    // if (typeof options.text === 'string') {
    //   this.bodyText.textContent = options.text;
    // } else if (options.text) {
    //   this.bodyText.replaceChildren(options.text);
    // }
    
    // this.element.append(this.bodyTitle, this.bodySubtitle, this.bodyText);
  }

  #transitionEnd = () => {
    console.log('animation ended');
    this.element.classList.add(styles.toastMainHidden);
    this.element.removeEventListener('transitionend', this.#transitionEnd);
  }

  show(delay = 4000) {
    // const { title, text, subtitle } = options;
    // if (typeof title === 'string') {
    //   this.bodyTitle.textContent = title;
    // } else if (title) {
    //   this.bodyTitle.replaceChildren(title);
    // }

    // if (typeof subtitle === 'string') {
    //   this.bodySubtitle.textContent = subtitle;
    // } else if (subtitle) {
    //   this.bodySubtitle.replaceChildren(subtitle);
    // }

    // if (typeof text === 'string') {
    //   this.bodyText.textContent = text;
    // } else if (text) {
    //   this.bodyText.replaceChildren(text);
    // }
        
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