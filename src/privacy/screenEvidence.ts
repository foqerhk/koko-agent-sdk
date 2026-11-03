import type { ViewNode } from '../types';

/** Shared by local gates and the final upload boundary; never inspect values. */
export const PRIVATE_INPUT_PROMPT_RE =
  /^(?:(?:请)?(?:输入|设置|确认|创建|验证|解锁|重置|更改|修改)(?:您?的|新|旧|登录|支付|交易|钱包|安全|数字|\d+位|\s)*(?:密码|安全码|验证码)|(?:登录|支付|交易|钱包)?密码|安全码|验证码|短信验证|(?:please\s+)?(?:enter|set|confirm|create|verify|unlock|reset|change)\s+(?:(?:your|new|old|wallet|payment|login|\d+[- ]digit)\s+)*(?:password|passcode|pin|otp|security\s+code|verification\s+code)|password|passcode|pin|otp|cvv)\s*[:：?？!！]?$/i;

export function isPrivateInput(node: ViewNode): boolean {
  if (node.secure) return true;
  if (!/securetext|password|textfield|textinput|edittext|textview|textarea/i.test(node.type)) return false;
  const metadata = `${node.testID || ''} ${node.accessibilityLabel || ''} ${node.type}`;
  return /password|passwd|pass[-_\s]?code|\bpin\b|\botp\b|\bcvv\b|verification[-_\s]*code|security[-_\s]*code|密码|验证码|安全码/i.test(metadata) ||
    (typeof node.text === 'string' && PRIVATE_INPUT_PROMPT_RE.test(node.text.trim()));
}

/** Text spoken by a node; test IDs are metadata, never user-facing copy. */
export function nodeLabels(node: ViewNode): string[] {
  return [...new Set([node.text, node.accessibilityLabel]
    .filter((text): text is string => typeof text === 'string' && !!text.trim())
    .map(text => text.replace(/\s+/g, ' ').trim()))];
}

export function isSdkChrome(node: ViewNode): boolean {
  return /^koko-agent-(?:overlay|cursor|entry)(?:$|[/:-])/i.test(node.testID || '');
}

export function isSystemSheet(node: ViewNode): boolean {
  return node.sheet === true || /uialertcontroller|alertdialog|biometricprompt/i.test(node.type);
}

/** A full-screen Pressable used to dismiss the keyboard is not an action row. */
function isActionRow(node: ViewNode, root: ViewNode): boolean {
  if (!node.clickable && !node.toggle && !node.adjustable) return false;
  if (/button|menuitem|tabbaritem|navigationitem/i.test(node.type)) return true;
  if (node === root || node.frame.height >= root.frame.height / 2) return false;
  const hasIndependentAction = (n: ViewNode): boolean => n.children.some(child =>
    child.clickable || child.toggle || child.adjustable || hasIndependentAction(child));
  return !hasIndependentAction(node);
}

/** Static own copy, excluding aggregated ancestors and offered menu actions. */
export function staticScreenLabels(root: ViewNode): Array<{ node: ViewNode; label: string }> {
  const out: Array<{ node: ViewNode; label: string }> = [];
  const hasCopy = (n: ViewNode): boolean => n.visible !== false && !isSdkChrome(n) &&
    (!!nodeLabels(n).length || n.children.some(hasCopy));
  const visit = (node: ViewNode, inAction: boolean) => {
    if (isSdkChrome(node)) return;
    const action = inAction || isActionRow(node, root);
    if (node.visible !== false && !action && !node.children.some(hasCopy)) {
      for (const label of nodeLabels(node)) out.push({ node, label });
    }
    for (const child of node.children) visit(child, action);
  };
  visit(root, false);
  return out;
}
