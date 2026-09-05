import styles from '@/css/ui.module.css';
import { UIElementBase } from './UIElementBase';
import { UIDropDownMenu, type UIDropDownMenuItem } from './UIDropDownMenu';
import { app } from '..';

type UIToastOptions = {
  initialText?: ''
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
    this.element.classList.add(styles.toastMain);
    this.bodyTitle = document.createElement('div');
    this.bodyTitle.classList.add(styles.toastTitle);

    this.bodyText = document.createElement('div');
    this.bodyText.classList.add(styles.toastText);

    if (options.initialText) {
      this.bodyText.textContent = options.initialText;
    }
    
    this.element.append(this.bodyTitle, this.bodyText);
  }

  show(title: string, message: string) {
    this.bodyTitle.textContent = title;
    this.bodyText.textContent = message;
    this.element.classList.add(styles.toastMainShow);

    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.hide(), 4000);
  }

  hide() {
    this.element.classList.remove(styles.toastMainShow);
  }
}