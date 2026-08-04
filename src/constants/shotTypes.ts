import { ShotType } from '@/types';

/**
 * Display names for the five buckets produced by `lib/shotClassifier.ts`.
 */
export const SHOT_TYPE_LABELS: Record<ShotType, string> = {
  drive: 'Drive',
  drop: 'Drop',
  dink: 'Dink',
  overhead: 'Overhead',
  rally: 'Rally',
};

export interface ShotTypeGuideEntry {
  /** What the paddle is detecting — the sensor signature, in plain words. */
  what: string;
  /** How the shot is actually used in a game. */
  inGame: string;
}

/**
 * Static reference copy shown in the "What do these shot types mean?"
 * dropdown on the session detail screen. Identical for every session — it
 * explains the classifier's buckets, it does not describe any one session.
 *
 * Keyed, not ordered: callers walk `SHOT_TYPES` from `lib/shotClassifier` so
 * the guide is always listed in the same order as the chart's bars.
 */
export const SHOT_TYPE_GUIDE: Record<ShotType, ShotTypeGuideEntry> = {
  overhead: {
    what: 'A high-power shot with a fast swing, struck near the top of the paddle face.',
    inGame:
      'Use it to finish a point when your opponent pops the ball up high. Hit it aggressively downward, usually into an open spot or at your opponent’s feet.',
  },
  drive: {
    what: 'A fast, high-power shot hit out of the sweet spot of the paddle.',
    inGame:
      'Use it as a fast, hard shot — often from the baseline or midcourt — to pressure your opponents and force a weak return. It’s especially useful when you want to attack a higher ball.',
  },
  dink: {
    what: 'A slow, gentle shot with very little force behind it.',
    inGame:
      'Use it in soft, close-to-the-net exchanges to keep the ball low and make your opponent hit up on the ball. It’s mainly for control, and for setting up a better ball to attack later.',
  },
  drop: {
    what: 'A low-force shot that still has a real swing behind it, because it’s played from further back in the court.',
    inGame:
      'Use it as a soft transition shot from the back court, landing in the kitchen so you can move forward toward the net. It helps neutralise your opponent’s attack and get you into net position.',
  },
  rally: {
    what: 'Everything else — normal shots hit in the flow of play.',
    inGame:
      'These are the shots you hit while simply keeping the ball in play and waiting for a better chance to attack. In practice, consistency and placement matter more than power here.',
  },
};
