export class AppBridge {
  constructor() {
    this.events = {};
    this.isReactNative = typeof window.ReactNativeWebView !== 'undefined';
    this.isElectron = typeof window.ogsElectron !== 'undefined';

    if (this.isReactNative) {
      window.addEventListener('reactNativeMessage', this.#handleReactNativeMessage.bind(this));
    } else if (this.isElectron) {
      window.ogsElectron.onMessage(this.#handleElectronMessage.bind(this));
    }
  }

  #handleReactNativeMessage(e) {
    const data = JSON.parse(e.detail);
    this.#handleEvent(data);
  }

  #handleElectronMessage(data) {
    console.log('-- message --', data);
    this.#handleEvent(data);
    // this.emit('message', data);
  }

  #handleEvent(data) {
    const { type: eventType, ...payload } = data;
    if (eventType) {
      console.log('EMIT', eventType);
      this.emit(eventType, payload);
    }
  }

  // Register a listener
  on(event, listener) {
    if (!this.events[event]) this.events[event] = [];
    this.events[event].push(listener);
  }

  // Emit an event with any number of arguments
  emit(event, ...args) {
    if (!this.events[event]) return;
    this.events[event].forEach(listener => listener(...args));
  }

  // Remove a listener
  off(event, listenerToRemove) {
    if (!this.events[event]) return;
    this.events[event] = this.events[event].filter(l => l !== listenerToRemove);
  }

  static sendMessage(payload) {
    // handle mobile apps
    if (this.isReactNative) {
      window.ReactNativeWebView.postMessage(JSON.stringify(payload));
    } else if (this.isElectron) {
      window.ogsElectron.postMessage(payload);
    } else {
      console.log(payload);
    }
  }
}

export const app = new AppBridge();