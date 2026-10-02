import { UIToast, type UIToastOptions } from '@/ui/UIToast';
import styles from '@/css/ui.module.css';


export type UIHoleScoreToastOptions = {
  hole: { number: string, par: number },
  player?: string,
  label?: string,
  score?: number,
}

export class UIHoleScoreToast extends UIToast {
  holeHeader: HTMLDivElement;
  holeNumber: HTMLDivElement;
  holePar: HTMLDivElement;
  
  scoreContainer: HTMLDivElement;
  playerName: HTMLDivElement;
  playerScore: HTMLDivElement;
  playerScoreLabel: HTMLDivElement;

  constructor(parent: string | Element) {
    super(parent);
    this.holeHeader = document.createElement('div');
    this.holeHeader.classList.add(styles.toastHole);
    this.element.append(this.holeHeader);
    
    this.holeNumber = document.createElement('div');
    this.holeNumber.classList.add(styles.toastHoleNumber);
    this.holePar = document.createElement('div');
    this.holePar.classList.add(styles.toastHolePar);
    this.holeHeader.append(this.holeNumber, this.holePar);

    this.scoreContainer = document.createElement('div');
    this.scoreContainer.classList.add(styles.toastScoreContainer);
    this.element.append(this.scoreContainer);

    this.playerName = document.createElement('div');
    this.playerName.classList.add(styles.toastPlayerName);
    this.scoreContainer.append(this.playerName);
    
    this.playerScore = document.createElement('div');
    this.playerScore.classList.add(styles.toastPlayerScore);
    this.scoreContainer.append(this.playerScore);
    
    this.playerScoreLabel = document.createElement('div');
    this.playerScoreLabel.classList.add(styles.toastPlayerScoreLabel);
    this.scoreContainer.append(this.playerScoreLabel);
  }

  update(options: UIHoleScoreToastOptions) {
    this.holeNumber.textContent = options.hole.number ? `Hole ${options.hole.number}` : '';
    this.holePar.textContent = options.hole.par ? `Par ${options.hole.par}` : '';
    this.playerName.textContent = options.player ?? '';
    this.playerScore.textContent = options.score?.toString() ?? '';
    this.playerScoreLabel.textContent = options.label ?? '';
  }

}