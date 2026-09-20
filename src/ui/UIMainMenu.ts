import styles from '@/css/ui.module.css';
import { UIElementBase } from './UIElementBase';
import iconImage from '@/images/opengolfsim.svg';
import { UIDropDownMenu, type UIDropDownMenuItem } from './UIDropDownMenu';
import { app } from '..';
import {
  getPlayerRotation,
  setPlayerRotation,
  PLAYER_ROTATIONS,
  ROTATION_LABELS,
  type PlayerRotation
} from '@/utils/preferences';

type UIMainMenuOptions = {
  iconUrl?: string;
  iconStyle?: string;
}
interface UIMainMenuEvents {
  help: () => void;
  settings: () => void;
  stats: () => void;
  exit: () => void;
  playerRotation: (mode: PlayerRotation) => void;
}

export class UIMainMenu extends UIElementBase<UIMainMenuEvents> {
  dropdown: UIDropDownMenu;
  link: Element;

  constructor(parent: string | Element, options: UIMainMenuOptions = {}) {
    super(parent);
    // this.element = document.createElement('div');
    this.link = document.createElement('a');
    
    const image = document.createElement('img');
    image.src = options.iconUrl ?? iconImage;
    image.className = styles.mainMenuIcon;
    if (options.iconStyle) {
      image.style = options.iconStyle;
    }
    this.link.append(image);
    this.element.append(this.link);
    
    this.element.className = styles.mainMenu;
    // this.parent.append(this.element);

    this.dropdown = new UIDropDownMenu({
      anchor: this.link,
      placement: 'bottom-start',
      menuItems: this.#buildMenuItems()
    });
  }

  #buildMenuItems(): UIDropDownMenuItem[] {
    const currentRotation = getPlayerRotation();

    const menuItems: UIDropDownMenuItem[] = [
      {
        label: 'Player Rotation',
        id: 'player-rotation',
        secondary: ROTATION_LABELS[currentRotation],
        action: () => {
          const next = PLAYER_ROTATIONS[(PLAYER_ROTATIONS.indexOf(currentRotation) + 1) % PLAYER_ROTATIONS.length];
          setPlayerRotation(next);
          // re-render so the item shows the new value next time it's opened
          this.dropdown.setMenuItems(this.#buildMenuItems());
          this.emit('playerRotation', next);
        }
      },
      {
        label: 'Debug Stats',
        id: 'stats',
        action: () => this.emit('stats')
      },
      {
        label: 'Help',
        id: 'help',
        action: () => app.help()
      },
      {
        label: 'Exit',
        id: 'exit',
        action: () => app.exit()
      }      
    ];
    if (app.appType !== 'web') {
      menuItems.unshift({
        label: 'Settings',
        id: 'settings',
        action: () => app.settings()
      });
    }
    return menuItems;
  }
}
