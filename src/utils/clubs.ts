
export function clubUpDown(clubs: OpenGolfSim.Club[], currentClub: OpenGolfSim.Club, direction: number) {
  const sortedClubs = [...clubs].sort((a, b) => a.distance > b.distance ? -1 : 1);
  const currentIndex = sortedClubs.findIndex(club => club.id === currentClub.id);
  const newIndex = Math.min(Math.max(0, (currentIndex + direction)), sortedClubs.length - 1);
  if (sortedClubs?.[newIndex]) {
    return sortedClubs[newIndex];
  }
}