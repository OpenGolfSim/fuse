import styles from '@/css/ui.module.css';
import { UIElementBase } from './UIElementBase';
import iconImage from '@/images/opengolfsim.svg';
import { UIDropDownMenu } from './UIDropDownMenu';

interface UIDialogEvents {
  close: () => void;
}

export type UIDialogOptions = {
  title?: string;
  preventClose?: boolean;
};

export class UIDialog extends UIElementBase<UIDialogEvents> {
  
  header: Element;
  title?: Element;
  closeButton?: Element;
  content: Element;
  preventClose: boolean;

  constructor(parent: string | Element, options: UIDialogOptions = {}) {
    super(parent);
    this.parent.className = styles.dialog;
    this.element.className = styles.dialogContent;
    this.header = document.createElement('div');
    this.header.classList.add(styles.dialogHeader);
    
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

    this.content = document.createElement('div');
    this.content.classList.add(styles.dialogContentBody);
    this.element.append(this.content);
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
    this.parent.classList.add(styles.dialogOpen);
  }
  close() {
    this.parent.classList.remove(styles.dialogOpen);
  }
}
