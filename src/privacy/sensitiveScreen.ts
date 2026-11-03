import { runtimeText } from '../i18n';
import type { ViewNode } from '../types';
import { isPrivateInput, isSdkChrome, PRIVATE_INPUT_PROMPT_RE, staticScreenLabels } from './screenEvidence';

export type SensitiveScreenKind = 'password' | 'recovery_phrase' | 'private_key';

/** Local-only classification. Never return a field value or mnemonic word. */
export function sensitiveScreenKind(root: ViewNode | null | undefined): SensitiveScreenKind | null {
  if (!root) return null;
  let result: SensitiveScreenKind | null = null;
  let legacyPhraseCells = 0;
  let legacySuggestions = false;
  const visit = (n: ViewNode) => {
    if (isSdkChrome(n)) return;
    if (n.visible === false) {
      for (const child of n.children || []) visit(child);
      return;
    }
    if (isPrivateInput(n)) result = 'password';
    const id = n.testID || '';
    if (/textfield|textinput|edittext|textview|textarea/i.test(n.type) &&
        /账户恢复凭证|敏感恢复数据|mnemonic|(?:recovery|seed)[\s_-]*phrase/i.test(`${id} ${n.accessibilityLabel || ''}`)) result = 'recovery_phrase';
    if (/textfield|textinput|edittext|textview|textarea/i.test(n.type) &&
        /私钥|private[\s_-]*key/i.test(`${id} ${n.accessibilityLabel || ''}`)) result = 'private_key';
    if (/privacy-sensitive.*(?:phrase|mnemonic|seed)/i.test(id)) {
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
      headings.some(text => /账户恢复凭证|敏感恢复数据|mnemonic|(?:recovery|seed)\s+phrase/i.test(text)))) return 'recovery_phrase';
  for (const text of headings) {
      if (PRIVATE_INPUT_PROMPT_RE.test(text)) return 'password';
      if (/^(?:(?:验证|确认|备份|显示|查看|输入|导入|恢复)(?:您的|你的)?(?:账户恢复凭证|敏感恢复数据)|(?:verify|confirm|back\s*up|backup|show|reveal|import|enter)\s+(?:(?:your|the)\s+)?(?:recovery\s+|seed\s+)?(?:phrase|mnemonic))\s*[：:？?]?$/i.test(text)) return 'recovery_phrase';
      if (/^(?:(?:导出|显示|查看|输入|导入)(?:您的|你的)?私钥|(?:export|show|reveal|import|enter)\s+(?:(?:your|the)\s+)?private\s*key)\s*[：:]?$/i.test(text)) return 'private_key';
  }
  return null;
}

export class SensitiveScreenError extends Error {
  constructor() {
    super(runtimeText('runtime.privateStep'));
    this.name = 'SensitiveScreenError';
  }
}
