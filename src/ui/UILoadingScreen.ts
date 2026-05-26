import { LoadingManager } from 'three';
import styles from '@/css/ui.module.css';
import EventEmitter from 'eventemitter3';

type UILoadingScreenOptions = {
  loadingPrefix?: string;
}
export class UILoadingScreen extends EventEmitter {
  element: HTMLElement | null;
  #wrapper?: HTMLElement;
  #progressCard?: HTMLElement;
  #progressBar?: HTMLElement;
  #progressText?: HTMLElement;
  #progressBarFill?: HTMLElement;
  #delayTimeout?: number;
  manager: LoadingManager;
  loadingPrefix: string;

  constructor(element: string | HTMLElement, options: UILoadingScreenOptions = {}) {
    super();

    this.loadingPrefix = options.loadingPrefix ?? 'Loading';

    if (typeof element === 'string') {
      this.element = document.querySelector(element);
    } else {
      this.element = element;
    }
    if (!this.element) {
      console.warn('Unable to find UILoadingScreen root element, using document body...');
      this.element = document.body;
    }    
    // this.element.className = styles.playerMenu;
    this.#build();
    
    this.manager = new LoadingManager();
    this.manager.onStart = () => this.#handleStart();
    this.manager.onLoad = () => this.#handleLoad();
    this.manager.onProgress = (url, itemsLoaded, itemsTotal) => this.#handleProgress(url, itemsLoaded, itemsTotal);
  }

  #handleProgress(url: string, itemsLoaded: number, itemsTotal: number) {
    const percent = (itemsLoaded / itemsTotal) * 100;
    if (this.#progressBarFill) {
      this.#progressBarFill.style.width = `${percent}%`;
    }
    if (this.#progressText) {
      this.#progressText.textContent = `${this.loadingPrefix} ${percent.toFixed(0)}%`;
      // this.#progressText.textContent = (new URL(url)).pathname.split('/').pop() || 'Loading';
    }
    this.emit('progress', { percent, itemsLoaded, itemsTotal })
  }

  #handleStart() {
    if (this.#wrapper) {
      this.#wrapper.style.opacity = '1';
      this.#wrapper.style.display = 'flex';
    }
    this.emit('start');
  }
  #handleLoad() {
    this.emit('load');
    clearTimeout(this.#delayTimeout);
    this.#delayTimeout = setTimeout(() => this.#fadeOut(), 1000);
  }
  #fadeOut() {
    if (this.#wrapper) {
      this.#wrapper.style.opacity = '0';
      this.#wrapper.addEventListener('transitionend', () => {
        if (this.#wrapper) this.#wrapper.style.display = 'none';
      });
    }
  }
  #build() {
    if (!this.element) {
      console.error('Unable to find UIPlayerMenu root element');
      return;
    }
    if (this.#wrapper) {
      this.#wrapper.remove();
    }
    this.#wrapper = document.createElement('div');
    this.#wrapper.setAttribute('id', 'ui-loading-screen');
    this.#wrapper.className = styles.loadingScreen;
    
    this.#progressCard = document.createElement('div');
    this.#progressCard.className = styles.progressCard;

    this.#progressBar = document.createElement('div');
    this.#progressBar.className = styles.progressBar;
    
    this.#progressBarFill = document.createElement('div');
    this.#progressBarFill.style.width = '1%';
    this.#progressBarFill.className = styles.progressBarFill;
    this.#progressBar.append(this.#progressBarFill);
    
    this.#progressText = document.createElement('div');
    this.#progressText.textContent = 'Loading...';
    this.#progressText.className = styles.progressText;

    this.#progressCard.append(this.#progressBar, this.#progressText);
    this.#wrapper.append(this.#progressCard);
    this.element.append(this.#wrapper);
  }
}