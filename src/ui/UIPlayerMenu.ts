import { PlayerStatus } from '@/courses/game';
import { PlayerState } from '@/courses/types';
import styles from '@/css/ui.module.css';

type UIPlayerUpdate = {
  player: string;
  club: string;
  strokes: number;
}

export class UIPlayerMenu {
  element: Element | null;
  wrapper?: HTMLElement;
  playerName?: HTMLElement;
  playerClub?: HTMLElement;
  playerScore?: HTMLElement;

  constructor(element: string | Element) {
    if (typeof element === 'string') {
      this.element = document.querySelector(element);
    } else {
      this.element = element;
    }
    if (!this.element) {
      throw new Error('Unable to find UIPlayerMenu root element');
    }    
    this.element.className = styles.playerMenu;
    this._build();
  }

  _build() {
    if (!this.element) {
      console.error('Unable to find UIPlayerMenu root element');
      return;
    }
    if (this.wrapper) {
      this.wrapper.remove();
    }
    this.wrapper = document.createElement('div');
    this.wrapper.setAttribute('id', 'ui-player-menu');
    this.wrapper.className = styles.playerMenuContainer;
    
    this.playerName = document.createElement('div');
    this.playerName.className = styles.playerMenuName;
    this.playerName.textContent = 'Player X';
    
    this.playerClub = document.createElement('div');
    this.playerClub.className = styles.playerMenuClub;
    this.playerClub.textContent = 'DR';
    
    this.playerScore = document.createElement('div');
    this.playerScore.className = styles.playerMenuScore;
    this.playerScore.textContent = 'E';
    
    this.wrapper.append(this.playerName, this.playerClub, this.playerScore);
  
    this.element.append(this.wrapper);

  }

  update({ player, state }: PlayerStatus) {
    if (this.playerName) this.playerName.textContent = player.name;
    if (this.playerClub) this.playerClub.textContent = state.club.name;
    if (this.playerScore) this.playerScore.textContent = `${state.strokes || 0}`;
  }

}
