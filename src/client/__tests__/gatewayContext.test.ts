jest.mock('react-native', () => ({
  NativeModules: {}, Platform: { OS: 'ios' },
}), { virtual: true });
jest.mock('../../native/NativeBridge', () => ({ NativeBridge: {
  isAvailable: jest.fn(() => true), dump: jest.fn(), hostAppId: () => 'local.test',
} }));

import { GatewayClient } from '../GatewayClient';
import { NativeBridge } from '../../native/NativeBridge';
import { clearHostActions, setHostActions } from '../../host/HostActions';
import { clearAppUserGate } from '../../privacy/userGate';
import type { ViewNode } from '../../types';

const tree: ViewNode = {
  id: 'root', type: 'View', frame: { x: 0, y: 0, width: 400, height: 800 },
  visible: true, enabled: true, clickable: false, children: [{
    id: 'search', type: 'Button', testID: 'search-button', text: 'Search',
    frame: { x: 20, y: 90, width: 180, height: 40 },
    visible: true, enabled: true, clickable: true, children: [],
  }],
};
const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; clearHostActions(); clearAppUserGate(); });

it('sends current redacted candidates and visible host hints, never caller supplied or hidden hints', async () => {
  (NativeBridge.dump as jest.Mock).mockResolvedValue(tree);
  setHostActions([
    { id: 'visible', label: 'Search', testID: 'search-button', run: () => {} },
    { id: 'hidden', label: 'SYNTHETIC_HIDDEN_HOST', run: () => {} },
  ]);
  let request: any;
  global.fetch = jest.fn(async (_url, init) => {
    request = JSON.parse(String(init?.body));
    return { ok: true, json: async () => ({ ok: true, execution_permit: 'local-permit' }) } as Response;
  }) as typeof fetch;
  await new GatewayClient({ token: 'local-test' }).next({ goal: 'Search', history: [], ui_tree: tree,
    ui_screen_model: 'SYNTHETIC_UNTRUSTED_MODEL', ui_outline: 'SYNTHETIC_UNTRUSTED_OUTLINE' });
  expect(request.ui_screen_model).toContain('On-device assist');
  expect(request.ui_screen_model).toContain('top_candidates:');
  expect(request.ui_screen_model).toContain('[host:button]');
  expect(request.ui_screen_model).toContain('Search');
  expect(JSON.stringify(request)).not.toContain('SYNTHETIC_HIDDEN_HOST');
  expect(JSON.stringify(request)).not.toContain('SYNTHETIC_UNTRUSTED_MODEL');
  expect(JSON.stringify(request)).not.toContain('SYNTHETIC_UNTRUSTED_OUTLINE');
});

it('does not send a newly presented private screen even when supplied a public cached tree', async () => {
  (NativeBridge.dump as jest.Mock).mockResolvedValue({ ...tree, testID: 'privacy-sensitive-mnemonic' });
  global.fetch = jest.fn() as typeof fetch;
  await expect(new GatewayClient({ token: 'local-test' }).next({ goal: 'Search', history: [], ui_tree: tree }))
    .rejects.toThrow();
  expect(global.fetch).not.toHaveBeenCalled();
});

it('only includes goal-derived local OCR evidence on a visible web page', async () => {
  const web: ViewNode = { ...tree, children: [{ ...tree.children[0]!, id: 'web', type: 'RNCWebView',
    text: undefined, testID: undefined, clickable: false, frame: { x: 0, y: 120, width: 400, height: 600 } }] };
  (NativeBridge.dump as jest.Mock).mockResolvedValue(web);
  let request: any;
  global.fetch = jest.fn(async (_url, init) => {
    request = JSON.parse(String(init?.body));
    return { ok: true, json: async () => ({ ok: true, execution_permit: 'local-permit' }) } as Response;
  }) as typeof fetch;
  await new GatewayClient({ token: 'local-test' }).next({ goal: 'Connect my wallet', history: [], ui_tree: web,
    local_ocr_goal_labels: ['Connect wallet', 'SYNTHETIC_PRIVATE_OCR_CONTENT'] });
  expect(request.ui_screen_model).toContain('[local-ocr]');
  expect(request.ui_screen_model).toContain('Connect wallet');
  expect(JSON.stringify(request)).not.toContain('SYNTHETIC_PRIVATE_OCR_CONTENT');
  expect(request.local_ocr_goal_labels).toBeUndefined();
});

it('includes only allowlisted public wallet choices and never arbitrary OCR text', async () => {
  const web: ViewNode = { ...tree, children: [{ ...tree.children[0]!, id: 'web', type: 'RNCWebView',
    text: undefined, testID: undefined, clickable: false, frame: { x: 0, y: 120, width: 400, height: 600 } }] };
  (NativeBridge.dump as jest.Mock).mockResolvedValue(web);
  let request: any;
  global.fetch = jest.fn(async (_url, init) => {
    request = JSON.parse(String(init?.body));
    return { ok: true, json: async () => ({ ok: true, execution_permit: 'local-permit' }) } as Response;
  }) as typeof fetch;
  await new GatewayClient({ token: 'local-test' }).next({ goal: 'Connect my wallet', history: [], ui_tree: web,
    local_ocr_wallet_choices: ['WalletConnect', 'MetaMask', 'Coinbase Wallet', 'SYNTHETIC_PRIVATE_OCR_CONTENT'],
    local_web_wallet_aliases: ['MetaMask', 'SYNTHETIC_HIDDEN_ALIAS'] });
  expect(request.ui_screen_model).toContain('[local-wallet-choices]');
  expect(request.ui_screen_model).toContain('WalletConnect');
  expect(request.ui_screen_model).toContain('[host-wallet-alias]');
  expect(request.ui_screen_model).toContain('MetaMask');
  expect(JSON.stringify(request)).not.toContain('SYNTHETIC_PRIVATE_OCR_CONTENT');
  expect(JSON.stringify(request)).not.toContain('SYNTHETIC_HIDDEN_ALIAS');
  expect(request.local_ocr_wallet_choices).toBeUndefined();
});

it('tells the planner not to guess when the host wallet is absent from the chooser', async () => {
  const web: ViewNode = { ...tree, children: [{ ...tree.children[0]!, id: 'web', type: 'RNCWebView',
    text: undefined, testID: undefined, clickable: false, frame: { x: 0, y: 120, width: 400, height: 600 } }] };
  (NativeBridge.dump as jest.Mock).mockResolvedValue(web);
  let request: any;
  global.fetch = jest.fn(async (_url, init) => {
    request = JSON.parse(String(init?.body));
    return { ok: true, json: async () => ({ ok: true, execution_permit: 'local-permit' }) } as Response;
  }) as typeof fetch;
  await new GatewayClient({ token: 'local-test' }).next({ goal: 'Connect my wallet', history: [], ui_tree: web,
    local_ocr_wallet_choices: ['WalletConnect', 'Coinbase Wallet'], local_web_wallet_aliases: ['UKey Wallet'] });
  expect(request.ui_screen_model).toContain('[host-wallet-unavailable]');
  expect(request.ui_screen_model).toContain('Do not select a different wallet');
});
