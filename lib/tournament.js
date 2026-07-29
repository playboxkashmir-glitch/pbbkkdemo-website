// Single-elimination tournament bracket helpers.
// Supports standard knockout sizes: 4, 8, 16, 32 teams.
// Each round halves the number of teams until a single champion remains
// (e.g. a tournament of 8 teams has 7 total matches).

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// Fisher-Yates shuffle. Does not mutate the input array.
export function shuffle(array) {
  const arr = array.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

// Randomly assigns alphabet seed labels (A, B, C, ...) to teams once a
// tournament fills up ("categorised by random alphabets"), then those
// randomly-ordered teams are paired up into groups of 2 for round 1.
export function assignSeedLabels(teams) {
  const shuffled = shuffle(teams);
  return shuffled.map((team, i) => Object.assign({}, team, {
    seed_label: ALPHABET[i] || ('T' + (i + 1))
  }));
}

function roundName(teamsInRound) {
  if (teamsInRound === 2) return 'Final';
  if (teamsInRound === 4) return 'Semi Final';
  if (teamsInRound === 8) return 'Quarter Final';
  return 'Round of ' + teamsInRound;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function toDateString(date) {
  return date.toISOString().slice(0, 10);
}

export function isPowerOfTwo(n) {
  return Number.isInteger(n) && n >= 2 && (n & (n - 1)) === 0;
}

// Builds the full knockout bracket for a randomly-seeded list of teams
// (each team object needs an `id`). Round 1 matches are filled in with the
// actual teams; every later round starts empty (team1_id/team2_id null)
// and gets filled in as winners are recorded via nextRoundSlot() below.
// Returns an array of rounds, each an array of match objects with:
// { round, round_name, match_index, team1_id, team2_id, match_date }
export function generateBracket(teams, startDate, matchGapDays) {
  const gap = matchGapDays || 7;
  const numTeams = teams.length;
  if (!isPowerOfTwo(numTeams)) {
    throw new Error('Number of teams must be a power of 2 (4, 8, 16, or 32).');
  }

const rounds = [];
  let date = new Date(startDate);
  let round = 1;
  let teamsInRound = numTeams;

let matches = [];
  for (let i = 0; i < numTeams; i += 2) {
    matches.push({
      round: round,
      round_name: roundName(teamsInRound),
      match_index: i / 2,
      team1_id: teams[i].id,
      team2_id: teams[i + 1].id,
      match_date: toDateString(date)
    });
  }
  rounds.push(matches);

teamsInRound = teamsInRound / 2;
  round += 1;
  date = addDays(date, gap);

while (teamsInRound >= 2) {
  matches = [];
  const numMatches = teamsInRound / 2;
  for (let i = 0; i < numMatches; i++) {
    matches.push({
      round: round,
      round_name: roundName(teamsInRound),
      match_index: i,
      team1_id: null,
      team2_id: null,
      match_date: toDateString(date)
    });
  }
  rounds.push(matches);
  teamsInRound = teamsInRound / 2;
  round += 1;
  date = addDays(date, gap);
}

return rounds;
}

// Given a completed match, works out which match/slot in the NEXT round
// the winner feeds into (standard single-elimination bracket mapping).
export function nextRoundSlot(match) {
  return {
    round: match.round + 1,
    match_index: Math.floor(match.match_index / 2),
    slot: match.match_index % 2 === 0 ? 'team1_id' : 'team2_id'
  };
}
