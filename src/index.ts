export type {
  AgentAction,
  AgentActionResult,
  ConfirmationPolicy,
  DumpOptions,
  Frame,
  KokoAccountSnapshot,
  KokoAgentConfig,
  KokoBrandingConfig,
  KokoEntitlements,
  KokoLocale,
  KokoPlanId,
  KokoTheme,
  KokoUsageEvent,
  MatchRule,
  Point,
  Selector,
  SensitiveConfirmContext,
  SwipeOptions,
  PinchOptions,
  TapOptions,
  TypeOptions,
  ViewNode,
} from './types';

export type {
  ObserverUiState,
  Task,
  TaskNode,
  TaskNodeKind,
  TaskNodeStatus,
  TaskStatus,
  TaskStoreSnapshot,
  ProgressResultFlash,
} from './task/types';

export { KokoAgent, getKokoAgent, initKokoAgent } from './KokoAgent';
export type { TapTarget, TypeTarget } from './KokoAgent';

export { KokoProvider, useKokoAgent } from './provider/KokoProvider';
export type { KokoProviderProps } from './provider/KokoProvider';
export { KokoRemoteSmoke } from './debug/KokoRemoteSmoke';
export type { KokoRemoteSmokeCmd } from './debug/KokoRemoteSmoke';
export { useKokoUi } from './provider/KokoUiContext';
export type { KokoUiContextValue } from './provider/KokoUiContext';
export {
  setKokoAppearance,
  getKokoAppearance,
  HostAppearanceStore,
  resolveThemeColors,
  resolveChromeColors,
  invertTheme,
} from './provider/HostAppearanceStore';
export type {
  KokoAppearance,
  KokoThemeColors,
} from './provider/HostAppearanceStore';

export { CursorOverlay } from './cursor/CursorOverlay';
export { CursorController } from './cursor/controller';

export { KokoObserver } from './ui/KokoObserver';
export type { KokoObserverProps } from './ui/KokoObserver';
export { KokoChatSheet } from './ui/KokoChatSheet';
export { KokoComposer } from './ui/KokoComposer';
export type { KokoComposerProps } from './ui/KokoComposer';
export {
  KokoEntryButton,
  openKokoChat,
  closeKokoChat,
} from './ui/KokoEntryButton';
export type { KokoEntryButtonProps } from './ui/KokoEntryButton';
export { KokoSubtitle } from './ui/KokoSubtitle';
export { KokoTaskPanel } from './ui/KokoTaskPanel';
export { KokoDialogHost, DialogBus } from './ui/KokoDialogHost';
export {
  KokoOverlayLayer,
  KOKO_OVERLAY_TEST_ID,
} from './ui/KokoOverlayLayer';
export type { KokoOverlayLayerProps } from './ui/KokoOverlayLayer';

export type {
  ScreenshotOptions,
  ScreenshotResult,
  RecognizeScreenTextOptions,
  RecognizeScreenTextResult,
} from './native/NativeBridge';
export { NativeBridge } from './native/NativeBridge';

export { classifyGoalIntent, goalTokens } from './assist/intentClassify';
export type { AssistIntent, IntentResult } from './assist/intentClassify';
export { rankNodesForGoal, assistHintsModelText } from './assist/nodeRank';
export type { RankedNode } from './assist/nodeRank';
export {
  buildOnDeviceAssist,
  buildOnDeviceAssistSync,
} from './assist/OnDeviceAssist';
export type {
  OnDeviceAssistResult,
  BuildAssistOptions,
} from './assist/OnDeviceAssist';

export { TaskStore, TaskStoreImpl } from './task/TaskStore';
export { useTaskStore } from './task/useTaskStore';

export { AgentSession } from './client/AgentSession';
export type { AgentSessionOptions, AgentRunResult, AskUserHandler } from './client/AgentSession';
export {
  GatewayClient,
  GatewayError,
  GatewayUpgradeRequiredError,
  resolveGatewayBaseUrl,
  toLocalAgentAction,
} from './client/GatewayClient';
export type {
  GatewayConfig,
  GatewayNextRequest,
  GatewayNextResponse,
  GatewayAction,
  AgentHistoryItem,
  KokoTokenProvider,
  KokoTokenResult,
  GatewayUpgradeReason,
} from './client/GatewayClient';

export {
  KOKO_SDK_VERSION,
  KOKO_PROTOCOL_VERSION,
  KOKO_SDK_CAPABILITIES,
  kokoProtocolHeaders,
} from './protocol';
export type {
  KokoSdkCapability,
  KokoProtocolInfo,
  KokoSdkCompatibilityInfo,
  KokoGatewayCapabilities,
} from './protocol';

export { AccountStore } from './commercial/AccountStore';
export { UsageBus } from './commercial/UsageBus';
export { ExecutionGuard } from './commercial/ExecutionGuard';
export { AgentDebug } from './commercial/AgentDebug';
export {
  resolveDebugLogging,
  resolveDevMode,
  allowLocalGatewayForDebugClient,
  isMetroDevBuild,
} from './commercial/devMode';
export { resolveBranding, DEFAULT_ENTITLEMENTS } from './commercial/branding';
export type { ResolvedBranding } from './commercial/branding';
export {
  isTrustedEntitlementHost,
  isAllowedGatewayUrl,
  isOfficialGatewayHost,
  isLocalDevHost,
} from './commercial/trust';

export { t, normalizeLocale, gatewayLocale } from './i18n';
export type { MessageKey } from './i18n';

export { redactViewTreeClient, viewTreeOutline } from './privacy/redact';
export {
  extractAffordances,
  screenModelText,
  screenSnapshotLine,
} from './privacy/screenModel';
export type { Affordance, AffordanceKind } from './privacy/screenModel';

export {
  HostActionsStore,
  setHostActions,
  registerHostActions,
  unregisterHostAction,
  clearHostActions,
  hostActionsModelText,
  filterVisibleHostActions,
} from './host/HostActions';
export type { HostAction, HostActionKind } from './host/HostActions';

export {
  ExplorationGraph,
  fingerprintFromLabels,
  goalTokensForExplore,
  goalExploreQuery,
  exploreHintsModelText,
  normalizeExploreLabel,
  resolveExploreLabelOnScreen,
  exploreLabelSynonyms,
} from './explore/ExplorationGraph';
export type {
  ExploreNode,
  ExploreEdge,
  ExplorationGraphSnapshot,
  PathStep,
} from './explore/ExplorationGraph';
export { bootstrapExplore } from './explore/bootstrapExplore';
export type {
  BootstrapExploreOptions,
  BootstrapExploreResult,
} from './explore/bootstrapExplore';

export {
  find,
  findAll,
  findBySoftLabel,
  flattenTree,
  centerOf,
  findNodeById,
  nodeMatches,
} from './selector/match';
export { executeAgentAction } from './protocol/actions';
export { isSensitiveLabel, isSensitiveGoal, runConfirmationGate, runPreflightConfirm } from './confirmation/gate';
export { detectAppUserGate, gateMessage, userGateModelText } from './privacy/userGate';
export type { AppUserGate, AppUserGateKind } from './privacy/userGate';
export {
  AppUserGateStore,
  setAppUserGate,
  clearAppUserGate,
  signalAppUserGateDone,
} from './privacy/userGate';
