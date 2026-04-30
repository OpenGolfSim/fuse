class BridgeEventEmitter {
  constructor() {
    this.events = {};
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
}


function sendMessage(methodName, payload) {
  // handle mobile apps
  if (window.ReactNativeWebView) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ methodName, ...payload }));
  } else if (typeof window.ogsWebGL?.[methodName] === 'function') {
    window.ogsWebGL[methodName](payload);
  } else {
    console.log(payload);
  }
}

export function exitGame() {
  sendMessage({ type: 'exit' });
}