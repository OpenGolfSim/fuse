import styles from '@/css/ui.module.css';

type UIStatsOptions = {
  hidden?: boolean;
}

export class UIStatsPanel {
  dom: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  min: number;
  max: number;
  fg: string;
  bg: string;
  name: string;
  pixelRatio: number;
  width: number;
  height: number;
  #text_x: number;
  #text_y: number;
  #graph: {
    width: number;
    height: number;
    x: number;
    y: number;
  };

  constructor(name: string, fg: string, bg: string) {
    this.min = Infinity;
    this.max = 0;
    this.name = name;
    this.fg = fg;
    this.bg = bg;

    this.pixelRatio = Math.round( window.devicePixelRatio || 1 );

    this.width = 80 * this.pixelRatio;
    this.height = 48 * this.pixelRatio;
    this.#text_x = 3 * this.pixelRatio;
    this.#text_y = 2 * this.pixelRatio;
    this.#graph = {
      x: 3 * this.pixelRatio,
      y: 15 * this.pixelRatio,
      width: 74 * this.pixelRatio,
      height: 30 * this.pixelRatio
    };

    this.dom = document.createElement( 'canvas' );
    this.dom.width = this.width;
    this.dom.height = this.height;
    this.dom.style.cssText = 'width:80px;height:48px';

    const ctx = this.dom.getContext( '2d' );
    if (!ctx) {
      throw new Error('Unable to create context');
    }
    this.context = ctx;
    this.context.font = 'bold ' + ( 9 * this.pixelRatio ) + 'px Helvetica,Arial,sans-serif';
    this.context.textBaseline = 'top';

    this.context.fillStyle = bg;
    this.context.fillRect(0, 0, this.width, this.height);

    this.context.fillStyle = fg;
    this.context.fillText( name, this.#text_x, this.#text_y );
    this.context.fillRect( this.#graph.x, this.#graph.y, this.#graph.width, this.#graph.height);

    this.context.fillStyle = bg;
    this.context.globalAlpha = 0.9;
    this.context.fillRect( this.#graph.x, this.#graph.y, this.#graph.width, this.#graph.height);
  }


	update(value: number, maxValue: number) {

    this.min = Math.min( this.min, value );
    this.max = Math.max( this.max, value );

    this.context.fillStyle = this.bg;
    this.context.globalAlpha = 1;
    this.context.fillRect( 0, 0, this.width, this.#graph.y);
    this.context.fillStyle = this.fg;

    this.context.fillText(
      Math.round( value ) + ' ' + this.name + ' (' + Math.round( this.min ) + '-' + Math.round( this.max ) + ')',
      this.#text_x,
      this.#text_y
    );

    this.context.drawImage(
      this.dom,
      this.#graph.x + this.pixelRatio,
      this.#graph.y,
      this.#graph.width - this.pixelRatio,
      this.#graph.height,
      this.#graph.x,
      this.#graph.y,
      this.#graph.width - this.pixelRatio,
      this.#graph.height
    );

    this.context.fillRect(this.#graph.x + this.#graph.width - this.pixelRatio, this.#graph.y, this.pixelRatio, this.#graph.height);

    this.context.fillStyle = this.bg;
    this.context.globalAlpha = 0.9;
    this.context.fillRect( this.#graph.x + this.#graph.width - this.pixelRatio, this.#graph.y, this.pixelRatio, Math.round( ( 1 - ( value / maxValue ) ) * this.#graph.height ) );


	}

}

export class UIStats {
  // stats: ThreeStats;
  element: HTMLElement | null;
  container: HTMLElement;
  mode = 0;
  msPanel: UIStatsPanel;
  fpsPanel: UIStatsPanel;
  #beginTime = 0;
  #prevTime = 0;
  #frames = 0;

  constructor(element: string | HTMLElement, options: UIStatsOptions = {}) {
    if (typeof element === 'string') {
      this.element = document.querySelector(element);
    } else {
      this.element = element;
    }
    if (!this.element) {
      throw new Error('Unable to find UIRangeFinder root element');
    }    
    this.element.className = styles.uiStats;

    this.container = document.createElement('div');
    // this.container.style.cssText = 'position:fixed;top:0;left:0;cursor:pointer;opacity:0.9;z-index:10000';
	  this.container.addEventListener('click', (event) => this.#handleClick(event), false);
    Object.assign(this.container.style, {
      position: 'fixed',
      width: '80px',
      height: '48px',
      bottom: '10px',
      right: '10px',
      zIndex: '9999'
    });
    // this.stats = new ThreeStats();
    // this.stats.dom.style.cssText = `position: relative;`;
    // this.container.append(this.stats.dom);
    // this.stats.dom.style.display = options.hidden ? 'none' : 'block';
    
    this.container.style.display = options.hidden ? 'none' : 'block';
    this.container.style.display = options.hidden ? 'none' : 'block';

    this.element.append(this.container);
    this.begin();
    this.#prevTime = this.#beginTime;

    this.fpsPanel = new UIStatsPanel( 'FPS', '#21d48d', '#111c1c' );
    this.container.append(this.fpsPanel.dom);
    this.msPanel = new UIStatsPanel( 'MS', 'rgb(255, 8, 0)', 'rgb(34, 11, 0)' );
    this.container.append(this.msPanel.dom);
    this.showPanel(0);
  }
  toggle() {
    const hidden = this.container.style.display === 'none';
    this.container.style.display = hidden ? 'block' : 'none';
  }

  begin() {
		this.#beginTime = ( performance || Date ).now();
    // return this.stats.begin();
  }

  end(): number {
    this.#frames++;
    let time = ( performance || Date ).now();

    this.msPanel.update( time - this.#beginTime, 200 );

    if ( time >= this.#prevTime + 1000 ) {

      this.fpsPanel.update( ( this.#frames * 1000 ) / ( time - this.#prevTime ), 100 );

      this.#prevTime = time;
      this.#frames = 0;

      // if ( this.memPanel ) {
      //   var memory = performance.memory;
      //   memPanel.update( memory.usedJSHeapSize / 1048576, memory.jsHeapSizeLimit / 1048576 );
      // }

    }

    return time;
    // return this.stats.end();
  }

  update() {
	  this.#beginTime = this.end();
  }
  
  #handleClick(event: PointerEvent) {
    event.preventDefault();
    this.showPanel( ++ this.mode % this.container.children.length );
  }
  
	showPanel(id: number) {
		const panels = [this.fpsPanel, this.msPanel];
    for ( var i = 0; i < panels.length; i ++ ) {
			panels[i].dom.style.display = i === id ? 'block' : 'none';
		}
		this.mode = id;
	}
};

