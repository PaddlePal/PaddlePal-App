/**
 * Static config for the first-run, in-context onboarding tour.
 *
 * The tour runs on the real Tabs navigator — each step spotlights an actual
 * element on a real screen (see `components/tour/TourTarget`) rather than a
 * mocked-up recreation of it. Order here IS the order of the tour.
 *
 * See memory-bank/PLAN-onboarding-tour.md.
 */

/** Tab routes a tour step can live on (must match the generated route types). */
export type TourRoute =
  | '/(tabs)/dashboard'
  | '/(tabs)/live'
  | '/(tabs)/sessions'
  | '/(tabs)/settings';

/** Every element the tour can spotlight. Each is wrapped in a <TourTarget>. */
export type TourTargetId =
  | 'paddle-status'
  | 'connect-paddle'
  | 'session-card'
  | 'live-paddle'
  | 'history-list'
  | 'settings-account';

/**
 * Real things the user must do to get past a step. An action-gated step has no
 * working Next button — it advances **automatically** the moment the action
 * lands, so the tour never lingers on a control whose job is already done
 * (e.g. Connect Paddle, which becomes Disconnect Paddle once paired).
 */
export type TourAction = 'connect' | 'session-start' | 'session-end';

export interface TourStep {
  /** Stable id, unique across steps — used for keys and advance de-duping. */
  id: string;
  /** Tab this step's target lives on; advancing across tabs switches to it. */
  route: TourRoute;
  /** The <TourTarget id="..."> this step spotlights. */
  targetId: TourTargetId;
  title: string;
  body: string;
  /**
   * When set, there is no Next button: the user performs the real action and
   * the tour advances itself. Ungated steps are spotlight-and-explain.
   */
  requiresAction?: TourAction;
  /**
   * Pins the tooltip instead of letting it flip above/below the spotlight.
   * Needed where the target is tall enough that the automatic placement would
   * cover the thing being pointed at (the Live paddle).
   */
  placement?: 'top' | 'bottom';
}

/**
 * Source name this tour uses when holding the BLE auto-connect gate off (see
 * `useBluetooth.setAutoConnectEnabled`). Claimed by the welcome screen the
 * moment onboarding completes and released by `TourProvider` when the tour
 * ends, so the paddle can't connect itself before the Connect Paddle step.
 */
export const TOUR_AUTO_CONNECT_SOURCE = 'tour';

/** Param that launches the tour: `/(tabs)/dashboard?tour=1`. */
export const TOUR_PARAM_VALUE = '1';

export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: 'paddle-status',
    route: '/(tabs)/dashboard',
    targetId: 'paddle-status',
    title: 'Your paddle, at a glance',
    body: 'This card tells you whether your PaddlePal is connected. Once paired, the app finds it again on its own.',
  },
  {
    id: 'connect-paddle',
    route: '/(tabs)/dashboard',
    targetId: 'connect-paddle',
    title: 'Connect your paddle',
    body: 'Power the paddle on, tap Connect Paddle, then pick PaddlePal-Paddle from the list.',
    requiresAction: 'connect',
  },
  {
    id: 'session-start',
    route: '/(tabs)/dashboard',
    targetId: 'session-card',
    title: 'Start a session',
    body: 'Recording is what turns your shots into stats. Tap Start Session. The card keeps your time and shot count as you play.',
    requiresAction: 'session-start',
  },
  {
    id: 'live-paddle',
    route: '/(tabs)/live',
    targetId: 'live-paddle',
    title: 'See every hit live',
    body: 'You are recording now. The zone you strike lights up the instant you hit it, so you can check your contact point as you play. Try pressing the paddle face.',
    // The paddle fills the screen — pin the card low so it never covers the face.
    placement: 'top',
  },
  {
    id: 'session-end',
    route: '/(tabs)/dashboard',
    targetId: 'session-card',
    title: 'Finish up',
    body: 'End Session saves everything you just hit — time played, shot count and a breakdown by zone. Tap "End Session" it to wrap up.',
    requiresAction: 'session-end',
  },
  {
    id: 'history-list',
    route: '/(tabs)/sessions',
    targetId: 'history-list',
    title: 'Look back at your sessions',
    body: 'Every session you record lands here. Tap one for shot count, average power and a breakdown by zone.',
    placement: 'bottom',
  },
  {
    id: 'settings-account',
    route: '/(tabs)/settings',
    targetId: 'settings-account',
    title: "That's the tour",
    body: 'Your account details and sign out live here. Go hit something.',
  },
] as const;
