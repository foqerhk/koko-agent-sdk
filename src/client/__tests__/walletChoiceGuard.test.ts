import { wrongHostWalletChoice } from '../walletChoiceGuard';

const choices = ['WalletConnect', 'Coinbase Wallet'];
const aliases = ['UKey Wallet'];

it('rejects an unrelated option identified by a local OCR node', () => {
  expect(wrongHostWalletChoice('connect my wallet', { tool: 'tap', args: { nodeId: 'ocr:1' } }, choices, aliases, 'Coinbase Wallet')).toBe(true);
});
it('allows an explicitly requested provider and the host option', () => {
  expect(wrongHostWalletChoice('connect Coinbase Wallet', { tool: 'tap', args: { label: 'Coinbase Wallet' } }, choices, aliases)).toBe(false);
  expect(wrongHostWalletChoice('connect my wallet', { tool: 'tap', args: { label: 'UKey Wallet' } }, ['UKey Wallet', ...choices], aliases)).toBe(false);
});
