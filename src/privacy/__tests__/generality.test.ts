import type { ViewNode } from '../../types';
import { clearAppUserGate, detectAppUserGate } from '../userGate';
import { sensitiveScreenKind } from '../sensitiveScreen';
import { redactOutbound, redactViewTreeClient } from '../redact';
import { extractAffordances, readablePageContent, screenModelText, screenSnapshotLine } from '../screenModel';

const node = (id: string, partial: Partial<ViewNode> = {}): ViewNode => ({
  id, type: 'View', visible: true, enabled: true, clickable: false,
  frame: { x: 0, y: 0, width: 400, height: 800 }, children: [], ...partial,
});
const copy = (id: string, text: string) => node(id, { type: 'Text', text });
const button = (id: string, text: string, partial: Partial<ViewNode> = {}) => node(id, {
  type: 'Button', clickable: true, text,
  frame: { x: 20, y: 100, width: 160, height: 44 }, ...partial,
});
const page = (children: ViewNode[], partial: Partial<ViewNode> = {}) => node('root', { children, ...partial });

afterEach(clearAppUserGate);

it.each(['Face ID', 'WalletConnect', 'Sign in with Google', '连接硬件钱包', '输入密码'])(
  'leaves a short offered menu navigable: %s', label => {
    expect(detectAppUserGate(page([button('back', 'Back'), button('option', label)]))).toBeNull();
  },
);

it.each(['验证码', 'Please enter your 6-digit PIN', 'Enter your verification code', 'CVV', '确认您的密码'])(
  'uses the same private prompt classification for local gates and upload checks: %s', label => {
    const tree = page([copy('prompt', label)]);
    expect(detectAppUserGate(tree)).not.toBeNull();
    expect(sensitiveScreenKind(tree)).toBe('password');
    expect(redactViewTreeClient(tree).children).toEqual([]);
  },
);

it.each(['otp', 'cvv', 'verification-code', 'password'])(
  'shares private input metadata classification across both boundaries: %s', testID => {
    const tree = page([node('input', { type: 'TextInput', testID })]);
    expect(detectAppUserGate(tree)).not.toBeNull();
    expect(sensitiveScreenKind(tree)).toBe('password');
  },
);

it('cannot combine a background permission setting with an unrelated theme sheet', () => {
  const tree = page([
    copy('background', 'Camera permission: Allow / Deny'),
    node('theme-sheet', { sheet: true, children: [copy('title', 'Choose theme'), button('light', 'Light'), button('dark', 'Dark')] }),
  ]);
  expect(detectAppUserGate(tree)).toBeNull();
});

it('keeps actual permission choices scoped to their sheet', () => {
  expect(detectAppUserGate(page([node('prompt', { sheet: true, children: [
    copy('title', 'Camera'), button('allow', 'Allow'), button('deny', "Don't Allow"),
  ] })]))?.kind).toBe('permission');
});

it('does not treat public autocomplete test IDs as a recovery page', () => {
  expect(sensitiveScreenKind(page([copy('title', 'Search products'), button('result', 'Public product', { testID: 'suggest-0' })]))).toBeNull();
});

it('retains legacy wallet word controls when backed by phrase context', () => {
  const tree = page([copy('title', 'Choose the requested recovery phrase words'),
    ...Array.from({ length: 12 }, (_, i) => button(`word-${i}`, `SYNTHETIC_WORD_${i}`, { testID: `suggest-${i}` })),
  ]);
  expect(sensitiveScreenKind(tree)).toBe('recovery_phrase');
  expect(screenSnapshotLine(tree)).not.toContain('SYNTHETIC_WORD');
});

it('recognizes a private static title beneath a full-screen keyboard-dismiss Pressable', () => {
  const tree = page([copy('title', 'Backup recovery phrase'), copy('grid', 'SYNTHETIC_PRIVATE_CONTENT')], { clickable: true });
  expect(sensitiveScreenKind(tree)).toBe('recovery_phrase');
  expect(screenModelText(tree)).not.toContain('SYNTHETIC_PRIVATE_CONTENT');
});

it('protects private headings independently of the number of choice controls', () => {
  const tree = page([copy('title', 'Verify recovery phrase'), ...Array.from({ length: 12 }, (_, i) => button(`word-${i}`, `SYNTHETIC_WORD_${i}`))]);
  expect(sensitiveScreenKind(tree)).toBe('recovery_phrase');
});

it('allows explicit private markers in any locale', () => {
  expect(sensitiveScreenKind(page([copy('title', '非英文示例')], { testID: 'privacy-sensitive-mnemonic' }))).toBe('recovery_phrase');
});

it('emits only defined node fields, including on private root placeholders', () => {
  const tree = page([copy('text', 'Public content')], {
    frame: { x: 0, y: 0, width: 400, height: 800, extra: 'SYNTHETIC_SECRET' } as any,
    accessibilityValue: 'SYNTHETIC_SECRET', metadata: { value: 'SYNTHETIC_SECRET' }, value: 'SYNTHETIC_SECRET',
  } as any);
  expect(JSON.stringify(redactOutbound(redactViewTreeClient(tree), tree))).not.toContain('SYNTHETIC_SECRET');
  expect(JSON.stringify(redactViewTreeClient({ ...tree, testID: 'privacy-sensitive-mnemonic' }))).not.toContain('SYNTHETIC_SECRET');
});

it('redacts values from both live and supplied trees across every outbound field', () => {
  const live = page([node('live-input', { secure: true, text: 'SYNTHETIC_LIVE_VALUE' })]);
  const supplied = page([node('cached-input', { secure: true, text: 'SYNTHETIC_SUPPLIED_VALUE' })]);
  const outbound = redactOutbound({ goal: 'SYNTHETIC_LIVE_VALUE', history: [{ result: 'SYNTHETIC_SUPPLIED_VALUE' }] }, [live, supplied]);
  expect(outbound).toEqual({ goal: '[redacted]', history: [{ result: '[redacted]' }] });
});

it('retains known boolean and finite numeric state while discarding extra fields', () => {
  const safe = redactViewTreeClient(page([], { selected: true, on: false, value: 0, min: 0, max: 100, scrollable: true }));
  expect(safe).toMatchObject({ selected: true, on: false, value: 0, min: 0, max: 100, scrollable: true });
});

it('keeps public secret-operation menu copy without treating it as a secret value', () => {
  const safe = redactViewTreeClient(page([button('export', 'Export private key'), button('backup', '备份账户恢复凭证')]));
  expect(safe.children.map(n => n.text)).toEqual(['Export private key', '备份账户恢复凭证']);
  expect(sensitiveScreenKind(safe)).toBeNull();
});

it('scrubs actual key formats and password assignments without suppressing public addresses', () => {
  const address = '0x1234567890abcdef1234567890abcdef12345678';
  const tree = page([copy('public', address), copy('key', 'a'.repeat(64)), copy('prefixed-key', `0x${'b'.repeat(64)}`), copy('assignment', 'password: SYNTHETIC_SECRET')]);
  const serialized = JSON.stringify(redactViewTreeClient(tree));
  expect(serialized).toContain(address);
  expect(serialized).not.toContain('a'.repeat(64));
  expect(serialized).not.toContain('b'.repeat(64));
  expect(serialized).not.toContain('SYNTHETIC_SECRET');
});

it.each([
  ['TextInput', 'recovery-phrase-input', 'recovery_phrase'],
  ['TextArea', 'mnemonic', 'recovery_phrase'],
  ['TextInput', 'private-key-input', 'private_key'],
])('protects declared private input semantics without depending on page copy: %s/%s', (type, testID, kind) => {
  expect(sensitiveScreenKind(page([node('input', { type, testID })]))).toBe(kind);
});

it('keeps independent same-name row actions and their associated content', () => {
  const tree = page(['A', 'B'].map(item => node(`row-${item}`, { children: [copy(`name-${item}`, `Item ${item}`), button(`delete-${item}`, 'Delete')] })));
  const actions = extractAffordances(tree).filter(a => a.label === 'Delete');
  expect(actions.map(a => a.nodeId)).toEqual(['delete-A', 'delete-B']);
  expect(actions.map(a => a.near)).toEqual(['Item A', 'Item B']);
});

it('keeps separate fields that share their placeholder', () => {
  const tree = page([node('first', { type: 'TextInput', text: 'Enter value' }), node('second', { type: 'TextInput', text: 'Enter value' })]);
  expect(extractAffordances(tree).filter(a => a.kind === 'field').map(a => a.nodeId)).toEqual(['first', 'second']);
});

it('does not hide ordinary Copy, Dismiss, chat or branded host controls', () => {
  const labels = ['Copy', 'Dismiss', 'Minimize', 'Open chat', 'Koko'];
  expect(extractAffordances(page(labels.map((label, i) => button(`button-${i}`, label)))).map(a => a.label).sort()).toEqual([...labels].sort());
});

it('excludes SDK chrome and LogBox by explicit identity instead of button text', () => {
  const tree = page([button('host-copy', 'Copy'), node('sdk', { testID: 'koko-agent-overlay', children: [button('stop', 'Stop')] }), node('dev', { type: 'RCTLogBoxView', children: [button('dismiss', 'Dismiss')] })]);
  expect(extractAffordances(tree).map(a => a.label)).toEqual(['Copy']);
});

it('tracks read-only loading/content changes even with no actionable controls', () => {
  expect(screenSnapshotLine(page([copy('body', 'Loading profile')]))).not.toBe(screenSnapshotLine(page([copy('body', 'Profile loaded')])));
});

it('tracks selected option state without changing labels or IDs', () => {
  const options = (dark: boolean) => page([button('light', 'Light', { selected: !dark }), button('dark', 'Dark', { selected: dark })]);
  expect(screenSnapshotLine(options(false))).not.toBe(screenSnapshotLine(options(true)));
});

it('retains real copy on a parent whose descendants are only empty icon wrappers', () => {
  expect(readablePageContent(page([node('title', { text: 'Profile loaded', children: [node('icon', { children: [node('decoration')] })] })]))).toContain('Profile loaded');
});
