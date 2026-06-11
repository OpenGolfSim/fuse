import { computePosition, flip, shift, offset, autoUpdate, Placement } from '@floating-ui/dom';
import styles from '@/css/ui.module.css';

interface UIDropDownMenuItem {
  label: string;
  id?: string;
  secondary?: string;
  disabled?: boolean;
  action: () => void;
}

type UIDropDownMenuOptions = {
  anchor: Element,
  menuItems?: UIDropDownMenuItem[],
  placement?: Placement
}

export class UIDropDownMenu {
  open: boolean;
  container: HTMLElement;
  menu: HTMLElement;
  menuItems?: UIDropDownMenuItem[];
  #cleanup: (() => void) | null = null;
  #anchor: Element;
  #placement: Placement;

  constructor(options: UIDropDownMenuOptions) {
    this.open = false;
    this.#anchor = options.anchor;
    this.#placement = options.placement || 'bottom';

    this.#anchor.classList.add(styles.clickableArea);
    this.#anchor.addEventListener('click', () => this.toggle());

    this.container = document.createElement('div');
    this.container.className = styles.dropDownContainer;
    this.container.style.display = 'none';
    document.body.append(this.container);
    
    this.menu = document.createElement('div');
    this.menu.className = styles.dropDownMenu;
    this.container.append(this.menu);
    
    this.setMenuItems(options.menuItems || []);

    window.addEventListener('blur', () => this.hide());
  }
  
  setMenuItems(menuItems: UIDropDownMenuItem[]) {
    this.menuItems = menuItems;
    this.menu.innerHTML = '';
    
    for (const item of menuItems) {
      const ele = document.createElement('a');
      ele.classList.add(styles.clickableArea, styles.dropDownItem);
      
      if (item.disabled) {
        ele.classList.add(styles.dropDownDisabled);
      }
      ele.addEventListener('click', () => {
        item.action();
        this.hide();
      });

      const primary = document.createElement('div');
      primary.textContent = item.label;
      primary.className = styles.dropDownItemPrimary;
      ele.append(primary);
      if (item.secondary) {
        const secondary = document.createElement('div');
        secondary.textContent = item.secondary;
        secondary.className = styles.dropDownItemSecondary;
        ele.append(secondary);
      }
      this.menu.append(ele);
    }
  }

  #updatePosition() {
    computePosition(this.#anchor, this.container, {
      placement: this.#placement,
      middleware: [offset(4), flip(), shift({ padding: 8 })],
    }).then(({ x, y }) => {
      Object.assign(this.container.style, {
        left: `${x}px`,
        top: `${y}px`,
      });
    });
  }

  show() {
    this.open = true;
    this.container.style.display = 'block';

    // autoUpdate re-runs positioning on scroll/resize/layout changes
    // and returns a cleanup function to stop listening
    this.#cleanup = autoUpdate(this.#anchor, this.container, () => {
      this.#updatePosition();
    });

    // close on outside click
    setTimeout(() => {
      document.addEventListener('click', this.#onOutsideClick);
    });
  }

  hide() {
    this.open = false;
    this.container.style.display = 'none';

    // stop listening for scroll/resize updates
    this.#cleanup?.();
    this.#cleanup = null;

    document.removeEventListener('click', this.#onOutsideClick);
  }

  toggle() {
    if (this.open) {
      this.hide();
    } else {
      this.show();
    }
  }

  #onOutsideClick = (e: MouseEvent) => {
    if (
      !this.container.contains(e.target as Node) &&
      !this.#anchor.contains(e.target as Node)
    ) {
      this.hide();
    }
  };

  destroy() {
    this.hide();
    this.container.remove();
  }
}