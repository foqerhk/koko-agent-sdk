const mockEffects: Array<() => unknown> = [];
jest.mock('react', () => ({
  useRef: (value: unknown) => ({ current: value }),
  useEffect: (effect: () => unknown) => { mockEffects.push(effect); },
}));
jest.mock('react-native', () => ({ NativeModules: {}, AppState: { currentState: 'active', addEventListener: jest.fn() }, Platform: { OS: 'ios' } }));
jest.mock('../../provider/KokoProvider', () => ({ useKokoAgent: () => ({}) }));
jest.mock('../../task/TaskStore', () => ({ TaskStore: { subscribe: jest.fn() } }));
jest.mock('../../KokoAgent', () => ({ KokoAgent: {} }));
jest.mock('../../native/NativeBridge', () => ({ NativeBridge: {} }));
jest.mock('../../ui/progressChrome', () => ({}));
jest.mock('../../cursor/controller', () => ({}));
jest.mock('../../assist/OnDeviceAssist', () => ({}));
jest.mock('../../client/GatewayClient', () => ({}));

import { KokoRemoteSmoke } from '../KokoRemoteSmoke';
import { TaskStore } from '../../task/TaskStore';

it('does not subscribe or contact the remote driver in a release build, even when enabled', () => {
  (global as any).__DEV__ = false;
  const fetchSpy = jest.spyOn(global, 'fetch');
  mockEffects.length = 0;
  KokoRemoteSmoke({ enabled: true, port: 9877 });
  for (const effect of mockEffects) effect();
  expect(TaskStore.subscribe).not.toHaveBeenCalled();
  expect(fetchSpy).not.toHaveBeenCalled();
  fetchSpy.mockRestore();
  delete (global as any).__DEV__;
});
