import EventEmitter from 'eventemitter3';
import { CoursePlayer } from '@/courses/player';
import styles from '@/css/ui.module.css';
import { UIDropDownMenu } from '@/ui/UIDropDownMenu';
import { UIElementBase } from './UIElementBase';

type UIPlayerMenuOptions = {
  players: CoursePlayer[],
  disablePutting?: boolean
};

interface UIPlayerMenuEvents {
  selectPlayer: (player: CoursePlayer) => void;
  selectClub: (club: OpenGolfSim.Club) => void;
  showScorecard: () => void;
}

export class UIPlayerMenu extends UIElementBase<UIPlayerMenuEvents> {
  playerDropdown?: UIDropDownMenu;
  clubDropdown?: UIDropDownMenu;
  wrapper?: HTMLElement;
  playerNameAvatar?: HTMLElement;
  playerNameText?: HTMLElement;
  playerClub?: HTMLElement;
  playerScore?: HTMLElement;
  disablePutting: boolean;
  allPlayers: CoursePlayer[];

  constructor(parent: string | Element, options: UIPlayerMenuOptions) {
    super(parent);
    console.log(options);
    this.element.className = styles.playerMenu;

    this.disablePutting = !!options.disablePutting;

    if (!options.players?.length) {
      throw new Error('No players found in options');
    }
    this.allPlayers = options.players || [];
    this.#build();
  }

  #build() {
    if (!this.element) {
      console.error('Unable to find UIPlayerMenu root element');
      return;
    }
    if (this.wrapper) {
      this.wrapper.remove();
    }
    const firstPlayer = this.allPlayers?.[0];

    this.wrapper = document.createElement('div');
    this.wrapper.setAttribute('id', 'ui-player-menu');
    this.wrapper.className = styles.playerMenuContainer;
    
    // this.playerNameAvatar = document.createElement('div');
    // this.playerNameAvatar.className = styles.playerMenuNameAvatar;
    // playerName.append(this.playerNameAvatar);
    this.playerNameText = document.createElement('div');
    this.playerNameText.className = styles.playerMenuNameText;

    const playerName = document.createElement('a');
    playerName.className = styles.playerMenuName;
    this.playerNameText.textContent = firstPlayer.name || '(No Player)';
    playerName.append(this.playerNameText);
    
    this.playerClub = document.createElement('div');
    this.playerClub.className = styles.playerMenuClub;
    this.playerClub.textContent = 'DR';
    
    this.playerScore = document.createElement('div');
    this.playerScore.className = styles.playerMenuScore;
    this.playerScore.textContent = 'E';
    
    this.wrapper.append(playerName, this.playerClub, this.playerScore);
  
    this.element.append(this.wrapper);

    if (this.allPlayers.length > 1) {
      this.playerDropdown = new UIDropDownMenu({
        anchor: playerName, 
        placement: 'bottom-start',
        menuItems: this.allPlayers.map(player => ({
          label: player.name,
          id: player.id,
          disabled: player.disabled,
          action: () => this.emit('selectPlayer', player)
        }))
      });
    }

    this.clubDropdown = new UIDropDownMenu({
      anchor: this.playerClub,
        menuItems: firstPlayer.clubs
          .filter(club => this.disablePutting ? club.id !== 'PT' : true)
          .map(club => ({
            label: club.name,
            disabled: this.disablePutting && club.distance === 0,
            action: () => this.emit('selectClub', club)
          }))
    });
  }

  update(player: CoursePlayer) {
    if (this.playerNameText) this.playerNameText.textContent = player.name;
    if (this.playerClub) this.playerClub.textContent = player.currentClub?.name || 'NA';
    if (this.playerScore) this.playerScore.textContent = `${player.strokes || 0}`;

    // this.playerDropdown.menuItems?.find(item => item.id === player.id)

    this.playerDropdown?.setMenuItems(
      this.allPlayers.map(player => ({
        label: player.name,
        id: player.id,
        disabled: player.disabled,
        action: () => this.emit('selectPlayer', player)
      }))  
    );

    this.clubDropdown?.setMenuItems(
      player.clubs
      .filter(club => this.disablePutting ? club.id !== 'PT' : true)
      .map(club => ({
        label: club.name,
        action: () => this.emit('selectClub', club)
      }))
    );
  }

}
