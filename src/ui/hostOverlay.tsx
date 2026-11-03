import React, { type ComponentType, type ReactNode } from 'react';
import {
  Modal,
  Platform,
  StyleSheet,
  useWindowDimensions,
  type ViewStyle,
} from 'react-native';
import { KokoOverlayLayer } from './KokoOverlayLayer';

type OverlayProps = {
  children: ReactNode;
  /** Remount / bring-to-front token (host FullWindowOverlay). */
  liftToken?: number;
  style?: ViewStyle;
};

type FullWindowOverlayProps = {
  children: ReactNode;
  bringToFrontToken?: number;
  unstable_accessibilityContainerViewIsModal?: boolean;
};

function tryFullWindowOverlay(): ComponentType<FullWindowOverlayProps> | null {
  if (Platform.OS !== 'ios') return null;
  try {
    // Optional peer — OneKey (and most RN hosts) already ship react-native-screens.
    // FullWindowOverlay sits above native-stack modals; RN Modal often cannot.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-screens');
    const Comp = mod.FullWindowOverlay as
      | ComponentType<FullWindowOverlayProps>
      | undefined;
    return Comp ?? null;
  } catch {
    return null;
  }
}

const HostFullWindowOverlay = tryFullWindowOverlay();

/**
 * Host chrome above native Settings / stack modals.
 *
 * Prefer FullWindowOverlay: it adds a view to the window rather than presenting
 * a view controller, so `pointerEvents="box-none"` lets the user keep using the
 * App underneath while a task runs. An RN Modal is its own iOS window and
 * swallows every touch that is not aimed at the chrome itself — the agent does
 * not notice, because the native tap skips Koko chrome windows, but the user
 * cannot tap anything until the task ends.
 *
 * Modal stays as the fallback for hosts without react-native-screens, and
 * `forceModalOverlay` keeps it reachable if a host needs it.
 */
export function KokoHostOverlay({
  children,
  liftToken = 0,
  style,
  forceModalOverlay = false,
}: OverlayProps & { forceModalOverlay?: boolean }) {
  const { width, height } = useWindowDimensions();

  if (HostFullWindowOverlay && !forceModalOverlay) {
    return (
      // `bringToFrontToken` re-raises in place. Do not key off liftToken here:
      // liftChrome fires about once per step, and remounting a native overlay
      // that often leaves the progress pill mid-presentation and never visible.
      <HostFullWindowOverlay
        bringToFrontToken={liftToken}
        unstable_accessibilityContainerViewIsModal={false}
      >
        {/*
          FullWindowOverlay sets the frame on its native container rather than
          on itself, so its Yoga node measures 0x0 and `absoluteFillObject`
          (top/left/right/bottom: 0) collapses with it. Anything anchored with
          `bottom` then resolves against a zero-height box and lands above the
          top edge of the screen — the progress pill measured at y=-96. Size
          the layer explicitly so bottom-anchored chrome has a box to sit in.
        */}
        <KokoOverlayLayer
          pointerEvents="box-none"
          style={[{ width, height }, style]}
        >
          {children}
        </KokoOverlayLayer>
      </HostFullWindowOverlay>
    );
  }

  if (Platform.OS === 'android' && !forceModalOverlay) {
    // An RN Modal is its own window here too, which costs more than it buys:
    // it swallows the user's touches, and it becomes the front-most window, so
    // the SDK's own dump / tap would aim at the chrome instead of the host.
    // The provider renders this as the last sibling of the host tree, so a
    // plain absolute layer already paints over everything in the window.
    //
    // Size it explicitly for the same reason as the iOS branch: measured inside
    // a full-screen host root, `absoluteFillObject` still collapsed to height 0,
    // so bottom-anchored chrome sat below the screen and top-anchored chrome
    // (the cursor) landed a full screen height too low.
    return (
      <KokoOverlayLayer
        pointerEvents="box-none"
        style={[styles.androidLayer, { width, height }, style]}
      >
        {children}
      </KokoOverlayLayer>
    );
  }

  return (
    <Modal
      key={`koko-host-overlay-${liftToken}`}
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      presentationStyle={Platform.OS === 'ios' ? 'overFullScreen' : undefined}
      supportedOrientations={['portrait', 'landscape']}
    >
      <KokoOverlayLayer pointerEvents="box-none" style={[styles.fill, style]}>
        {children}
      </KokoOverlayLayer>
    </Modal>
  );
}

/** Whether this build can pierce native-stack modals via screens overlay. */
export function kokoHostOverlayUsesScreens(): boolean {
  return HostFullWindowOverlay != null;
}

const styles = StyleSheet.create({
  fill: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
  },
  // Anchor top-left and take the size from props: `right`/`bottom` and `zIndex`
  // both have to stay off. zIndex on a child of the host root stops the host's
  // own siblings from drawing at all on Android, and the layer is already the
  // last sibling, so it paints last without one.
  androidLayer: {
    position: 'absolute',
    left: 0,
    top: 0,
    backgroundColor: 'transparent',
  },
});
