import Sortable from 'sortablejs';
import styles from '@/css/ui.module.css';
import { UnitConversions } from '@/utils/units';

type ShotDataGridOption = {
  id: keyof OpenGolfSim.Shot | keyof OpenGolfSim.ShotResult;
  precision: number;
  label: string;
  units: string;
  _element?: HTMLElement;
  conversion?: (val: number) => number;
}

export type UIShotDataOptions = {
  gridOptionsEnabled?: (keyof OpenGolfSim.Shot | keyof OpenGolfSim.ShotResult)[];
  units?: OpenGolfSim.SetupData['units'];
}

export class UIShotData {
  element: Element;
  wrapper: HTMLElement;
  gridOptions: ShotDataGridOption[];
  units: OpenGolfSim.SetupData['units'];
  #sortable?: Sortable;
  #speedUnit: string;
  #distanceUnit: string;
  #heightUnit: string;

  constructor(element: string | Element, options: UIShotDataOptions = {}) {
    if (typeof element === 'string') {
      const e = document.querySelector(element);
      if (!e) {
        throw new Error('Unable to find UIShotData root element');
      }
      this.element = e;
    } else {
      this.element = element;
    }
    if (!this.element) {
      throw new Error('Unable to find UIShotData root element');
    }

    this.units = options.units ?? 'metric';

    this.#speedUnit = this.units === 'imperial' ? 'MPH' : 'm/s';
    this.#distanceUnit = this.units === 'imperial' ? 'YD' : 'm';
    this.#heightUnit = this.units === 'imperial' ? 'FT' : 'm';

    this.gridOptions = [
      {
        id: 'ballSpeed',
        precision: 0,
        label: 'Speed',
        // default value is in MPH
        conversion: (val) => this.units === 'metric' ? UnitConversions.milesPerHourToMetersPerSecond(val) : val,
        units: this.#speedUnit
      },
      {
        id: 'verticalLaunchAngle',
        label: 'VLA',
        precision: 1,
        units: '°'
      },
      {
        id: 'horizontalLaunchAngle',
        label: 'HLA',
        precision: 1,
        units: '°'
      },
      {
        id: 'spinSpeed',
        label: 'Spin Rate',
        precision: 0,
        units: 'RPM'
      },
      {
        id: 'spinAxis',
        precision: 0,
        label: 'Spin Axis',
        units: '°'
      },
      {
        id: 'total',
        precision: 0,
        label: 'Total',
        units: this.#distanceUnit,
        conversion: (val) => this.units === 'imperial' ? UnitConversions.metersToYards(val) : val,
      },
      {
        id: 'carry',
        precision: 0,
        label: 'Carry',
        units: this.#distanceUnit,
        conversion: (val) => this.units === 'imperial' ? UnitConversions.metersToYards(val) : val,
      },
      {
        id: 'roll',
        precision: 0,
        label: 'Roll',
        units: this.#distanceUnit,
        conversion: (val) => this.units === 'imperial' ? UnitConversions.metersToYards(val) : val,
      },

      {
        id: 'apex',
        label: 'Apex',
        precision: 0,
        units: this.#heightUnit,
        conversion: (val) => this.units === 'imperial' ? UnitConversions.metersToFeet(val) : val,
      },
      {
        id: 'lateral',
        label: 'Lateral',
        precision: 0,
        units: this.#distanceUnit,
        conversion: (val) => this.units === 'imperial' ? UnitConversions.metersToYards(val) : val,
      },
    ];
    
    if (options.gridOptionsEnabled?.length) {
      this.gridOptions = this.gridOptions.filter((item: ShotDataGridOption) => options.gridOptionsEnabled?.includes(item.id));
    }

    this.element.className = styles.shotData;
    this.wrapper = document.createElement('div');

    this._build();
  }

  updateShotData(shotData: OpenGolfSim.Shot) {
    this.#updateGrid(shotData);
  }

  updateShotResult(shotResult: OpenGolfSim.ShotResult) {
    this.#updateGrid(shotResult);
  }

  #updateGrid(data: Partial<OpenGolfSim.Shot & OpenGolfSim.ShotResult>) {
    this.gridOptions.forEach(option => {
      if (option._element) {
        let value = data[option.id];
        if (typeof value === 'undefined') return;
        const digit = option._element.querySelector('.grid-digit');
        if (typeof option.conversion === 'function') {
          value = option.conversion(value);
        }
        if (digit) digit.textContent = value.toFixed(option.precision ?? 0);
        const unit = option._element.querySelector('.grid-unit');
        if (unit) unit.textContent = option.units;
      }
    });
  }

  _build() {
    if (this.wrapper) {
      this.wrapper.remove();
    }
    this.wrapper.setAttribute('id', 'ui-shot-data');
    this.wrapper.className = styles.shotDataContainer;
    this.element.append(this.wrapper);

    this.gridOptions.forEach(option => {
      option._element = document.createElement('div');
      option._element.setAttribute('id', `ui-shot-data-${option.id}`);
      option._element.className = styles.shotDataItem;
      this.wrapper.append(option._element);

      const dataLabel = document.createElement('div');
      dataLabel.classList.add(styles.shotDataItemLabel, 'data-label');
      // dataLabel.className = styles.shotDataItemLabel;
      dataLabel.textContent = option.label;
    
      const dataValue = document.createElement('div');
      dataValue.classList.add(styles.shotDataItemValue);
      // dataValue.className = styles.shotDataItemValue;
    
      const digit = document.createElement('div');
      digit.classList.add(styles.shotDataItemDigit, 'grid-digit');
      // digit.className = styles.shotDataItemDigit;
      digit.textContent = '0';
    
      const unit = document.createElement('div');
      unit.classList.add(styles.shotDataItemUnit, 'grid-unit');
      // unit.className = styles.shotDataItemUnit;
      // TODO: change to metric based on user pref!
      unit.textContent = option.units;
      dataValue.append(digit, unit);

      option._element.append(dataLabel, dataValue);
    });

    this.#sortable = new Sortable(this.wrapper, {
      group: 'data-panel',
      sort: true,
      animation: 200,
      store: {
        get: (sortable) => {
          const order = localStorage.getItem('ogs-fuse-shotDataPanel');
          return order ? order.split('|') : [];
        },
        set: (sortable) => {
          const order = sortable.toArray();
          localStorage.setItem('ogs-fuse-shotDataPanel', order.join('|'));
        }
      }

    });

  }
}
