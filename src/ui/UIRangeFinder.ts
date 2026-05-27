import styles from '@/css/ui.module.css';
import { UnitConversions } from '@/utils/units';

type UIRangeFinderOptions = {
  units?: OpenGolfSim.MeasurementUnits;
}

export class UIRangeFinder {
  element: Element | null;
  wrapper: HTMLElement;
  distanceValue: HTMLElement;
  distanceUnit: HTMLElement;
  heightValue: HTMLElement;
  heightUnit: HTMLElement;
  units: OpenGolfSim.MeasurementUnits;

  constructor(element: string | Element, options: UIRangeFinderOptions = {}) {
    if (typeof element === 'string') {
      this.element = document.querySelector(element);
    } else {
      this.element = element;
    }
    if (!this.element) {
      throw new Error('Unable to find UIRangeFinder root element');
    }    
    this.element.className = styles.rangeFinder;

    this.units = options.units ?? 'metric';
    this.wrapper = document.createElement('div');
    this.heightValue = document.createElement('div');
    this.heightUnit = document.createElement('div');
    this.distanceValue = document.createElement('div');
    this.distanceUnit = document.createElement('div');

    this._build();
  }

  _build() {
    if (!this.element) {
      console.error('Unable to find UIPlayerMenu root element');
      return;
    }    
    if (this.wrapper) {
      this.wrapper.remove();
    }
    this.wrapper.setAttribute('id', 'ui-rangefinder');
    this.wrapper.className = styles.rangeFinderContainer;
    this.element.append(this.wrapper);

    const distanceLine = document.createElement('div');
    distanceLine.className = styles.rangeFinderCol;
    this.wrapper.append(distanceLine);

    this.distanceValue.className = styles.rangeFinderValue;
    this.distanceValue.textContent = '120';
    
    this.distanceUnit.className = styles.rangeFinderUnit;
    this.distanceUnit.textContent = this.units === 'imperial' ? 'YD' : 'm';

    distanceLine.append(this.distanceValue, this.distanceUnit);
    const heightLine = document.createElement('div');
    heightLine.className = styles.rangeFinderCol;
    this.wrapper.append(heightLine);

    this.heightValue.className = styles.rangeFinderValue;
    this.heightValue.textContent = '5';
    
    this.heightUnit.className = styles.rangeFinderUnit;
    this.heightUnit.textContent = this.units === 'imperial' ? 'ft' : 'm';
    
    heightLine.append(this.heightValue, this.heightUnit);

  }

  update(distanceMeters: number, heightMeters: number) {
    if (this.units === 'imperial') {
      this.distanceValue.textContent = UnitConversions.metersToYards(distanceMeters).toFixed(0);
      const heightYards = UnitConversions.metersToYards(heightMeters);
      this.heightValue.textContent = heightYards >= 0.1 ? `+${heightYards.toFixed(1)}` : heightYards.toFixed(1);
      this.distanceUnit.textContent = 'YD';
      this.heightUnit.textContent = 'YD';
    } else {
      this.distanceValue.textContent = distanceMeters.toFixed(0);
      this.heightValue.textContent = heightMeters >= 0.1 ? `+${heightMeters.toFixed(1)}` : heightMeters.toFixed(1);
      this.distanceUnit.textContent = 'm';
      this.heightUnit.textContent = 'm';
    }
  }
}