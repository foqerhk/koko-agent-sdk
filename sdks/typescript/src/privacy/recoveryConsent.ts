import type { ViewNode } from '../types';
import { isSdkChrome, nodeLabels } from './screenEvidence';

const RECOVERY_RE = /助记词|恢复短语|种子短语|recovery\s+phrase|seed\s+phrase|mnemonic/i;
const REVIEW_RE = /检查.{0,20}(?:安全|风险)|安全(?:声明|警告|提示)|check\s+(?:whether|if).{0,60}secure|security\s+(?:alert|warning)|review.{0,30}(?:security|risks)/i;
const ASSERTIONS = [
  /只有.{0,12}(?:本人|自己|您|你).{0,12}(?:掌握|访问|知道)|only\s+you\s+(?:have\s+access|know)/i,
  /(?:并非|不是|不由).{0,12}(?:他人|别人).{0,8}提供|not\s+(?:been\s+)?provided\s+by\s+(?:anyone|someone)\s+else/i,
  /(?:被他人|被别人|一旦).{0,30}(?:盗|风险)|(?:anyone|someone)\s+else\s+sees.{0,60}(?:risk|theft)/i,
];

/** Public risk assertions require the user's judgment, even with Continue disabled.
 * Do not infer consent from education copy or a recovery-menu entry alone. */
export function recoveryConsentNode(root: ViewNode): ViewNode | null {
  const nodes: ViewNode[] = [];
  const visit = (node: ViewNode) => {
    if (node.visible === false || isSdkChrome(node)) return;
    nodes.push(node);
    node.children.forEach(visit);
  };
  visit(root);
  // Fabric can expose an entire sheet as one actionable ancestor. Read its
  // short heading independently of action-row traits; assertions below still
  // distinguish a review checklist from a menu or educational page.
  const heading = nodes.find(node => nodeLabels(node).some(label => label.length <= 160 && REVIEW_RE.test(label)));
  if (!heading) return null;
  // Labels can also be exposed on checkbox rows; never use IDs or input values.
  const labels = nodes.flatMap(nodeLabels);
  if (!labels.some(label => RECOVERY_RE.test(label))) return null;
  const assertionCount = ASSERTIONS.filter(pattern => labels.some(label => pattern.test(label))).length;
  if (assertionCount < 2) return null;
  const confirmation = nodes.some(node =>
    (node.clickable || node.enabled === false || /button/i.test(node.type)) &&
    nodeLabels(node).some(label => /^(?:继续|确认|我已知晓|continue|confirm|acknowledge)$/i.test(label)));
  const checkboxes = nodes.filter(node => node.toggle || /checkbox|checkbutton/i.test(node.type));
  // Disabled Tamagui controls may be plain, enabled native Views/Text with no
  // actionable/toggle flags. All three independent assertions plus an exact
  // confirmation label provide the stronger fallback evidence in that case.
  const untypedConfirmation = assertionCount === ASSERTIONS.length && labels.some(label =>
    /^(?:继续|确认|我已知晓|continue|confirm|acknowledge)$/i.test(label));
  return confirmation || checkboxes.length >= 2 || untypedConfirmation ? heading : null;
}
