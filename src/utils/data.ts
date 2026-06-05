import { QualityMode } from "./constants";

/**
 * Generates setup data for testing
 */
export function generateSetupData(playerCount: number = 1, override: Partial<OpenGolfSim.SetupData> = {}): OpenGolfSim.SetupData {
  const clubs = [
    { fullName: 'Driver', name: 'DR', id: 'DR', distance: 180 },
    { fullName: '5 Iron', name: '5i', id: '5I', distance: 150 },
    { fullName: 'Pitching Wedge', name: 'PW', id: 'PW', distance: 100 },
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
  return {
    units: 'imperial',
    players,
    cameraOffset: 0,
    practiceMode: false,
    qualityLevel: QualityMode.High,
    // puttingEnabled: false,
    // gimmesEnabled: true,
    // gimmeDistances: [10, 20],
    elevation: 0,
    // gameMode: 2,
    ...override
  }
}
