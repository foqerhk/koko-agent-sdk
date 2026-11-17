import type { ConfirmationPolicy, SensitiveConfirmContext } from '../types';

/**
 * Irreversible / high-risk intents — confirmed once **before** the agent run.
 * Ordinary list deletes are NOT sensitive.
 */
export const DEFAULT_SENSITIVE_PATTERNS: RegExp[] = [
  /转账|转\s*\d|transfer|withdraw|send\s*(usdt|usdc|eth|btc)?/i,
  /授权|approve|export\s*(key|seed|mnemonic)|私钥|账户恢复凭证|私密认证数据/i,
  /删除(钱包|账户|账号|密钥)|永久删除|注销账户|销毁/i,
  /delete\s*(wallet|account|key|seed)|destroy\s*account/i,
  /confirm\s*(transfer|payment)|确认(转账|支付|授权)/i,
  /助[记記][词詞]|恢复短语|种子短语|mnemonic|(?:recovery|seed)\s*phrase|keystore|api[\s_-]*(?:key|secret)|恢复码|备用码/i,
  /personal_sign|eth_sign|signTypedData|typed\s*data|permit2?|setApprovalForAll|签名|签署|无限授权|代币授权|授权额度/i,
  /兑换|跨链|质押|解除质押|\bswap\b|\bbridge\b|\bstake\b|\bunstake\b|广播交易|broadcast\s*transaction/i,
  /支付|付款|提现|自动扣款|订阅|confirm\s*order|recurring\s*payment|direct\s*debit/i,
  /账户恢复|恢复账户|重置钱包|关闭双重验证|关闭两步验证|删除通行密钥|更改恢复邮箱|account\s*recovery|disable\s*2fa|delete\s*passkey|change\s*recovery/i,
  /提交身份|实名认证|身份验证|identity\s*verification|\bkyc\b|passport|身份证|银行卡号/i,
];

export function isSensitiveLabel(
  label: string | undefined,
  policy?: ConfirmationPolicy,
): boolean {
  if (!label) return false;
  const patterns = policy?.sensitivePatterns?.length
    ? policy.sensitivePatterns
    : DEFAULT_SENSITIVE_PATTERNS;
  return patterns.some((re) => re.test(label));
}

/** Goal looks like a high-risk operation → preflight confirm. */
export function isSensitiveGoal(
  goal: string,
  policy?: ConfirmationPolicy,
): boolean {
  return isSensitiveLabel(goal, policy);
}

/**
 * Mid-step gate (legacy). Prefer preflight; during unattended runs this should no-op.
 */
export async function runConfirmationGate(
  ctx: SensitiveConfirmContext,
  policy: ConfirmationPolicy | undefined,
  onConfirm?: (ctx: SensitiveConfirmContext) => Promise<boolean>,
): Promise<boolean> {
  const mode = policy?.mode ?? 'preflight';
  if (mode === 'off' || mode === 'preflight') {
    // Preflight already asked (or disabled). Never block mid-execution.
    return true;
  }

  const requireConfirm = policy?.requireUserConfirm !== false;
  if (!requireConfirm) return true;

  const label = ctx.label ?? ctx.action;
  if (!isSensitiveLabel(label, policy) && !isSensitiveLabel(ctx.action, policy)) {
    return true;
  }

  if (!onConfirm) return false;
  return onConfirm(ctx);
}

/**
 * Ask once before the agent loop. Returns false if user declines.
 */
export async function runPreflightConfirm(
  goal: string,
  policy: ConfirmationPolicy | undefined,
  onConfirm?: (ctx: SensitiveConfirmContext) => Promise<boolean>,
): Promise<boolean> {
  const mode = policy?.mode ?? 'preflight';
  if (mode === 'off') return true;
  if (mode !== 'preflight' && mode !== 'inline') return true;

  const requireConfirm = policy?.requireUserConfirm !== false;
  if (!requireConfirm) return true;
  if (!isSensitiveGoal(goal, policy)) return true;

  if (!onConfirm) return false;

  return onConfirm({
    action: 'preflight',
    label: goal,
  });
}
