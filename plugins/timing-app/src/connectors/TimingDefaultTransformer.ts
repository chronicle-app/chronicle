import { DispatchingTransformer } from '@chronicle.app/etl';
import TimingAppTransformer from './TimingAppTransformer.js';
import TimingCallTransformer from './TimingCallTransformer.js';

/**
 * Routes the merged default stream to the focused transformers by record type:
 * app usage and time entries → `TimingAppTransformer` (source `timing-app`),
 * calls → `TimingCallTransformer` (re-sourced to `apple-call-history` so they fold with
 * the Apple Call History plugin).
 */
export default class TimingDefaultTransformer extends DispatchingTransformer {
  static override routes = {
    'app-activities': TimingAppTransformer,
    'time-entries': TimingAppTransformer,
    calls: TimingCallTransformer,
  };
}
