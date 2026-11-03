jest.mock('react-native', () => ({
  NativeModules: {}, Platform: { OS: 'ios' },
  Dimensions: { get: () => ({ width: 400, height: 800 }) },
}), { virtual: true });
jest.mock('../../ui/KokoDialogHost', () => ({ DialogBus: {} }));

import { KokoAgent } from '../../KokoAgent';
import { ActionValidationError } from '../ActionOutcomeUnknownError';
import type { ViewNode } from '../../types';

const button: ViewNode = {
  id: 'button', type: 'Button', text: 'Continue', clickable: true,
  enabled: true, visible: true, frame: { x: 20, y: 200, width: 180, height: 50 }, children: [],
};
const point = { x: 110, y: 225 };

function runtime(current = button, nextPoint = point) {
  const agent = new KokoAgent();
  const internal = agent as any;
  internal.lastTree = { ...button, id: 'root', type: 'View', children: [current] };
  jest.spyOn(internal, 'resolvePoint').mockResolvedValue(nextPoint);
  return internal;
}

it('does not touch a target that moved while the cursor or confirmation was pending', async () => {
  const agent = runtime(button, { x: 110, y: 350 });
  await expect(agent.assertTapTargetCurrent({ nodeId: 'button' }, point, button))
    .rejects.toBeInstanceOf(ActionValidationError);
});

it('does not touch a different control recycled into the same node path', async () => {
  const agent = runtime({ ...button, text: 'Delete' });
  await expect(agent.assertTapTargetCurrent({ nodeId: 'button' }, point, button))
    .rejects.toBeInstanceOf(ActionValidationError);
});

it('accepts a current target with the same identity and position', async () => {
  const agent = runtime();
  await expect(agent.assertTapTargetCurrent({ nodeId: 'button' }, point, button)).resolves.toBeUndefined();
  expect(agent.resolvePoint).toHaveBeenCalledWith({ nodeId: 'button', options: { revealIfNeeded: false } });
});
