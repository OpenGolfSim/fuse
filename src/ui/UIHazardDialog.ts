import { CourseHole, CourseHoleMap } from '@/courses/loader';
import { CoursePlayer } from '@/courses/player';
import styles from '@/css/ui.module.css';
import { UIDialog, UIDialogEvents, UIDialogOptions } from '@/ui/UIDialog';
import dropIcon from '@/images/drop.svg?url';
import rehitIcon from '@/images/rehit.svg?url';
import mulliganIcon from '@/images/mulligan.svg?url';


type UIHazardDialogOptions = {} & UIDialogOptions;


interface UIHazardDialogEvents extends UIDialogEvents {
  drop: () => void
  mulligan: () => void
  rehit: () => void
}

export class UIHazardDialog extends UIDialog<UIHazardDialogEvents> {
  constructor(parent: string | Element, options: UIHazardDialogOptions) {
    super(parent, { title: 'Hazard', ...options });

    const buttons = document.createElement('div');
    buttons.classList.add(styles.hazardButtons)
    
    const dropOption = this.#addButton(dropIcon, 'Drop');
    buttons.append(dropOption);
    
    const mulliganOption = this.#addButton(mulliganIcon, 'Mulligan');
    buttons.append(mulliganOption);
    
    const rehitOption = this.#addButton(rehitIcon, 'Re-Hit');
    buttons.append(rehitOption);

    dropOption.addEventListener('click', (e) => this.emit('drop'));
    mulliganOption.addEventListener('click', (e) => this.emit('mulligan'));
    rehitOption.addEventListener('click', (e) => this.emit('rehit'));
    this.content.append(buttons);
    // this.open();
  }

  #addButton(iconUrl: string, label: string) {
    const parent = document.createElement('a');
    parent.classList.add(styles.hazardButton, styles.clickableArea)
    const title = document.createElement('div');
    title.textContent = label;
    const icon = document.createElement('img');
    icon.width = 100;
    icon.src = iconUrl;
    parent.append(icon, title);
    return parent;
  }
}