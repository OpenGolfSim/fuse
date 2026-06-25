import { QualityMode } from "./quality";

export const DefaultGimmeDistances = [2, 4, 80];

function getDeviceType() {
  const ua = navigator.userAgent;

  // 1. Check modern User-Agent Client Hints API (Chromium-based browsers)
  // @ts-expect-error
  if (navigator.userAgentData) {
    // @ts-expect-error
    return navigator.userAgentData.mobile ? 'mobile' : 'desktop';
  }

  // 2. Check for Mobile keywords in the legacy User-Agent string
  if (/Mobi|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)) {
    return 'mobile';
  }

  // 3. Handle modern iPads/tablets pretending to be Desktops (Touch + no 'Mobi')
  // iPads running desktop Safari support multi-touch points but lack "Mobi" in UA.
  if (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua)) {
    return 'mobile'; // Handled as tablet/mobile
  }

  // 4. Default fallback to Desktop
  return 'desktop';
}


/**
 * Generates setup data for testing
 */
export function generateSetupData(playerCount: number = 1, override: Partial<OpenGolfSim.SetupData> = {}): OpenGolfSim.SetupData {
  const clubs = [
    { fullName: 'Driver', name: 'DR', id: 'DR', distance: 228 },
    { fullName: '5 Iron', name: '5i', id: '5I', distance: 150 },
    { fullName: 'Pitching Wedge', name: 'PW', id: 'PW', distance: 100 },
    { fullName: 'Sand Wedge', name: 'SW', id: 'SW', distance: 50 },
    { fullName: 'Putter', name: 'P', id: 'PT', distance: 0 }
  ];
  const players = [];
  for (let i=0; i < playerCount; i++) {
    players.push({
      name: `Player #${i + 1}`,
      id: `player-${i + 1}`,
      clubs: [...clubs]
    });
  }

  let qualityLevel = QualityMode.Low;
  
  console.log('Detected device', getDeviceType());

  if (getDeviceType() === 'desktop') {
    qualityLevel = QualityMode.Medium;
  }

  return {
    units: 'imperial',
    players,
    cameraOffset: 0,
    practiceMode: false,
    qualityLevel,
    // puttingEnabled: false,
    // gimmesEnabled: true,
    gimmeDistances: [...DefaultGimmeDistances],
    elevation: 0,
    // gameMode: 2,
    ...override
  }
}
