import styles from '@/css/ui.module.css';

type ShotDataGridOption = {
  id: keyof OpenGolfSim.Shot | keyof OpenGolfSim.ShotResult;
  precision: number;
  label: string;
  units: string | Record<'metric' | 'imperial', string>;
  _element?: HTMLElement;
}

export type UIShotDataOptions = {
  gridOptionsEnabled?: (keyof OpenGolfSim.Shot | keyof OpenGolfSim.ShotResult)[];
}

export class UIShotData {
  element: Element;
  wrapper: HTMLElement;
  gridOptions: ShotDataGridOption[];

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
    this.gridOptions = [
      {
        id: 'ballSpeed',
        precision: 0,
        label: 'Speed',
        units: { imperial: 'MPH', metric: 'M/S' }
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
        units: { imperial: 'YD', metric: 'm' }
      },
      {
        id: 'carry',
        precision: 0,
        label: 'Carry',
        units: { imperial: 'YD', metric: 'm' }
      },
      {
        id: 'roll',
        precision: 0,
        label: 'Roll',
        units: { imperial: 'YD', metric: 'm' }
      },

      {
        id: 'apex',
        label: 'Apex',
        precision: 0,
        units: { imperial: 'FT', metric: 'm' }
      },
      {
        id: 'lateral',
        label: 'Lateral',
        precision: 0,
        units: { imperial: 'yd', metric: 'm' }
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
        const value = data[option.id];
        if (typeof value === 'undefined') return;
        const digit = option._element.querySelector('.grid-digit');
        if (digit) digit.textContent = value.toFixed(option.precision ?? 0);
        const unit = option._element.querySelector('.grid-unit');
        if (unit) unit.textContent = typeof option.units === 'string' ? option.units : option.units.imperial;
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
      unit.textContent = typeof option.units === 'string' ? option.units : option.units.imperial;
      dataValue.append(digit, unit);

      option._element.append(dataLabel, dataValue);
    });
  }
}
