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
