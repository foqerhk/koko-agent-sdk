import {
  isSensitiveGoal,
  isSensitiveLabel,
  runConfirmationGate,
  runPreflightConfirm,
} from '../gate';

describe('confirmation gate', () => {
  it('flags transfer-like labels', () => {
    expect(isSensitiveLabel('确认转账')).toBe(true);
    expect(isSensitiveLabel('export seed phrase')).toBe(true);
    expect(isSensitiveLabel('下一步')).toBe(false);
  });

  it('does not flag ordinary list delete', () => {
    expect(isSensitiveLabel('删除 4444')).toBe(false);
    expect(isSensitiveGoal('删除4444')).toBe(false);
  });

  it('flags irreversible account/wallet delete as goal', () => {
    expect(isSensitiveGoal('删除钱包')).toBe(true);
    expect(isSensitiveGoal('转 10 USDC 给某某')).toBe(true);
  });

  it('preflight mode skips inline tap gate', async () => {
    const ok = await runConfirmationGate(
      { action: 'tap', label: '确认转账' },
      { requireUserConfirm: true, mode: 'preflight' },
      async () => false,
    );
    expect(ok).toBe(true);
  });

  it('preflight asks for sensitive goals', async () => {
    let called = false;
    const ok = await runPreflightConfirm(
      '转账 10 USDC',
      { requireUserConfirm: true, mode: 'preflight' },
      async () => {
        called = true;
        return true;
      },
    );
    expect(called).toBe(true);
    expect(ok).toBe(true);
  });

  it('preflight skips ordinary goals', async () => {
    let called = false;
    const ok = await runPreflightConfirm(
      '删除4444',
      { requireUserConfirm: true, mode: 'preflight' },
      async () => {
        called = true;
        return true;
      },
    );
    expect(called).toBe(false);
    expect(ok).toBe(true);
  });

  it('inline mode still blocks without handler', async () => {
    const ok = await runConfirmationGate(
      { action: 'tap', label: '确认转账' },
      { requireUserConfirm: true, mode: 'inline' },
      undefined,
    );
    expect(ok).toBe(false);
  });
});
