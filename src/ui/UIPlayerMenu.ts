import { PlayerStatus } from '@/courses/game';
import styles from '@/css/ui.module.css';
import { UIDropDownMenu } from '@/ui/UIDropDownMenu';
import EventEmitter from 'eventemitter3';

type UIPlayerUpdate = {
  player: string;
  club: string;
  strokes: number;
}

type UIPlayerMenuOptions = {
  setupData?: Pick<OpenGolfSim.SetupData, 'players'>;
}

interface UIPlayerMenuEvents {
  selectPlayer: (player: OpenGolfSim.Player) => void;
  selectClub: (club: OpenGolfSim.Club) => void;
  showScorecard: () => void;
}

export class UIPlayerMenu extends EventEmitter<UIPlayerMenuEvents> {
  element: Element | null;
  playerDropdown?: UIDropDownMenu;
  clubDropdown?: UIDropDownMenu;
  wrapper?: HTMLElement;
  playerNameAvatar?: HTMLElement;
  playerNameText?: HTMLElement;
  playerClub?: HTMLElement;
  playerScore?: HTMLElement;
  allPlayers: OpenGolfSim.Player[];

  constructor(element: string | Element, options: UIPlayerMenuOptions) {
    super();
    if (typeof element === 'string') {
      this.element = document.querySelector(element);
    } else {
      this.element = element;
    }
    if (!this.element) {
      throw new Error('Unable to find UIPlayerMenu root element');
    }    
    this.element.className = styles.playerMenu;

    if (!options.setupData?.players.length) {
      throw new Error('No players found in setupData');
    }
    this.allPlayers = options.setupData.players || [];
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
    
    this.playerNameAvatar = document.createElement('div');
    this.playerNameAvatar.className = styles.playerMenuNameAvatar;
    this.playerNameText = document.createElement('div');
    this.playerNameText.className = styles.playerMenuNameText;

    const playerName = document.createElement('a');
    playerName.className = styles.playerMenuName;
    this.playerNameText.textContent = 'Player X';
    playerName.append(this.playerNameAvatar, this.playerNameText);
    
    this.playerClub = document.createElement('div');
    this.playerClub.className = styles.playerMenuClub;
    this.playerClub.textContent = 'DR';
    
    this.playerScore = document.createElement('div');
    this.playerScore.className = styles.playerMenuScore;
    this.playerScore.textContent = 'E';
    
    this.wrapper.append(playerName, this.playerClub, this.playerScore);
  
    this.element.append(this.wrapper);

    this.playerDropdown = new UIDropDownMenu({
      anchor: playerName, 
      placement: 'bottom-start',
      menuItems: this.allPlayers.map(player => ({
        label: player.name,
        action: () => this.emit('selectPlayer', player)
      }))
    });
    this.clubDropdown = new UIDropDownMenu({
      anchor: this.playerClub,
        menuItems: [
        // { label: 'Driver', action: () => this.emit('clubChange') },
        // { label: '2-Iron', action: () => console.log("EXIT") },
        // { label: '3-Iron', action: () => console.log("EXIT") },
        // { label: 'Putter', action: () => console.log("EXIT") },
      ]
    });
  }

  update({ player, state }: PlayerStatus) {
    if (this.playerNameText) this.playerNameText.textContent = player.name;
    if (this.playerClub) this.playerClub.textContent = state.club.name;
    if (this.playerScore) this.playerScore.textContent = `${state.strokes || 0}`;

    this.clubDropdown?.setMenuItems(
      player.clubs.map(club => ({
        label: club.name,
        action: () => this.emit('selectClub', club)
      }))
    );
  }

}
