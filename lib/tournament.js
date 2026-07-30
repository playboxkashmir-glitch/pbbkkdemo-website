import { query } from './db.js';
import { sendTournamentFixtureEmail } from './email.js';

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


// Checks whether a tournament has reached its team cap. If so, randomly
// seeds the paid teams into alphabet groups (A, B, C, ...), builds the
// bracket, persists it, and emails every team their path to the final.
// Safe to call after every successful team payment -- it is a no-op if
// the tournament is not yet full or has already been seeded.
export async function seedTournamentIfFull(tournamentId) {
  const tRes = await query('SELECT * FROM tournaments WHERE id = $1', [tournamentId]);
  const tournament = tRes.rows[0];
  if (!tournament) return null;
  if (['seeded', 'in_progress', 'completed'].indexOf(tournament.status) !== -1) {
    return tournament;
  }

const teamsRes = await query(
  "SELECT id, team_name, captain_name, email, amount_paid FROM tournament_teams WHERE tournament_id = $1 AND payment_status = 'paid' ORDER BY id",
  [tournamentId]
  );
  const paidTeams = teamsRes.rows;
  if (paidTeams.length < tournament.num_teams) {
    return tournament;
  }

const seeded = assignSeedLabels(paidTeams.slice(0, tournament.num_teams));
  for (const team of seeded) {
    await query('UPDATE tournament_teams SET seed_label = $1 WHERE id = $2', [team.seed_label, team.id]);
  }
  seeded.sort((a, b) => a.seed_label.localeCompare(b.seed_label));

const rounds = generateBracket(seeded, tournament.start_date, 7);

for (const roundMatches of rounds) {
  for (const m of roundMatches) {
    await query(
      'INSERT INTO tournament_matches (tournament_id, round, round_name, match_index, team1_id, team2_id, match_date) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [tournamentId, m.round, m.round_name, m.match_index, m.team1_id, m.team2_id, m.match_date]
      );
  }
}

await query("UPDATE tournaments SET status = 'seeded', seeded_at = now() WHERE id = $1", [tournamentId]);

const round1 = rounds[0];
  const schedule = rounds.map((r) => ({ round_name: r[0].round_name, match_date: r[0].match_date }));

for (const team of seeded) {
  const match = round1.find((m) => m.team1_id === team.id || m.team2_id === team.id);
  let opponentLabel = null;
  if (match) {
    const opponentId = match.team1_id === team.id ? match.team2_id : match.team1_id;
    const opponentTeam = seeded.find((x) => x.id === opponentId);
    opponentLabel = opponentTeam ? opponentTeam.seed_label : null;
  }
  try {
    await sendTournamentFixtureEmail(team, tournament, opponentLabel, schedule);
  } catch (err) {
    console.error('Failed to send fixture email to', team.email, err);
  }
}

return Object.assign({}, tournament, { status: 'seeded' });
}

// Records the winner of a match, advances them into the correct slot of
// the next round (or marks the tournament completed if this was the
// final), and emails both teams in the newly-confirmed next match.
export async function recordMatchResult(matchId, winnerId) {
  const matchRes = await query('SELECT * FROM tournament_matches WHERE id = $1', [matchId]);
  const match = matchRes.rows[0];
  if (!match) throw new Error('Match not found.');
  if (winnerId !== match.team1_id && winnerId !== match.team2_id) {
    throw new Error('Winner must be one of the two teams in this match.');
  }

await query('UPDATE tournament_matches SET winner_id = $1 WHERE id = $2', [winnerId, matchId]);

const next = nextRoundSlot(match);
  const nextMatchRes = await query(
    'SELECT * FROM tournament_matches WHERE tournament_id = $1 AND round = $2 AND match_index = $3',
    [match.tournament_id, next.round, next.match_index]
    );
  const nextMatch = nextMatchRes.rows[0];

if (nextMatch) {
  await query('UPDATE tournament_matches SET ' + next.slot + ' = $1 WHERE id = $2', [winnerId, nextMatch.id]);

  const updatedNextRes = await query('SELECT * FROM tournament_matches WHERE id = $1', [nextMatch.id]);
  const updatedNext = updatedNextRes.rows[0];
  if (updatedNext.team1_id && updatedNext.team2_id) {
    const teamsRes = await query('SELECT * FROM tournament_teams WHERE id = ANY($1::int[])', [[updatedNext.team1_id, updatedNext.team2_id]]);
    const tournamentRes = await query('SELECT * FROM tournaments WHERE id = $1', [match.tournament_id]);
    const tournament = tournamentRes.rows[0];
    for (const team of teamsRes.rows) {
      const opponent = teamsRes.rows.find((x) => x.id !== team.id);
      try {
        await sendTournamentFixtureEmail(team, tournament, opponent ? opponent.seed_label : null, [{ round_name: updatedNext.round_name, match_date: updatedNext.match_date }]);
      } catch (err) {
        console.error('Failed to send next-round fixture email', err);
      }
    }
  }
} else {
  await query("UPDATE tournaments SET status = 'completed' WHERE id = $1", [match.tournament_id]);
}

return { match_id: matchId, winner_id: winnerId };
}
