import styles from './css/ui.module.css';

const METERS_TO_FEET = 3.28084;
const METERS_TO_YARDS = 1.09361;

export function setupDefaultUI(rootEle, options = {}) {
  rootEle.className = styles.uiRoot;
  
  const menuArea = document.createElement('div');
  menuArea.className = styles.menuArea;

  const button = document.createElement('button');
  button.textContent = 'EXIT';
  button.className = styles.button;
  button.addEventListener('click', (e) => {
    window.OGS.bridge.exitGame();
  });
  menuArea.appendChild(button);

  rootEle.appendChild(menuArea);
}

export class UIRangeFinder{
  constructor(element) {
    if (typeof element === 'string') {
      this.element = document.querySelector(element);
    } else {
      this.element = element;
    }
    if (!this.element) {
      console.error('Unable to find UIShotData root element');
      return;
    }
    this.element.className = styles.rangeFinder;
    this._build();
  }

  _build() {
    if (this.wrapper) {
      this.wrapper.remove();
    }
    this.wrapper = document.createElement('div');
    this.wrapper.setAttribute('id', 'ui-rangefinder');
    this.wrapper.className = styles.rangeFinderContainer;
    this.element.append(this.wrapper);

    const distanceLine = document.createElement('div');
    distanceLine.className = styles.rangeFinderDistance;
    this.wrapper.append(distanceLine);

    this.distanceValue = document.createElement('div');
    this.distanceValue.className = styles.rangeFinderDistanceValue;
    this.distanceValue.textContent = '120';
    
    this.distanceUnit = document.createElement('div');
    this.distanceUnit.className = styles.rangeFinderDistanceUnit;
    this.distanceUnit.textContent = 'yds';

    distanceLine.append(this.distanceValue, this.distanceUnit);
    const heightLine = document.createElement('div');
    heightLine.className = styles.rangeFinderDistance;
    this.wrapper.append(heightLine);

    this.heightValue = document.createElement('div');
    this.heightValue.className = styles.rangeFinderHeightValue;
    this.heightValue.textContent = '5';
    
    this.heightUnit = document.createElement('div');
    this.heightUnit.className = styles.rangeFinderDistanceUnit;
    this.heightUnit.textContent = 'ft';
    
    heightLine.append(this.heightValue, this.heightUnit);

  }

  update(distanceMeters, heightMeters, units = 'imperial') {
    if (units === 'imperial') {
      this.distanceValue.textContent = (distanceMeters * METERS_TO_YARDS).toFixed(0);
      this.heightValue.textContent = (heightMeters * METERS_TO_FEET).toFixed(1);
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
export class UIShotData {
  constructor(element) {
    this.gridOptions = [
      {
        id: 'ballSpeed',
        precision: 0,
        label: 'Ball Speed',
        units: ['MPH', 'm/s']
      },
      {
        id: 'verticalLaunchAngle',
        label: 'VLA',
        precision: 1,
        units: ['°']
      },
      {
        id: 'horizontalLaunchAngle',
        label: 'HLA',
        precision: 1,
        units: ['°']
      },
      {
        id: 'spinSpeed',
        label: 'Total Spin',
        precision: 0,
        units: ['RPM']
      },
      {
        id: 'spinAxis',
        label: 'Spin Axis',
        units: ['°']
      },
      {
        id: 'total',
        label: 'Total',
        units: ['yd', 'm']
      },
      {
        id: 'carry',
        label: 'Carry',
        units: ['yd', 'm']
      },
      {
        id: 'roll',
        label: 'Roll',
        units: ['yd', 'm']
      },

      {
        id: 'apex',
        label: 'Apex',
        units: ['ft', 'm']
      },
      // {
      //   id: 'carryRaw',
      //   label: 'Carry (Raw)',
      //   units: ['yd', 'm']
      // },
      {
        id: 'lateral',
        label: 'Lateral',
        units: ['yd', 'm']
      },
      
    ];

    if (typeof element === 'string') {
      this.element = document.querySelector(element);
    } else {
      this.element = element;
    }
    if (!this.element) {
      console.error('Unable to find UIShotData root element');
      return;
    }
    this.element.className = styles.shotData;

    this._build();
  }

  updateShotData(shotData = {}) {
    this.gridOptions.forEach(option => {
      if (shotData?.[option.id]) {
        option._digit.textContent = shotData[option.id].toFixed(option.precision ?? 0);
        option._unit.textContent = option.units[0];
      }
    });
  }
  updateShotResult(shotResult = {}) {
    this.gridOptions.forEach(option => {
      if (shotResult?.[option.id]) {
        option._digit.textContent = shotResult[option.id].toFixed(option.precision ?? 0);
        option._unit.textContent = option.units[0];
      }
    });
  }

  _build() {
    if (this.wrapper) {
      this.wrapper.remove();
    }
    this.wrapper = document.createElement('div');
    this.wrapper.setAttribute('id', 'ui-shot-data');
    this.wrapper.className = styles.shotDataContainer;
    this.element.append(this.wrapper);

    this.gridOptions.forEach(option => {
      option._element = document.createElement('div');
      option._element.setAttribute('id', `ui-shot-data-${option.id}`);
      option._element.className = styles.shotDataItem;
      this.wrapper.append(option._element);

      const dataLabel = document.createElement('div');
      dataLabel.className = styles.shotDataItemLabel;
      dataLabel.textContent = option.label;
    
      const dataValue = document.createElement('div');
      dataValue.className = styles.shotDataItemValue;
    
    
      option._digit = document.createElement('span');
      option._digit.className = styles.shotDataItemDigit;
      option._digit.textContent = '0';
    
      option._unit = document.createElement('span');
      option._unit.className = styles.shotDataItemUnit;
      option._unit.textContent = option.units[0];
      dataValue.append(option._digit, option._unit);

      option._element.append(dataLabel, dataValue);
    });
  }
}
export function setupShotData(element, options = {}) {
  const dataGrid = document.createElement('div');
  

  dataItems.forEach(item => {
  });

  
{/* <div class="shot-data-item">
  <div class="shot-data-item-label">CARRY</div>
  <div class="shot-data-item-value">
    <span class="digit" id="shot-carry">-</span>
    <span class="unit">yds</span>
  </div>
</div>   */}
}