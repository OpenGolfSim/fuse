import EventEmitter from 'eventemitter3';

export class UIElementBase<TEvents extends object = {}> extends EventEmitter<TEvents> {
  parent: Element;
  element: Element;
  constructor(parentElement: string | Element) {
    super();
    if (typeof parentElement === 'string') {
      const match = document.querySelector(parentElement);
      if (!match) {
        throw new Error('Unable to find UIPlayerMenu root element');
      }
      this.parent = match;
    } else if (parentElement instanceof Element) {
      this.parent = parentElement;
    } else {
      throw new Error('Unable to find UIPlayerMenu root element');
    }
    this.element = document.createElement('div');
    this.parent.append(this.element);
  }
}