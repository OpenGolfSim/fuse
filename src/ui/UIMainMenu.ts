import styles from '@/css/ui.module.css';
import { UIElementBase } from './UIElementBase';
import iconImage from '@/images/opengolfsim.svg';
import { UIDropDownMenu, type UIDropDownMenuItem } from './UIDropDownMenu';
import { app } from '..';

interface UIMainMenuEvents {
  help: () => void;
  settings: () => void;
  exit: () => void;
}

export class UIMainMenu extends UIElementBase<UIMainMenuEvents> {
  dropdown: UIDropDownMenu;
  link: Element;

  constructor(parent: string | Element) {
    super(parent);
    // this.element = document.createElement('div');
    this.link = document.createElement('a');
    
    const image = document.createElement('img');
    image.src = iconImage;
    image.className = styles.mainMenuIcon;
    this.link.append(image);
    this.element.append(this.link);
    
    this.element.className = styles.mainMenu;
    // this.parent.append(this.element);
 
    const menuItems: UIDropDownMenuItem[] = [
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

    this.dropdown = new UIDropDownMenu({
      anchor: this.link, 
      placement: 'bottom-start',
      menuItems
    });

  }
}