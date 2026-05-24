import styles from '@/css/ui.module.css';
import { UnitConversions } from '@/utils/units';

export class UIRangeFinder {
  element: Element | null;
  wrapper: HTMLElement;
  distanceValue: HTMLElement;
  distanceUnit: HTMLElement;
  heightValue: HTMLElement;
  heightUnit: HTMLElement;


  constructor(element: string | Element) {
    if (typeof element === 'string') {
      this.element = document.querySelector(element);
    } else {
      this.element = element;
    }
    if (!this.element) {
      throw new Error('Unable to find UIRangeFinder root element');
    }    
    this.element.className = styles.rangeFinder;

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
    distanceLine.className = styles.rangeFinderDistance;
    this.wrapper.append(distanceLine);

    this.distanceValue.className = styles.rangeFinderDistanceValue;
    this.distanceValue.textContent = '120';
    
    this.distanceUnit.className = styles.rangeFinderDistanceUnit;
    this.distanceUnit.textContent = 'yds';

    distanceLine.append(this.distanceValue, this.distanceUnit);
    const heightLine = document.createElement('div');
    heightLine.className = styles.rangeFinderDistance;
    this.wrapper.append(heightLine);

    this.heightValue.className = styles.rangeFinderHeightValue;
    this.heightValue.textContent = '5';
    
    this.heightUnit.className = styles.rangeFinderDistanceUnit;
    this.heightUnit.textContent = 'ft';
    
    heightLine.append(this.heightValue, this.heightUnit);

  }

  update(distanceMeters: number, heightMeters: number, units = 'imperial') {
    if (units === 'imperial') {
      this.distanceValue.textContent = UnitConversions.metersToYards(distanceMeters).toFixed(0);
      this.heightValue.textContent = UnitConversions.metersToFeet(heightMeters).toFixed(1);
      this.distanceUnit.textContent = 'yd';
      this.heightUnit.textContent = 'ft';
    } else {
      this.distanceValue.textContent = distanceMeters.toFixed(0);
      this.heightValue.textContent = heightMeters.toFixed(1);
      this.distanceUnit.textContent = 'm';
      this.heightUnit.textContent = 'm';
    }
  }
}