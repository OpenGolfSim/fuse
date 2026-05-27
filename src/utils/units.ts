export class UnitConversions {
  static yardsToMeters(yards: number) {
    return yards * 0.9144;
  }
  static metersToYards(meters: number) {
    return meters * 1.09361;
  }
  static metersToFeet(meters: number) {
    return meters * 3.28084;
  }
  static milesPerHourToMetersPerSecond(mph: number) {
    return mph * 0.44704;
  }
  static metersPerSecondToMilesPerHour(metersPerSecond: number) {
    return metersPerSecond * 2.23694;
  }
}
