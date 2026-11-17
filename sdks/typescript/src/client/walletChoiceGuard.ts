import type { GatewayAction } from './GatewayClient';

/** Protect a host-wallet request from accidentally selecting an unrelated provider. */
export function wrongHostWalletChoice(goal: string, action: GatewayAction, choices: string[], aliases: string[], observedLabel?: string): boolean {
  if (action.tool !== 'tap' || !choices.length || !aliases.length) return false;
  const normalize = (s: string) => s.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const g = normalize(goal);
  // An explicitly named provider is a different user request, not a host-wallet default.
  if (choices.some(choice => g.includes(normalize(choice)))) return false;
  const matches = action.args.selector?.match || [];
  const labels = [observedLabel, action.args.label, ...matches.flatMap(rule =>
    ['text', 'accessibilityLabel'].map(key => (rule as Record<string, unknown>)[key]).filter((x): x is string => typeof x === 'string'))]
    .filter((s): s is string => typeof s === 'string').map(normalize);
  return choices.some(choice => labels.includes(normalize(choice)) && !aliases.some(alias => normalize(alias) === normalize(choice)));
}
