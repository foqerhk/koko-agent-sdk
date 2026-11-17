import { runtimeText } from '../i18n';
import type { ViewNode } from '../types';
import { isPrivateInput, isSdkChrome, PRIVATE_INPUT_PROMPT_RE, staticScreenLabels } from './screenEvidence';
import { privateFieldKind, privateHeadingKind, RECOVERY_CELL, RECOVERY_METADATA, type PrivateDataKind } from './privateData';

export type SensitiveScreenKind = 'password' | PrivateDataKind;

export function isPrivateGateKind(kind: string): boolean {
  return ['password', 'pin', 'otp', 'secure_input', 'recovery_phrase', 'private_key', 'account_secret', 'financial_data', 'identity_data'].includes(kind);
}

/** Local-only classification. Never return a field value or mnemonic word. */
export function sensitiveScreenKind(root: ViewNode | null | undefined): SensitiveScreenKind | null {
  if (!root) return null;
  let result: SensitiveScreenKind | null = null;
  let legacyPhraseCells = 0;
  let legacySuggestions = false;
  const visit = (n: ViewNode) => {
    if (isSdkChrome(n)) return;
    if (n.visible === false) {
      return;
    }
    if (isPrivateInput(n)) result = 'password';
    const id = n.testID || '';
    if (/^privacy[-_]sensitive(?:[-_:]|$)/i.test(id)) {
      result = /identity/i.test(id) ? 'identity_data' : /financial|payment|bank/i.test(id) ? 'financial_data' : 'account_secret';
    }
    if (/textfield|textinput|edittext|textview|textarea/i.test(n.type)) {
      const kind = privateFieldKind(`${id} ${n.accessibilityLabel || ''}`);
      if (kind) result = kind;
    }
    if (RECOVERY_CELL.test(id)) result = 'recovery_phrase';
    if (/privacy-sensitive.*(?:phrase|mnemonic|seed|recovery)/i.test(id)) {
      result = 'recovery_phrase';
    }
    if (/phrase-index\d+/i.test(id)) legacyPhraseCells++;
    if (/^suggest-|^wordIndex$/i.test(id)) legacySuggestions = true;
    if (/privacy-sensitive.*private|private[-_]?key[-_]?(?:value|field|input)/i.test(id)) {
      result = 'private_key';
    }
    for (const child of n.children || []) visit(child);
  };
  visit(root);
  if (result) return result;
  const headings = staticScreenLabels(root).map(({ label }) => label);
  // Legacy wallet IDs are not reserved SDK markers: suggest-* is also common
  // in public search. Require phrase context or an actual indexed word grid.
  if (legacyPhraseCells >= 3 || ((legacyPhraseCells || legacySuggestions) &&
      headings.some(text => RECOVERY_METADATA.test(text)))) return 'recovery_phrase';
  for (const text of headings) {
      if (PRIVATE_INPUT_PROMPT_RE.test(text)) return 'password';
      const kind = privateHeadingKind(text);
      if (kind) return kind;
  }
  return null;
}

export class SensitiveScreenError extends Error {
  constructor() {
    super(runtimeText('runtime.privateStep'));
    this.name = 'SensitiveScreenError';
  }
}
