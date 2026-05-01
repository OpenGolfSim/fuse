import styles from './css/ui.module.css';

export function setupDefaultUI(rootEle, options = {}) {
  rootEle.className = styles.uiRoot;
  
  const menuArea = document.createElement('div');
  menuArea.className = styles.menuArea;

  const button = document.createElement('button');
  button.textContent = 'EXIT';
  button.className = styles.button;
  button.addEventListener('click', (e) => {
    window.OGS.bridge.exitGame();
  });
  menuArea.appendChild(button);

  rootEle.appendChild(menuArea);
}