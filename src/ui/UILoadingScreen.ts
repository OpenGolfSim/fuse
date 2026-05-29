import { LoadingManager } from 'three';
import styles from '@/css/ui.module.css';
import EventEmitter from 'eventemitter3';
import { colors } from '@/utils/colors';

type UILoadingScreenOptions = {
  initText?: string;
  loadingPrefix?: string;
}
export class UILoadingScreen extends EventEmitter {
  element: HTMLElement | null;
  initText: string;
  #wrapper?: HTMLElement;
  #progressCard?: HTMLElement;
  #progressBar?: HTMLElement;
  #progressText?: HTMLElement;
  #progressBarFill?: HTMLElement;
  #delayTimeout?: number;
  manager: LoadingManager;
  loadingPrefix: string;
  error?: string;

  constructor(element: string | HTMLElement, options: UILoadingScreenOptions = {}) {
    super();

    this.loadingPrefix = options.loadingPrefix ?? 'Loading';
    this.initText = options.initText ?? 'Initializing…';

    if (typeof element === 'string') {
      this.element = document.querySelector(element);
    } else {
      this.element = element;
    }
    if (!this.element) {
      throw new Error('Unable to find UILoadingScreen root element, using document body...');
    }
    // this.element.className = styles.playerMenu;
    this.#build();
    
    this.manager = new LoadingManager();
    this.manager.onStart = () => this.#handleStart();
    this.manager.onLoad = () => this.#handleLoad();
    this.manager.onError = (url: string) => this.#handleError(url);
    this.manager.onProgress = (url, itemsLoaded, itemsTotal) => this.#handleProgress(url, itemsLoaded, itemsTotal);
  }



  // Example: Tracking a custom task (e.g., a custom API call or physics init)
  async load(asyncSetupTask: () => Promise<void>) {
    const taskId = 'asyncSetupTask';
    
    // 1. Tell the manager a new item has started loading
    this.manager.itemStart(taskId);

    try {
      await asyncSetupTask(); // Your custom Promise logic
    } catch (err) {
      this.error = `${err}`;
      console.error('task error', err);
      this.manager.itemError(taskId); // Optional: report errors to the manager
    } finally {
      // 2. Tell the manager the item is complete
      this.manager.itemEnd(taskId);
    }
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
  #handleError(url: string) {
    // this.error = 'Loading error';
    this.emit('error', url);
  }
  #handleLoad() {
    this.emit('load', this.error);
    if (this.error) {
      if (this.#progressBarFill) {
        this.#progressBarFill.style.backgroundColor = colors.red;
      }
      if (this.#progressText) {
        this.#progressText.style.color = colors.red;
        this.#progressText.textContent = `Error: ${this.error}`;
      }
      return;
    }
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
    this.#progressText.textContent = this.initText;
    this.#progressText.className = styles.progressText;

    this.#progressCard.append(this.#progressBar, this.#progressText);
    this.#wrapper.append(this.#progressCard);
    this.element.append(this.#wrapper);
  }
}