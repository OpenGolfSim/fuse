import styles from '@/css/ui.module.css';
import { UIElementBase } from './UIElementBase';
import { UIDropDownMenu, type UIDropDownMenuItem } from './UIDropDownMenu';
import { app } from '..';

interface UILaunchMonitorEvents {
  help: () => void;
  settings: () => void;
  exit: () => void;
}

export class UILaunchMonitor extends UIElementBase<UILaunchMonitorEvents> {
  dropdown: UIDropDownMenu;
  link: Element;
  header: Element;
  status: Element;
  statusText: Element;

  constructor(parent: string | Element) {
    super(parent);
    this.link = document.createElement('a');
    this.element.append(this.link);

    this.header = document.createElement('div');
    this.header.className = styles.launchMonitorMenuHeader;
    
    const headerText = document.createElement('div');
    headerText.textContent = 'LM Status';
    headerText.className = styles.launchMonitorMenuHeaderText;
    this.header.append(headerText);

    this.statusText = document.createElement('div');
    this.statusText.textContent = 'Initializing';
    this.statusText.className = styles.launchMonitorMenuStatusText;
    
    this.status = document.createElement('div');
    this.status.className = styles.launchMonitorMenuStatus;
    this.link.append(this.status, this.header, this.statusText);
    
    this.element.className = styles.launchMonitorMenu;
    // if (app.appType === 'web') {
    //   // @ts-expect-error
    //   this.element.style.display = 'none';
    // }
 
    const menuItems: UIDropDownMenuItem[] = [
      {
        label: 'Restart Connector',
        disabled: app.appType === 'web',
        id: 'lm.restart',
        action: () => {
          app.sendMessage({ type: 'lm.restart' });
        }
      },
      // {
      //   label: 'View Logs',
      //   id: 'lm.logs',
      //   disabled: app.appType === 'web',
      //   action: () => {
      //     app.sendMessage({ type: 'lm.logs' });
      //   }
      // }
    ];

    this.dropdown = new UIDropDownMenu({
      anchor: this.link, 
      placement: 'bottom-start',
      menuItems
    });


    app.on('status', statusData => {
      console.log('received status update', statusData);
      this.setStatus(statusData.isReady ? 'ready' : (statusData.isConnected ? 'connected' : 'disconnected'));
    });
    
  }

  setStatus(status: 'connected' | 'disconnected' | 'ready') {
    this.status.classList.remove(...[
      styles.launchMonitorMenuStatusConnected,
      styles.launchMonitorMenuStatusDisconnected,
      styles.launchMonitorMenuStatusReady,
    ]);
    if (status === 'connected') {
      this.status.classList.add(styles.launchMonitorMenuStatusConnected);
    } else if (status === 'disconnected') {
      this.status.classList.add(styles.launchMonitorMenuStatusDisconnected);
    } else if (status === 'ready') {
      this.status.classList.add(styles.launchMonitorMenuStatusReady);
    }
    console.log('this.status.classList', this.status.classList);
    this.statusText.textContent = status;
  }
}