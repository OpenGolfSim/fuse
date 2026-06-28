import { CourseHole, CourseHoleMap } from '@/courses/loader';
import { CoursePlayer } from '@/courses/player';
import styles from '@/css/ui.module.css';
import { UIDialog } from '@/ui/UIDialog';


type UIScorecardOptions = {
  holes: CourseHoleMap;
  players: CoursePlayer[];
};

export class UIScorecard extends UIDialog {
  holes?: Element;
  pars?: Element;
  holeData?: CourseHoleMap;
  players: CoursePlayer[];
  playerContainer?: Element;
  roundOverContainer?: Element;
  frontNine?: Element;
  backNine?: Element;

  constructor(parent: string | Element, options: UIScorecardOptions) {
    super(parent, { title: 'Scorecard' });
    this.players = options.players;
    this.holeData = options.holes;
    this.#build();
    this.updateScores();
    // this.open();
  }

  updateScores() {
    if (!this.playerContainer) {
      return;
    }

    this.playerContainer.innerHTML = '';
    
    const rows = this.players.map(player => {
      const playerRow = document.createElement('div');
      const playerName = document.createElement('div');
      playerName.textContent = player.name;
      playerRow.append(playerName);
      let outCount = 0;
      let totalCount = 0;
      for (let i = 1; i < 10; i++) {
        const hole = document.createElement('div');
        const score = player.scorecard.get(`${i}`);
        hole.textContent = score?.toString() || '-';
        playerRow.append(hole);
        playerRow.classList.add(styles.playerRow);
        if (score) {
          outCount += score;
          totalCount += score;
        }
      } 
      const outScore = document.createElement('div');
      outScore.textContent = outCount.toString();
      playerRow.append(outScore);

      let inCount = 0;
      for (let i = 10; i < 19; i++) {
        const hole = document.createElement('div');
        const score = player.scorecard.get(`${i}`);
        hole.textContent = score?.toString() || '-';
        playerRow.append(hole);
        playerRow.classList.add(styles.playerRow);
        if (score) {
          inCount += score;
          totalCount += score;
        }
      }
      const inScore = document.createElement('div');
      inScore.textContent = inCount.toString();
      playerRow.append(inScore);
      
      const totalScore = document.createElement('div');
      totalScore.textContent = totalCount.toString();
      playerRow.append(totalScore);

      return playerRow;
    });
    this.playerContainer.append(...rows);
  
    // this.playerContainer.classList.add(styles.holesRow);
    
  }

  open(roundOver = false) {
    this.updateScores();
    if (roundOver) {

    }
    super.open();
  }

  #build() {
    this.holes = document.createElement('div');
    this.holes.classList.add(styles.holesRow);
    this.content.append(this.holes);

    // list par for each hole
    this.pars = document.createElement('div');
    this.pars.classList.add(styles.holesRow, styles.parRow);
    this.content.append(this.pars);
    
    
    const nameSpace = document.createElement('div');
    nameSpace.textContent = 'Hole';
    this.holes.append(nameSpace);
    
    const parLabel = document.createElement('div');
    parLabel.textContent = 'Par';
    this.pars.append(parLabel);
    
    let parCount = 0;
    let parTotal = 0;

    // this.frontNine = document.createElement('div');
    // this.frontNine.classList.add(styles.nineHoles)
    for (let i = 1; i < 10; i++) {
      const holeNum = `${i}`;
      const hole = document.createElement('div');
      hole.textContent = holeNum;
      this.holes.append(hole);
      
      const par = document.createElement('div');
      const parNumber = this.holeData?.get(i)?.par || 0;
      parCount += parNumber;
      parTotal += parNumber;
      par.textContent = parNumber?.toString() ?? '-';
      this.pars.append(par);
    }
    // this.holes.append(this.frontNine)

    const outScore = document.createElement('div');
    outScore.textContent = 'OUT';
    this.holes.append(outScore);
    
    const outPar = document.createElement('div');
    outPar.textContent = parCount.toString();
    this.pars.append(outPar);
    // this.frontNine.append(outScore);

    
    // this.backNine = document.createElement('div');
    // this.backNine.classList.add(styles.nineHoles)
    parCount = 0;
    for (let i = 10; i < 19; i++) {
      const holeNum = `${i}`;
      const hole = document.createElement('div');
      hole.textContent = holeNum;
      this.holes.append(hole);

      const par = document.createElement('div');
      const parNumber = this.holeData?.get(i)?.par || 0;
      parCount += parNumber;
      parTotal += parNumber;
      par.textContent = this.holeData?.get(i)?.par?.toString() ?? '-';
      this.pars.append(par);
    }
    const inScore = document.createElement('div');
    inScore.textContent = 'IN';
    this.holes.append(inScore);
    
    const inPar = document.createElement('div');
    inPar.textContent = parCount.toString();
    this.pars.append(inPar);

    const totalScore = document.createElement('div');
    totalScore.textContent = 'TOT';
    this.holes.append(totalScore);
    
    
    const totalPar = document.createElement('div');
    totalPar.textContent = parTotal.toString();
    this.pars.append(totalPar);

    


    this.playerContainer = document.createElement('div');
    this.playerContainer.classList.add(styles.playerContainer)
    this.content.append(this.playerContainer);
    
    
    this.roundOverContainer = document.createElement('div');
    this.roundOverContainer.classList.add(styles.scoreCardRoundOver);
    this.content.append(this.roundOverContainer);

  }
}
