import { screenModelText, screenSnapshotLine } from '../../privacy/screenModel';
import { isLooping, isNearLoop } from '../loopDetect';
import type { ViewNode } from '../../types';

function page(copy: string): ViewNode {
  return {
    id: '0', type: 'View', clickable: false,
    frame: { x: 0, y: 0, width: 400, height: 800 }, children: [
      { id: '0/0', type: 'Text', text: copy, clickable: false,
        frame: { x: 20, y: 250, width: 360, height: 100 }, children: [] },
      { id: '0/1', type: 'Button', text: '继续', clickable: true,
        frame: { x: 20, y: 700, width: 360, height: 48 }, children: [] },
    ],
  };
}

const copies = ['阅读第一项注意事项', '阅读第二项注意事项', '阅读第三项注意事项'];
const tap = (copy: string) => ({
  tool: 'tap', args: { nodeId: '0/1' }, ok: true,
  result: `tapped ${'long narration '.repeat(10)} || ${screenSnapshotLine(page(copy))}`,
});

it('observes noninteractive body changes while button labels and IDs stay identical', () => {
  const snapshots = copies.map(copy => screenSnapshotLine(page(copy)));
  expect(new Set(snapshots).size).toBe(3);
  for (const copy of copies) expect(screenModelText(page(copy))).toContain(`[content] ${copy}`);
});

it('permits repeated wizard actions whose changes occur beyond the first 100 result characters', () => {
  const history = copies.map(tap);
  expect(isLooping(history)).toBe(false);
  expect(isNearLoop(history)).toBe(false);
});

it('permits tap/verify/tap/verify when page copy advances', () => {
  const history = [tap(copies[0]), { tool: 'dump', result: screenSnapshotLine(page(copies[0])) },
    tap(copies[1]), { tool: 'dump', result: screenSnapshotLine(page(copies[1])) }];
  expect(isLooping(history)).toBe(false);
});

it('still stops actual unchanged repeated clicks', () => {
  const history = Array.from({ length: 3 }, () => tap(copies[0]));
  expect(isLooping(history)).toBe(true);
});

it('does not expose private page body as progress evidence', () => {
  const privatePage = { ...page('SYNTHETIC_PRIVATE_CONTENT'), testID: 'privacy-sensitive-mnemonic' };
  expect(screenModelText(privatePage)).not.toContain('SYNTHETIC_PRIVATE_CONTENT');
  expect(screenSnapshotLine(privatePage)).not.toContain('SYNTHETIC_PRIVATE_CONTENT');
});
