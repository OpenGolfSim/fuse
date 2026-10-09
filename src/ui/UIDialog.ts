import EventEmitter from 'eventemitter3';
import styles from '@/css/ui.module.css';
import { UIElementBase } from './UIElementBase';

export interface UIDialogEvents {
  open: () => void;
  close: () => void;
}

export type UIDialogOptions = {
  title?: string;
  preventClose?: boolean;
};

// export class UIDialog extends UIElementBase<UIDialogEvents> {
export class UIDialog<Events extends UIDialogEvents = UIDialogEvents> extends UIElementBase<Events> {
  
  header: Element;
  title?: Element;
  closeButton?: Element;
  content: Element;
  preventClose: boolean;
  isOpen: boolean;

  constructor(parent: string | Element, options: UIDialogOptions = {}) {
    super(parent);
    this.parent.className = styles.dialog;
    this.element.className = styles.dialogContent;
    this.header = document.createElement('div');
    this.header.classList.add(styles.dialogHeader);
    
    this.isOpen = false;
    if (options.title) {
      this.title = document.createElement('div');
      this.title.textContent = options.title;
      this.title.classList.add(styles.dialogTitle);
      this.header.append(this.title);
    }
    
    this.preventClose = !!options.preventClose;
    if (!this.preventClose) {
      this.enableClose();
    }

    this.element.append(this.header);

    const existingContent = this.parent.querySelector('.content');
    if (existingContent) {
      this.content = existingContent;
    } else {
      this.content = document.createElement('div');
    }
    
    this.element.append(this.content);
    this.content.classList.add(styles.dialogContentBody);
  }

  disableClose() {
    this.closeButton?.remove();
  }

  enableClose() {
    this.closeButton = document.createElement('a');
    this.closeButton.classList.add(styles.dialogCloseButton, styles.clickableArea);
    this.closeButton.innerHTML = '&times;';
    this.closeButton.addEventListener('click', () => this.close());
    this.header.append(this.closeButton);
  }

  open() {
    this.isOpen = true;
    this.parent.classList.add(styles.dialogOpen);
    this.#emitBase('open');
  }
  close() {
    this.isOpen = false;
    this.parent.classList.remove(styles.dialogOpen);
    this.#emitBase('close');
  }
  // TS can't resolve base event names against the generic Events type
  #emitBase(event: keyof UIDialogEvents) {
    (this as unknown as EventEmitter<UIDialogEvents>).emit(event);
   }  
}
