#import "KokoAgentSdk.h"
#import "KokoScrollBounds.h"
#import "KokoOcrBounds.h"
#import <UIKit/UIKit.h>
#import <Vision/Vision.h>
#import <WebKit/WebKit.h>
#import <objc/runtime.h>

static UIWindow *KokoKeyWindow(void);
static NSArray<UIWindow *> *KokoAllWindowsFrontToBack(void);
static UIAlertController *KokoPresentedAlert(void);
static BOOL KokoWindowIsPrimarilyKokoChrome(UIWindow *w);
static UIWindow *KokoBestDumpWindow(void);
static BOOL KokoDispatchTapOnWindow(UIWindow *window, CGPoint point);
static void KokoDismissSystemAlerts(void);
static BOOL KokoInvokeAlertAction(UIAlertController *alert, UIAlertAction *action);
static BOOL KokoActivateAlertAtPoint(UIAlertController *alert, CGPoint pointInWindow);
static BOOL KokoInvokeAlertActionNamed(NSString *title);
static UIView *KokoFindLabeledSubview(UIView *root, NSString *title);
static NSDictionary *KokoAlertActionNode(UIAlertAction *action, NSInteger index, UIView *root, UIView *alertView);
static NSDictionary *KokoEnrichDumpWithAlert(NSDictionary *tree, UIView *root);
static NSString *KokoJoinPath(NSString *parent, NSInteger index);
static NSString *KokoOwnText(UIView *view);
static NSString *KokoAggregateText(UIView *view);
static BOOL KokoIsClickable(UIView *view);
static BOOL KokoIsOverlayMarked(UIView *view);
typedef NS_ENUM(NSInteger, KokoOverlayMuteMode) {
  KokoOverlayMuteInteraction = 1,
  KokoOverlayMuteVisibility = 2,
};
static void KokoCollectOverlayRoots(UIView *view, NSMutableArray<UIView *> *out, KokoOverlayMuteMode mode);
static void KokoPerformHidingOverlays(UIView *root, KokoOverlayMuteMode mode, void (^block)(void));
static NSDictionary *KokoDumpView(UIView *view, NSString *path, NSInteger depth, NSInteger maxDepth, BOOL skipInvisible, UIView *root);
static BOOL KokoDispatchTapAtPoint(UIWindow *window, CGPoint point);
static BOOL KokoSendSyntheticTouch(UIWindow *window, CGPoint point);
static BOOL KokoSendTouchToReactHandler(UIWindow *window, CGPoint point, UIView *target);
static void KokoSetTouchPhase(UITouch *touch, UITouchPhase phase);
static BOOL KokoFireTapGestures(UIView *from);
static UIEvent *KokoEventWithTouch(UITouch *touch);
static BOOL KokoSendSyntheticSwipe(UIWindow *window, CGPoint from, CGPoint to, NSTimeInterval duration);
static BOOL KokoDispatchSwipe(UIWindow *window, CGPoint from, CGPoint to);
static BOOL KokoSendSyntheticPinch(UIWindow *window, CGPoint center, CGFloat scale, NSTimeInterval duration);
static BOOL KokoDispatchPinch(UIWindow *window, CGPoint center, CGFloat scale, NSTimeInterval duration);
static UITouch *KokoMakeTouch(UIWindow *window, UIView *view, CGPoint pointInWindow);
static UIResponder *KokoFindFirstResponder(UIView *view);
static BOOL KokoLooksLikeTextInput(UIView *view);
static UIView *KokoFindEditableTextInput(UIView *view);
static UIView *KokoNearestTextInput(UIView *hit);
static BOOL KokoFocusTextInput(UIView *field);
static BOOL KokoTypeText(UIWindow *window, NSString *text, BOOL clear);

@implementation KokoAgentSdk

RCT_EXPORT_MODULE(KokoAgentSdk);

+ (BOOL)requiresMainQueueSetup
{
  return YES;
}

- (NSDictionary *)constantsToExport
{
  NSString *bundleId = [NSBundle mainBundle].bundleIdentifier ?: @"";
  return @{ @"hostAppId": bundleId };
}

- (dispatch_queue_t)methodQueue
{
  return dispatch_get_main_queue();
}

RCT_EXPORT_METHOD(dumpViewTree:(NSDictionary *)options
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  // Prefer the window hosting a system alert / action sheet when present.
  UIWindow *window = KokoBestDumpWindow();
  if (!window) {
    reject(@"no_window", @"No key window", nil);
    return;
  }
  NSInteger maxDepth = options[@"maxDepth"] ? [options[@"maxDepth"] integerValue] : 60;
  BOOL skipInvisible = options[@"skipInvisible"] == nil ? YES : [options[@"skipInvisible"] boolValue];
  NSDictionary *tree = KokoDumpView(window, @"0", 0, maxDepth, skipInvisible, window);
  tree = KokoEnrichDumpWithAlert(tree, window);
  resolve(tree ?: [NSNull null]);
}

RCT_EXPORT_METHOD(dispatchTap:(nonnull NSNumber *)x
                  y:(nonnull NSNumber *)y
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  CGPoint point = CGPointMake(x.doubleValue, y.doubleValue);

  // System Alert / ActionSheet: synthetic touches often no-op — invoke actions directly.
  UIAlertController *alert = KokoPresentedAlert();
  if (alert && KokoActivateAlertAtPoint(alert, point)) {
    resolve(nil);
    return;
  }

  // Try frontmost windows first so system alerts / sheets receive the tap.
  NSArray<UIWindow *> *windows = KokoAllWindowsFrontToBack();
  if (windows.count == 0) {
    UIWindow *key = KokoKeyWindow();
    if (!key) {
      reject(@"no_window", @"No key window", nil);
      return;
    }
    windows = @[key];
  }

  // Dismiss keyboard before tapping buttons/sheets (not when focusing a field).
  BOOL tappingField = NO;
  for (UIWindow *window in windows) {
    if (window.hidden) continue;
    UIView *hit = [window hitTest:point withEvent:nil];
    if (KokoNearestTextInput(hit)) {
      tappingField = YES;
      break;
    }
  }
  if (!tappingField) {
    for (UIWindow *w in windows) {
      [w endEditing:YES];
    }
  }

  for (UIWindow *window in windows) {
    if (window.hidden || window.alpha < 0.01) continue;
    if (KokoWindowIsPrimarilyKokoChrome(window)) continue;
    // React Native's surface handler cannot deliver a touch into WKWebView's
    // separate web process. Resolve the already-validated point inside the
    // actual web view and ask WebKit to activate only the element under it.
    __block WKWebView *web = nil;
    KokoPerformHidingOverlays(window, KokoOverlayMuteInteraction, ^{
      UIView *hit = [window hitTest:point withEvent:nil];
      for (UIView *v = hit; v; v = v.superview) {
        if ([v isKindOfClass:[WKWebView class]]) { web = (WKWebView *)v; break; }
      }
    });
    if (web && web.bounds.size.width > 0 && web.bounds.size.height > 0) {
      CGPoint local = [web convertPoint:point fromView:window];
      if (!CGRectContainsPoint(web.bounds, local)) {
        reject(@"web_target_invalid", @"Web target is outside the visible page", nil);
        return;
      }
      NSString *script = [NSString stringWithFormat:
        @"(function(){try{const x=%.8f*innerWidth,y=%.8f*innerHeight;"
         "let e=document.elementFromPoint(x,y);"
         "while(e&&e.shadowRoot){const c=e.shadowRoot.elementFromPoint(x,y);if(!c||c===e)break;e=c;}"
         "if(!e||e.tagName==='IFRAME'||e.tagName==='FRAME')return 'no_target';"
         "let t=e.closest('button,a,[role=button],[onclick],[tabindex]')||e;"
         "if(t.disabled||t.getAttribute('aria-disabled')==='true'||"
         "t.closest('input,textarea,select,[contenteditable=true]'))return 'no_target';"
         "const s=getComputedStyle(t),r=t.getBoundingClientRect();"
         "if(s.display==='none'||s.visibility==='hidden'||s.pointerEvents==='none'||"
         "r.width<=0||r.height<=0||x<r.left||x>r.right||y<r.top||y>r.bottom)return 'no_target';"
         "const label=(t.innerText||t.getAttribute('aria-label')||'').trim();"
         "if(/^(?:(?:approve|authorize|sign|confirm|allow|agree|accept)\\b|授权|批准|签名|签署|确认|允许|同意)/i.test(label))return 'handoff';"
         "t.click();return 'dispatched';}catch(_){return 'no_target';}})()",
         (double)(local.x / web.bounds.size.width), (double)(local.y / web.bounds.size.height)];
      [web evaluateJavaScript:script completionHandler:^(id result, NSError *error) {
        if (!error && [result isKindOfClass:[NSString class]] && [result isEqualToString:@"dispatched"]) {
          resolve(nil);
        } else {
          reject(@"web_tap_unavailable", @"Web target could not be safely activated; user may need to continue", error);
        }
      }];
      return;
    }
    if (KokoDispatchTapOnWindow(window, point)) {
      resolve(nil);
      return;
    }
  }
  reject(@"tap_failed", @"Could not dispatch tap at point", nil);
}

/** Read only public provider capability flags; never call eth_accounts. */
RCT_EXPORT_METHOD(inspectWebWalletProvider:(nonnull NSNumber *)x
                  y:(nonnull NSNumber *)y
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  CGPoint point = CGPointMake(x.doubleValue, y.doubleValue);
  for (UIWindow *window in KokoAllWindowsFrontToBack()) {
    if (window.hidden || window.alpha < 0.01 || KokoWindowIsPrimarilyKokoChrome(window)) continue;
    __block WKWebView *web = nil;
    KokoPerformHidingOverlays(window, KokoOverlayMuteInteraction, ^{
      UIView *hit = [window hitTest:point withEvent:nil];
      for (UIView *v = hit; v; v = v.superview) {
        if ([v isKindOfClass:[WKWebView class]]) { web = (WKWebView *)v; break; }
      }
    });
    if (!web) continue;
    NSString *script = @"(function(){try{const p=window.ethereum;return {present:!!p,hasRequest:!!p&&typeof p.request==='function',isMetaMask:!!p&&p.isMetaMask===true,isUKey:!!p&&p.isUKey===true};}catch(_){return {present:false};}})()";
    [web evaluateJavaScript:script completionHandler:^(id result, NSError *error) {
      if (!error && [result isKindOfClass:[NSDictionary class]]) resolve(result);
      else reject(@"provider_inspection_failed", @"Unable to inspect web provider capabilities", error);
    }];
    return;
  }
  reject(@"webview_not_found", @"No visible web view at point", nil);
}

/**
 * Invoke a presented UIAlertAction by button title (exact or unique substring).
 * Used when dump exposes synthetic UIAlertAction nodes — more reliable than hit-testing.
 */
RCT_EXPORT_METHOD(invokeAlertAction:(NSString *)title
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  if (!title.length) {
    reject(@"bad_title", @"title required", nil);
    return;
  }
  if (KokoInvokeAlertActionNamed(title)) {
    resolve(nil);
    return;
  }
  reject(@"alert_action_failed", [NSString stringWithFormat:@"No alert action matching '%@'", title], nil);
}

RCT_EXPORT_METHOD(dispatchSwipe:(nonnull NSNumber *)fromX
                  fromY:(nonnull NSNumber *)fromY
                  toX:(nonnull NSNumber *)toX
                  toY:(nonnull NSNumber *)toY
                  durationMs:(nonnull NSNumber *)durationMs
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  (void)durationMs;
  CGPoint from = CGPointMake(fromX.doubleValue, fromY.doubleValue);
  CGPoint to = CGPointMake(toX.doubleValue, toY.doubleValue);
  NSArray<UIWindow *> *windows = KokoAllWindowsFrontToBack();
  if (windows.count == 0) {
    UIWindow *window = KokoKeyWindow();
    if (!window) {
      reject(@"no_window", @"No key window", nil);
      return;
    }
    windows = @[window];
  }
  for (UIWindow *window in windows) {
    if (window.hidden || window.alpha < 0.01) continue;
    if (KokoDispatchSwipe(window, from, to)) {
      resolve(nil);
      return;
    }
  }
  reject(@"swipe_failed", @"Could not dispatch swipe", nil);
}

/**
 * Two-finger pinch at (x,y). scale>1 zoom in (fingers apart), scale<1 zoom out.
 */
RCT_EXPORT_METHOD(dispatchPinch:(nonnull NSNumber *)x
                  y:(nonnull NSNumber *)y
                  scale:(nonnull NSNumber *)scale
                  durationMs:(nonnull NSNumber *)durationMs
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  CGPoint center = CGPointMake(x.doubleValue, y.doubleValue);
  CGFloat s = scale.doubleValue;
  if (!(s > 0.05 && s < 20.0) || !isfinite(s)) {
    reject(@"bad_scale", @"scale must be a finite number around 0.05…20", nil);
    return;
  }
  NSTimeInterval dur = MAX(0.12, MIN(1.2, durationMs.doubleValue / 1000.0));
  NSArray<UIWindow *> *windows = KokoAllWindowsFrontToBack();
  if (windows.count == 0) {
    UIWindow *key = KokoKeyWindow();
    if (!key) {
      reject(@"no_window", @"No key window", nil);
      return;
    }
    windows = @[key];
  }
  for (UIWindow *window in windows) {
    if (window.hidden || window.alpha < 0.01) continue;
    if (KokoDispatchPinch(window, center, s, dur)) {
      resolve(nil);
      return;
    }
  }
  reject(@"pinch_failed", @"Could not dispatch pinch", nil);
}

RCT_EXPORT_METHOD(typeText:(NSString *)text
                  clear:(BOOL)clear
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  UIWindow *window = KokoKeyWindow();
  if (!window) {
    reject(@"no_window", @"No key window", nil);
    return;
  }
  if (!KokoTypeText(window, text ?: @"", clear)) {
    reject(@"no_focus", @"No focused text input", nil);
    return;
  }
  resolve(nil);
}

RCT_EXPORT_METHOD(focusNode:(NSString *)nodeId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  (void)nodeId;
  UIWindow *window = KokoKeyWindow();
  if (!window) {
    reject(@"no_window", @"No key window", nil);
    return;
  }
  UIView *field = KokoFindEditableTextInput(window);
  if (KokoFocusTextInput(field)) {
    resolve(nil);
    return;
  }
  reject(@"no_focus", @"No text input to focus", nil);
}

RCT_EXPORT_METHOD(focusAt:(nonnull NSNumber *)x
                  y:(nonnull NSNumber *)y
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  UIWindow *window = KokoKeyWindow();
  if (!window) {
    reject(@"no_window", @"No key window", nil);
    return;
  }
  CGPoint point = CGPointMake(x.doubleValue, y.doubleValue);
  __block BOOL ok = NO;
  KokoPerformHidingOverlays(window, KokoOverlayMuteInteraction, ^{
    UIView *hit = [window hitTest:point withEvent:nil];
    UIView *field = KokoNearestTextInput(hit) ?: KokoFindEditableTextInput(window);
    ok = KokoFocusTextInput(field);
  });
  if (ok) {
    resolve(nil);
    return;
  }
  reject(@"no_focus", @"No text input to focus at point", nil);
}

RCT_EXPORT_METHOD(dismissKeyboard:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  (void)reject;
  for (UIWindow *w in KokoAllWindowsFrontToBack()) {
    [w endEditing:YES];
  }
  resolve(nil);
}

/**
 * Formerly scrolled the nearest UIScrollView so (x,y) was visible.
 * Disabled: page-level ScrollViews (home / onboarding) would jump and look
 * like a secret swipe before every tap. Scrolling is an explicit swipe tool.
 */
RCT_EXPORT_METHOD(scrollIntoView:(nonnull NSNumber *)x
                  y:(nonnull NSNumber *)y
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  (void)x;
  (void)y;
  (void)reject;
  resolve(nil);
}

RCT_EXPORT_METHOD(captureScreenshot:(NSDictionary *)options
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  UIWindow *window = KokoKeyWindow();
  if (!window) {
    reject(@"no_window", @"No key window", nil);
    return;
  }
  BOOL hideOverlays = options[@"hideOverlays"] == nil ? YES : [options[@"hideOverlays"] boolValue];

  void (^doCapture)(void) = ^{
    CGSize size = window.bounds.size;
    if (size.width < 1 || size.height < 1) {
      reject(@"screenshot_failed", @"Invalid window size", nil);
      return;
    }
    UIGraphicsBeginImageContextWithOptions(size, NO, 0);
    BOOL ok = [window drawViewHierarchyInRect:window.bounds afterScreenUpdates:YES];
    UIImage *image = UIGraphicsGetImageFromCurrentImageContext();
    UIGraphicsEndImageContext();
    if (!ok || !image) {
      reject(@"screenshot_failed", @"Could not render window", nil);
      return;
    }
    NSData *data = UIImagePNGRepresentation(image);
    if (!data) {
      reject(@"screenshot_failed", @"PNG encode failed", nil);
      return;
    }
    NSString *b64 = [data base64EncodedStringWithOptions:0];
    resolve(@{
      @"pngBase64": b64 ?: @"",
      @"width": @(image.size.width),
      @"height": @(image.size.height),
      @"scale": @(image.scale),
    });
  };

  if (hideOverlays) {
    KokoPerformHidingOverlays(window, KokoOverlayMuteVisibility, ^{
      doCapture();
    });
  } else {
    doCapture();
  }
}

/**
 * On-device OCR via Vision framework (Apple's Core ML text-recognition models).
 * Returns compact tokens for JS ranking / planner screen-model enrichment.
 */
RCT_EXPORT_METHOD(recognizeScreenText:(NSDictionary *)options
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  UIWindow *window = KokoKeyWindow();
  if (!window) {
    reject(@"no_window", @"No key window", nil);
    return;
  }
  BOOL hideOverlays = options[@"hideOverlays"] == nil ? YES : [options[@"hideOverlays"] boolValue];
  NSInteger maxTokens = options[@"maxTokens"] ? [options[@"maxTokens"] integerValue] : 24;
  if (maxTokens < 1) maxTokens = 24;
  if (maxTokens > 64) maxTokens = 64;
  NSArray *langOpt = [options[@"languages"] isKindOfClass:[NSArray class]] ? options[@"languages"] : nil;

  void (^finishEmpty)(NSString *) = ^(NSString *backend) {
    resolve(@{
      @"tokens": @[],
      @"texts": @[],
      @"backend": backend ?: @"unavailable",
    });
  };

  void (^doCapture)(void) = ^{
    CGSize size = window.bounds.size;
    if (size.width < 1 || size.height < 1) {
      finishEmpty(@"unavailable");
      return;
    }
    UIGraphicsBeginImageContextWithOptions(size, NO, 0);
    // Cursor/chrome were just hidden above. Flush that visibility change into
    // the snapshot before Vision reads it, then restore the live UI immediately.
    BOOL ok = [window drawViewHierarchyInRect:window.bounds afterScreenUpdates:YES];
    UIImage *image = UIGraphicsGetImageFromCurrentImageContext();
    UIGraphicsEndImageContext();
    if (!ok || !image || !image.CGImage) {
      finishEmpty(@"unavailable");
      return;
    }

    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
      VNImageRequestHandler *handler =
        [[VNImageRequestHandler alloc] initWithCGImage:image.CGImage options:@{}];
      VNRecognizeTextRequest *request =
        [[VNRecognizeTextRequest alloc] initWithCompletionHandler:nil];
      if (@available(iOS 16.0, *)) {
        request.recognitionLevel = VNRequestTextRecognitionLevelAccurate;
        request.usesLanguageCorrection = YES;
      } else {
        request.recognitionLevel = VNRequestTextRecognitionLevelFast;
      }
      if (langOpt.count > 0) {
        NSMutableArray<NSString *> *langs = [NSMutableArray array];
        for (id L in langOpt) {
          if ([L isKindOfClass:[NSString class]] && [(NSString *)L length] > 0) {
            [langs addObject:(NSString *)L];
          }
        }
        if (langs.count > 0) {
          request.recognitionLanguages = langs;
        }
      } else {
        // Host-agnostic defaults: CJK + Latin (no product-specific copy).
        request.recognitionLanguages = @[ @"zh-Hans", @"zh-Hant", @"en-US" ];
      }

      NSError *err = nil;
      BOOL ocrOk = [handler performRequests:@[ request ] error:&err];
      NSMutableArray *texts = [NSMutableArray array];
      NSMutableOrderedSet<NSString *> *tokenSet = [NSMutableOrderedSet orderedSet];
      NSString *backend = ocrOk ? @"vision" : @"vision_error";
      if (ocrOk) {
        for (VNRecognizedTextObservation *obs in request.results) {
          VNRecognizedText *top = [[obs topCandidates:1] firstObject];
          if (!top || top.string.length == 0) continue;
          NSString *raw = [top.string stringByTrimmingCharactersInSet:
                             [NSCharacterSet whitespaceAndNewlineCharacterSet]];
          if (raw.length == 0) continue;
          // Vision uses normalized coordinates with a bottom-left origin;
          // the JS/native touch bridge uses window points with a top-left origin.
          CGRect bounds = obs.boundingBox;
          KokoOcrFrame frame;
          NSMutableDictionary *entry = [@{ @"text": raw, @"confidence": @((float)top.confidence) } mutableCopy];
          if (KokoOcrWindowFrame(bounds.origin.x, bounds.origin.y, bounds.size.width, bounds.size.height,
                                 size.width, size.height, &frame)) {
            entry[@"frame"] = @{@"x": @(frame.x), @"y": @(frame.y),
                                 @"width": @(frame.width), @"height": @(frame.height)};
          }
          [texts addObject:entry];
          NSRegularExpression *re =
            [NSRegularExpression regularExpressionWithPattern:@"[A-Za-z0-9_]{2,}|[\\u4e00-\\u9fff]{2,8}"
                                                     options:0
                                                       error:nil];
          NSArray<NSTextCheckingResult *> *matches =
            [re matchesInString:raw options:0 range:NSMakeRange(0, raw.length)];
          for (NSTextCheckingResult *m in matches) {
            NSString *tok = [raw substringWithRange:m.range];
            if (tok.length >= 2) [tokenSet addObject:tok];
            if ((NSInteger)tokenSet.count >= maxTokens) break;
          }
          // The token budget must not discard later positioned text, such as
          // a button following a long page heading.
          if (texts.count >= 64) break;
        }
      }
      NSArray *tokens = tokenSet.array;
      if ((NSInteger)tokens.count > maxTokens) {
        tokens = [tokens subarrayWithRange:NSMakeRange(0, (NSUInteger)maxTokens)];
      }
      NSDictionary *payload = @{
        @"tokens": tokens ?: @[],
        @"texts": texts,
        @"backend": backend,
      };
      dispatch_async(dispatch_get_main_queue(), ^{
        resolve(payload);
      });
    });
  };

  if (hideOverlays) {
    KokoPerformHidingOverlays(window, KokoOverlayMuteVisibility, ^{
      doCapture();
    });
  } else {
    doCapture();
  }
}

@end

#pragma mark - C helpers

static UIWindow *KokoKeyWindow(void)
{
  if (@available(iOS 13.0, *)) {
    for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
      if (scene.activationState != UISceneActivationStateForegroundActive) continue;
      if (![scene isKindOfClass:[UIWindowScene class]]) continue;
      UIWindowScene *windowScene = (UIWindowScene *)scene;
      for (UIWindow *window in windowScene.windows) {
        if (window.isKeyWindow) return window;
      }
      if (windowScene.windows.count > 0) return windowScene.windows.firstObject;
    }
  }
  return UIApplication.sharedApplication.keyWindow;
}

static NSArray<UIWindow *> *KokoAllWindowsFrontToBack(void)
{
  NSMutableArray<UIWindow *> *windows = [NSMutableArray array];
  if (@available(iOS 13.0, *)) {
    for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
      if (scene.activationState == UISceneActivationStateUnattached) continue;
      if (![scene isKindOfClass:[UIWindowScene class]]) continue;
      [windows addObjectsFromArray:((UIWindowScene *)scene).windows];
    }
  }
  if (windows.count == 0) {
    for (UIWindow *w in UIApplication.sharedApplication.windows) {
      [windows addObject:w];
    }
  }
  [windows sortUsingComparator:^NSComparisonResult(UIWindow *a, UIWindow *b) {
    if (a.windowLevel > b.windowLevel) return NSOrderedAscending;
    if (a.windowLevel < b.windowLevel) return NSOrderedDescending;
    // Later in array is typically more recently added / front.
    return NSOrderedSame;
  }];
  return windows;
}

static UIAlertController *KokoPresentedAlert(void)
{
  for (UIWindow *w in KokoAllWindowsFrontToBack()) {
    if (w.hidden || w.alpha < 0.01) continue;
    UIViewController *vc = w.rootViewController;
    // Walk presented stack.
    while (vc.presentedViewController) {
      vc = vc.presentedViewController;
    }
    if ([vc isKindOfClass:[UIAlertController class]]) {
      return (UIAlertController *)vc;
    }
    // Some alert hosts use the alert as the window root.
    if ([w.rootViewController isKindOfClass:[UIAlertController class]]) {
      return (UIAlertController *)w.rootViewController;
    }
    // Child VCs (rare shim presenters).
    for (UIViewController *child in vc.childViewControllers) {
      if ([child isKindOfClass:[UIAlertController class]]) {
        return (UIAlertController *)child;
      }
    }
  }
  return nil;
}

static BOOL KokoWindowIsPrimarilyKokoChrome(UIWindow *w)
{
  UIView *root = w.rootViewController.view ?: w;
  __block BOOL foundKoko = NO;
  __block BOOL foundHost = NO;
  __block __weak void (^walkWeak)(UIView *, NSInteger);
  void (^walk)(UIView *, NSInteger) = ^(UIView *view, NSInteger depth) {
    if (!view || depth > 14 || foundHost) return;
    if (KokoIsOverlayMarked(view)) {
      foundKoko = YES;
      return;
    }
    NSString *aid = view.accessibilityIdentifier;
    if (aid.length > 0 && ![aid hasPrefix:@"koko-agent-"]) {
      foundHost = YES;
      return;
    }
    if (view.accessibilityLabel.length > 0) {
      foundHost = YES;
      return;
    }
    // Native controls imply host UI (ignore empty RCT wrappers).
    if ([view isKindOfClass:[UIControl class]] ||
        [view isKindOfClass:[UILabel class]] ||
        [view isKindOfClass:[UIImageView class]]) {
      if (view.frame.size.width > 2 && view.frame.size.height > 2 && !view.hidden) {
        // Cursor ImageView lives under koko mark — already returned above.
        foundHost = YES;
        return;
      }
    }
    for (UIView *child in view.subviews) {
      walkWeak(child, depth + 1);
      if (foundHost) return;
    }
  };
  walkWeak = walk;
  walk(root, 0);
  return foundKoko && !foundHost;
}

static UIWindow *KokoBestDumpWindow(void)
{
  UIAlertController *alert = KokoPresentedAlert();
  if (alert.view.window) return alert.view.window;
  // Highest visible window that is not keyboard / koko-only chrome (cursor Modal).
  for (UIWindow *w in KokoAllWindowsFrontToBack()) {
    if (w.hidden || w.alpha < 0.01) continue;
    NSString *cls = NSStringFromClass(w.class);
    if ([cls containsString:@"UITextEffects"] || [cls containsString:@"UIRemoteKeyboard"]) continue;
    if (KokoWindowIsPrimarilyKokoChrome(w)) continue;
    return w;
  }
  return KokoKeyWindow();
}

/** Invoke a UIAlertAction handler (RN Alert.alert / UIKit). */
static void (^KokoAlertActionHandler(UIAlertAction *action))(UIAlertAction *)
{
  if (!action) return nil;
  const char *names[] = { "_handler", "handler", NULL };
  for (const char **p = names; *p; p++) {
    Ivar ivar = class_getInstanceVariable(object_getClass(action), *p);
    if (!ivar) {
      ivar = class_getInstanceVariable([UIAlertAction class], *p);
    }
    if (ivar) {
      id block = object_getIvar(action, ivar);
      if (block != nil && block != [NSNull null]) {
        return (void (^)(UIAlertAction *))block;
      }
    }
  }
  @try {
    id handler = [action valueForKey:@"handler"];
    if (handler != nil && handler != [NSNull null]) {
      return (void (^)(UIAlertAction *))handler;
    }
  } @catch (__unused NSException *e) {
  }
  @try {
    id handler = [action valueForKey:@"_handler"];
    if (handler != nil && handler != [NSNull null]) {
      return (void (^)(UIAlertAction *))handler;
    }
  } @catch (__unused NSException *e) {
  }
  return nil;
}

static BOOL KokoInvokeAlertAction(UIAlertController *alert, UIAlertAction *action)
{
  if (!alert || !action) return NO;
  void (^handler)(UIAlertAction *) = KokoAlertActionHandler(action);

  // Call handler first — dismiss completion is unreliable / sometimes never fires.
  if (handler) {
    handler(action);
  }

  UIViewController *presenter = alert.presentingViewController;
  if (presenter) {
    [presenter dismissViewControllerAnimated:YES completion:nil];
  } else if (alert.presentingViewController == nil && alert.view.window) {
    // Presented as window root / shim — dismiss from self if possible.
    [alert dismissViewControllerAnimated:YES completion:nil];
  }
  return YES;
}

static BOOL KokoInvokeAlertActionNamed(NSString *title)
{
  UIAlertController *alert = KokoPresentedAlert();
  if (!alert || !title.length) return NO;

  // Prefer exact title match.
  for (UIAlertAction *action in alert.actions) {
    if (action.title.length && [action.title isEqualToString:title]) {
      return KokoInvokeAlertAction(alert, action);
    }
  }

  // Unique substring: title contains action.title (e.g. "确认清空" → "清空").
  UIAlertAction *unique = nil;
  NSInteger hits = 0;
  for (UIAlertAction *action in alert.actions) {
    if (!action.title.length) continue;
    if ([title containsString:action.title] || [action.title containsString:title]) {
      unique = action;
      hits += 1;
    }
  }
  if (hits == 1 && unique) {
    return KokoInvokeAlertAction(alert, unique);
  }

  // Prefer destructive / default over cancel when title looks affirmative.
  if ([title containsString:@"清空"] || [title containsString:@"删除"] ||
      [title containsString:@"确定"] || [title containsString:@"确认"] ||
      [title.lowercaseString containsString:@"ok"] || [title containsString:@"好"]) {
    for (UIAlertAction *action in alert.actions) {
      if (action.style == UIAlertActionStyleCancel) continue;
      if (action.title.length) {
        return KokoInvokeAlertAction(alert, action);
      }
    }
  }
  if ([title containsString:@"取消"] || [title.lowercaseString containsString:@"cancel"]) {
    for (UIAlertAction *action in alert.actions) {
      if (action.style == UIAlertActionStyleCancel) {
        return KokoInvokeAlertAction(alert, action);
      }
    }
  }
  return NO;
}

static UIView *KokoFindLabeledSubview(UIView *root, NSString *title)
{
  if (!root || !title.length) return nil;
  NSString *own = root.accessibilityLabel ?: KokoOwnText(root);
  if ([own isEqualToString:title]) return root;
  for (UIView *child in root.subviews) {
    UIView *hit = KokoFindLabeledSubview(child, title);
    if (hit) return hit;
  }
  return nil;
}

static CGRect KokoAlertActionFrame(UIAlertController *alert, UIAlertAction *action, NSInteger index, UIWindow *window)
{
  UIView *btn = KokoFindLabeledSubview(alert.view, action.title);
  CGRect alertB = [alert.view convertRect:alert.view.bounds toView:window];
  if (btn) {
    CGRect frame = [btn convertRect:btn.bounds toView:window];
    // Expand to full alert width — labels are smaller than the tappable row.
    frame = CGRectMake(CGRectGetMinX(alertB),
                       CGRectGetMinY(frame) - 8,
                       CGRectGetWidth(alertB),
                       MAX(44.0, CGRectGetHeight(frame) + 16));
    return frame;
  }
  CGFloat h = 48;
  return CGRectMake(CGRectGetMinX(alertB),
                    CGRectGetMaxY(alertB) - h * (index + 1) - 8,
                    CGRectGetWidth(alertB),
                    h);
}

/**
 * Activate the alert button under `point`.
 * Do NOT trust accessibilityActivate alone — it often returns YES with no effect.
 */
static BOOL KokoActivateAlertAtPoint(UIAlertController *alert, CGPoint pointInWindow)
{
  if (!alert) return NO;
  UIWindow *window = alert.view.window;
  if (!window) return NO;

  // 1) Exact geometry → matching UIAlertAction.
  NSInteger index = 0;
  UIAlertAction *closest = nil;
  CGFloat closestDist = CGFLOAT_MAX;
  for (UIAlertAction *action in alert.actions) {
    if (!action.title.length) {
      index += 1;
      continue;
    }
    CGRect frame = KokoAlertActionFrame(alert, action, index, window);
    if (CGRectContainsPoint(frame, pointInWindow)) {
      return KokoInvokeAlertAction(alert, action);
    }
    CGPoint c = CGPointMake(CGRectGetMidX(frame), CGRectGetMidY(frame));
    CGFloat d = hypot(c.x - pointInWindow.x, c.y - pointInWindow.y);
    if (d < closestDist) {
      closestDist = d;
      closest = action;
    }
    index += 1;
  }

  // 2) Exact / unique label from hit-test view.
  UIView *hit = [window hitTest:pointInWindow withEvent:nil];
  NSString *label = nil;
  for (UIView *v = hit; v; v = v.superview) {
    if (v.accessibilityLabel.length) {
      label = v.accessibilityLabel;
      break;
    }
    NSString *t = KokoOwnText(v);
    if (t.length) {
      label = t;
      break;
    }
    if (v == alert.view) break;
  }
  if (label.length && KokoInvokeAlertActionNamed(label)) {
    return YES;
  }

  // 3) Closest action button if tap is on the alert card.
  CGRect alertFrame = [alert.view convertRect:alert.view.bounds toView:window];
  if (closest && closestDist < 100 && CGRectContainsPoint(CGRectInset(alertFrame, -20, -20), pointInWindow)) {
    return KokoInvokeAlertAction(alert, closest);
  }
  return NO;
}

static NSDictionary *KokoAlertActionNode(UIAlertAction *action, NSInteger index, UIView *root, UIView *alertView)
{
  if (!action.title.length || !alertView) return nil;
  UIView *btn = KokoFindLabeledSubview(alertView, action.title);
  CGRect af = [alertView convertRect:alertView.bounds toView:root];
  CGRect frame;
  if (btn) {
    frame = [btn convertRect:btn.bounds toView:root];
    frame = CGRectMake(CGRectGetMinX(af), CGRectGetMinY(frame) - 8,
                       CGRectGetWidth(af), MAX(44.0, CGRectGetHeight(frame) + 16));
  } else {
    CGFloat h = 48;
    frame = CGRectMake(CGRectGetMinX(af) + 8,
                       CGRectGetMaxY(af) - h * (index + 1) - 8,
                       MAX(80, CGRectGetWidth(af) - 16),
                       h);
  }
  return @{
    @"id": [NSString stringWithFormat:@"alert/action/%ld", (long)index],
    @"type": @"UIAlertAction",
    @"frame": @{
      @"x": @(frame.origin.x),
      @"y": @(frame.origin.y),
      @"width": @(MAX(1, frame.size.width)),
      @"height": @(MAX(1, frame.size.height)),
    },
    @"text": action.title,
    @"accessibilityLabel": action.title,
    @"clickable": @YES,
    @"enabled": @YES,
    @"visible": @YES,
    @"sheet": @YES,
    @"children": @[],
  };
}

/** Ensure alert buttons appear as [sheet] affordances even when view text is nested deep. */
static NSDictionary *KokoEnrichDumpWithAlert(NSDictionary *tree, UIView *root)
{
  UIAlertController *alert = KokoPresentedAlert();
  if (!alert || !tree || ![tree isKindOfClass:[NSDictionary class]]) return tree;

  NSMutableArray *extra = [NSMutableArray array];
  NSInteger i = 0;
  for (UIAlertAction *action in alert.actions) {
    // Build frame against dump root directly.
    UIView *btn = KokoFindLabeledSubview(alert.view, action.title);
    CGRect frame;
    CGRect af = [alert.view convertRect:alert.view.bounds toView:root];
    if (btn) {
      frame = [btn convertRect:btn.bounds toView:root];
      frame = CGRectMake(CGRectGetMinX(af), CGRectGetMinY(frame) - 8,
                         CGRectGetWidth(af), MAX(44.0, CGRectGetHeight(frame) + 16));
    } else {
      CGFloat h = 48;
      frame = CGRectMake(CGRectGetMinX(af) + 8,
                         CGRectGetMaxY(af) - h * (i + 1) - 8,
                         MAX(80, CGRectGetWidth(af) - 16),
                         h);
    }
    [extra addObject:@{
      @"id": [NSString stringWithFormat:@"alert/action/%ld", (long)i],
      @"type": @"UIAlertAction",
      @"frame": @{
        @"x": @(frame.origin.x),
        @"y": @(frame.origin.y),
        @"width": @(MAX(1, frame.size.width)),
        @"height": @(MAX(1, frame.size.height)),
      },
      @"text": action.title ?: @"",
      @"accessibilityLabel": action.title ?: @"",
      @"clickable": @YES,
      @"enabled": @YES,
      @"visible": @YES,
      @"sheet": @YES,
      @"children": @[],
    }];
    i += 1;
  }
  // Title / message as non-clickable context only.
  if (alert.title.length || alert.message.length) {
    CGRect af = [alert.view convertRect:alert.view.bounds toView:root];
    NSString *msg = alert.title.length && alert.message.length
        ? [NSString stringWithFormat:@"%@ — %@", alert.title, alert.message]
        : (alert.title ?: alert.message);
    [extra insertObject:@{
      @"id": @"alert/header",
      @"type": @"UIAlertController.Header",
      @"frame": @{
        @"x": @(af.origin.x),
        @"y": @(af.origin.y),
        @"width": @(MAX(1, af.size.width)),
        @"height": @(MAX(1, af.size.height * 0.35)),
      },
      @"text": msg ?: @"",
      @"accessibilityLabel": msg ?: @"",
      @"clickable": @NO,
      @"enabled": @YES,
      @"visible": @YES,
      @"sheet": @YES,
      @"children": @[],
    } atIndex:0];
  }
  if (extra.count == 0) return tree;

  NSMutableDictionary *out = [tree mutableCopy];
  NSMutableArray *children = [out[@"children"] mutableCopy] ?: [NSMutableArray array];
  NSIndexSet *idx = [NSIndexSet indexSetWithIndexesInRange:NSMakeRange(0, extra.count)];
  [children insertObjects:extra atIndexes:idx];
  out[@"children"] = children;
  return out;
}

/** Optional helper — not used on dump path (Agent should tap 好/取消). */
static void KokoDismissSystemAlerts(void)
{
  for (UIWindow *w in KokoAllWindowsFrontToBack()) {
    UIViewController *vc = w.rootViewController;
    while (vc.presentedViewController) {
      vc = vc.presentedViewController;
    }
    if ([vc isKindOfClass:[UIAlertController class]] && vc.presentingViewController) {
      [vc.presentingViewController dismissViewControllerAnimated:NO completion:nil];
    }
  }
}

static NSString *KokoJoinPath(NSString *parent, NSInteger index)
{
  if (parent.length == 0) return [NSString stringWithFormat:@"%ld", (long)index];
  return [NSString stringWithFormat:@"%@/%ld", parent, (long)index];
}

static NSString *KokoStringFromUnknown(id value)
{
  if ([value isKindOfClass:[NSString class]]) {
    return ((NSString *)value).length ? (NSString *)value : @"";
  }
  if ([value isKindOfClass:[NSAttributedString class]]) {
    NSString *s = [(NSAttributedString *)value string];
    return s.length ? s : @"";
  }
  if ([value isKindOfClass:[NSTextStorage class]]) {
    NSString *s = [(NSTextStorage *)value string];
    return s.length ? s : @"";
  }
  return @"";
}

/** Try common RN Fabric / TextKit KVC keys (private APIs vary by RN version). */
static NSString *KokoTextViaKVC(UIView *view)
{
  static NSString * const kKeys[] = {
    @"attributedText", @"text", @"textStorage", @"_textStorage",
    @"attributedString", @"_attributedString", @"content", @"_content",
  };
  for (size_t i = 0; i < sizeof(kKeys) / sizeof(kKeys[0]); i++) {
    @try {
      NSString *s = KokoStringFromUnknown([view valueForKey:kKeys[i]]);
      if (s.length) return s;
    } @catch (__unused NSException *e) {
    }
  }
  @try {
    id content = [view valueForKey:@"_contentData"];
    if (content) {
      NSString *s = KokoStringFromUnknown([content valueForKey:@"attributedString"]);
      if (s.length) return s;
      s = KokoStringFromUnknown([content valueForKey:@"text"]);
      if (s.length) return s;
    }
  } @catch (__unused NSException *e) {
  }
  return @"";
}

static NSString *KokoOwnText(UIView *view)
{
  if (([view isKindOfClass:[UITextField class]] && ((UITextField *)view).secureTextEntry) ||
      ([view isKindOfClass:[UITextView class]] && ((UITextView *)view).secureTextEntry)) return @"[redacted]";
  if ([view isKindOfClass:[UILabel class]]) return ((UILabel *)view).text ?: @"";
  if ([view isKindOfClass:[UIButton class]]) {
    NSString *t = [((UIButton *)view) titleForState:UIControlStateNormal];
    return t ?: @"";
  }
  if ([view isKindOfClass:[UITextField class]]) {
    UITextField *f = (UITextField *)view;
    return f.text.length ? f.text : (f.placeholder ?: @"");
  }
  if ([view isKindOfClass:[UITextView class]]) return ((UITextView *)view).text ?: @"";

  // Prefer explicit a11y label when hosts set it (Tamagui / Pressable).
  // IMPORTANT: call even when isAccessibilityElement=NO — Fabric Paragraph
  // overrides accessibilityLabel to return attributedText.string.
  @try {
    NSString *lab = view.accessibilityLabel;
    if (lab.length) return lab;
  } @catch (__unused NSException *e) {
  }

  // React Native Fabric text is NOT UILabel — Paragraph / Text / TextView.
  NSString *cls = NSStringFromClass(view.class);
  if ([cls containsString:@"Paragraph"] ||
      [cls containsString:@"RCTText"] ||
      [cls containsString:@"TextShadow"] ||
      [cls containsString:@"TextView"] ||
      [cls containsString:@"TextInput"] ||
      [cls containsString:@"RawText"]) {
    // Prefer the real attributedText getter when present (RN Fabric).
    if ([view respondsToSelector:@selector(attributedText)]) {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Warc-performSelector-leaks"
      id attr = [view performSelector:@selector(attributedText)];
#pragma clang diagnostic pop
      NSString *s = KokoStringFromUnknown(attr);
      if (s.length) return s;
    }
    NSString *kvc = KokoTextViaKVC(view);
    if (kvc.length) return kvc;
  }

  // Accessibility container children (Fabric sometimes exposes text only here).
  @try {
    NSArray *els = view.accessibilityElements;
    if ([els isKindOfClass:[NSArray class]]) {
      for (id el in els) {
        if ([el respondsToSelector:@selector(accessibilityLabel)]) {
          NSString *lab = [el accessibilityLabel];
          if (lab.length) return lab;
        }
      }
    }
  } @catch (__unused NSException *e) {
  }

  // Last resort: any view with an attributedText property.
  if ([view respondsToSelector:@selector(attributedText)]) {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Warc-performSelector-leaks"
    id attr = [view performSelector:@selector(attributedText)];
#pragma clang diagnostic pop
    NSString *s = KokoStringFromUnknown(attr);
    if (s.length) return s;
  }

  return @"";
}

/** Collect labels up to `maxDepth` levels (Fabric nests text under wrappers). */
static NSString *KokoAggregateTextDepth(UIView *view, NSInteger maxDepth)
{
  if (maxDepth < 0 || view.hidden || view.alpha < 0.01 || KokoIsOverlayMarked(view)) return @"";
  NSString *own = KokoOwnText(view);
  if (own.length) return own;
  NSMutableArray<NSString *> *parts = [NSMutableArray array];
  for (UIView *child in view.subviews) {
    NSString *t = KokoAggregateTextDepth(child, maxDepth - 1);
    if (t.length) [parts addObject:t];
    if (parts.count >= 6) break;
  }
  if (!parts.count) return @"";
  return [[parts componentsJoinedByString:@" "]
      stringByReplacingOccurrencesOfString:@"  "
                                 withString:@" "];
}

static NSString *KokoAggregateText(UIView *view)
{
  // Depth 5 covers deep Tamagui stacks: Pressable → XStack → … → Paragraph.
  return KokoAggregateTextDepth(view, 5);
}

/** Structural chrome / scroll hosts — never treat as tap targets. */
static BOOL KokoIsSystemSheetClass(NSString *cls)
{
  if (!cls.length) return NO;
  static NSString * const kSheet[] = {
    @"AlertController", @"AlertAction", @"ActionSheet",
    @"UIInterfaceAction", @"ActivityViewController", @"ActivityGroupView",
    @"UIActivity", @"ContextMenu", @"_UIContextMenu", @"UIPopover",
    @"UIMenu", @"UIEditMenu", @"PKIssuer", // wallet sheets still in-app when presented
  };
  for (size_t i = 0; i < sizeof(kSheet) / sizeof(kSheet[0]); i++) {
    if ([cls containsString:kSheet[i]]) return YES;
  }
  return NO;
}

static BOOL KokoIsChromeView(UIView *view)
{
  NSString *cls = NSStringFromClass(view.class);
  // System sheets / menus / share panels must remain traversable & tappable.
  if (KokoIsSystemSheetClass(cls)) return NO;
  if ([view isKindOfClass:[UIWindow class]]) return YES;
  if ([view isKindOfClass:[UIScrollView class]]) return YES;
  static NSString * const kChrome[] = {
    @"UITransition", @"UIDropShadow", @"UILayoutContainer",
    @"RCTSurface", @"RCTRoot", @"RCTSafeArea", @"RCTScroll",
    @"RCTEnhancedScroll", @"RCTDebugging", @"RCTTouchHandler",
    @"_UI",
  };
  for (size_t i = 0; i < sizeof(kChrome) / sizeof(kChrome[0]); i++) {
    if ([cls containsString:kChrome[i]]) return YES;
  }
  return NO;
}

static BOOL KokoHasTapGesture(UIView *view)
{
  for (UIGestureRecognizer *g in view.gestureRecognizers) {
    if (!g.enabled) continue;
    // Pan/pinch on scroll views must NOT count as clickable.
    if ([g isKindOfClass:[UITapGestureRecognizer class]]) return YES;
  }
  return NO;
}

/**
 * RN New Arch Pressable → RCTViewComponentView (class name has no "Pressable").
 * Detect via accessibility button trait / labeled accessibility element.
 */
static BOOL KokoIsClickable(UIView *view)
{
  // Tap uses screen coordinates + hitTest on ancestors — labeled children may have
  // userInteractionEnabled=NO while the parent Pressable receives the touch.
  if (view.hidden || view.alpha < 0.01) return NO;

  NSString *cls = NSStringFromClass(view.class);
  if (KokoIsSystemSheetClass(cls)) return YES;

  UIAccessibilityTraits traits = view.accessibilityTraits;
  // A11y button/link/adjustable — even when interaction is on a parent wrapper.
  if ((traits & UIAccessibilityTraitButton) ||
      (traits & UIAccessibilityTraitLink) ||
      (traits & UIAccessibilityTraitAdjustable)) {
    return YES;
  }

  // Common interactive UIKit controls (excl. secure handling — done in JS).
  if ([view isKindOfClass:[UISwitch class]] ||
      [view isKindOfClass:[UISlider class]] ||
      [view isKindOfClass:[UIStepper class]] ||
      [view isKindOfClass:[UISegmentedControl class]] ||
      [view isKindOfClass:[UIPickerView class]] ||
      [view isKindOfClass:[UIDatePicker class]] ||
      [view isKindOfClass:[UITableViewCell class]] ||
      [view isKindOfClass:[UICollectionViewCell class]]) {
    return YES;
  }

  if (KokoIsChromeView(view)) return NO;

  if ([view isKindOfClass:[UIControl class]]) {
    return ((UIControl *)view).enabled;
  }

  if (view.userInteractionEnabled && KokoHasTapGesture(view)) return YES;

  // Static text / headers are not tap targets even if labeled.
  if ((traits & UIAccessibilityTraitStaticText) || (traits & UIAccessibilityTraitHeader)) {
    return NO;
  }

  if ([cls containsString:@"Touchable"] ||
      [cls containsString:@"Pressable"] ||
      [cls containsString:@"Button"] ||
      [cls containsString:@"Switch"] ||
      [cls containsString:@"Checkbox"] ||
      [cls containsString:@"Picker"] ||
      [cls containsString:@"Segment"]) {
    return YES;
  }

  BOOL isRnView =
      [cls containsString:@"RCTView"] || [cls containsString:@"ComponentView"];
  BOOL isTextish =
      [cls containsString:@"Paragraph"] ||
      [cls containsString:@"TextInput"] ||
      [cls containsString:@"Text"];

  // Fabric Pressable / Tamagui: labeled RCTView* (a11y often on the press target).
  if (isRnView && !isTextish && view.accessibilityLabel.length > 0) {
    CGFloat area = view.bounds.size.width * view.bounds.size.height;
    if (area > 0 && area <= 500 * 800) return YES;
  }

  // Host testIDs / a11y ids often mark real buttons when traits are missing.
  NSString *aid = view.accessibilityIdentifier;
  if (aid.length && view.userInteractionEnabled) {
    NSString *low = aid.lowercaseString;
    if ([low containsString:@"button"] ||
        [low containsString:@"btn"] ||
        [low containsString:@"create"] ||
        [low containsString:@"empty-wallet"] ||
        [low containsString:@"add-wallet"] ||
        [low containsString:@"pressable"] ||
        [low containsString:@"touchable"]) {
      return YES;
    }
  }

  // isAccessibilityElement + short label without StaticText trait → often a tab/icon button.
  if (view.isAccessibilityElement &&
      view.accessibilityLabel.length > 0 &&
      view.accessibilityLabel.length <= 64 &&
      !isTextish) {
    CGFloat area = view.bounds.size.width * view.bounds.size.height;
    if (area > 0 && area <= 420 * 420) return YES;
  }

  // Tamagui / Fabric hosts often omit accessibilityLabel on Pressable.
  // Treat compact interactive wrappers that carry descendant text as tappable.
  if (view.userInteractionEnabled && isRnView && !isTextish &&
      ![cls containsString:@"Scroll"] &&
      ![cls containsString:@"Image"]) {
    CGFloat h = view.bounds.size.height;
    CGFloat w = view.bounds.size.width;
    CGFloat area = w * h;
    // Bottom tabs / nav rows can be taller than 140pt on large phones.
    if (h >= 20 && h <= 200 && w >= 20 && area > 0 && area < 520 * 520) {
      NSString *desc = KokoAggregateTextDepth(view, 5);
      // Short labels look like buttons / tabs; skip long prose blobs.
      if (desc.length > 0 && desc.length <= 64) {
        return YES;
      }
    }
  }

  return NO;
}

static BOOL KokoIsOverlayMarked(UIView *view)
{
  NSString *aid = view.accessibilityIdentifier;
  if ([aid hasPrefix:@"koko-agent-"]) return YES;
  @try {
    id nid = [view valueForKey:@"nativeID"];
    if ([nid isKindOfClass:[NSString class]] && [((NSString *)nid) hasPrefix:@"koko-agent-"]) {
      return YES;
    }
  } @catch (__unused NSException *e) {
  }
  return NO;
}

/** Chrome to mute on tap (progress / sheet). Cursor must stay visible. */
static BOOL KokoIsChromeToMute(UIView *view)
{
  NSString *aid = view.accessibilityIdentifier;
  if ([aid isEqualToString:@"koko-agent-overlay"] ||
      [aid hasPrefix:@"koko-agent-overlay/"]) {
    return YES;
  }
  @try {
    id nid = [view valueForKey:@"nativeID"];
    if ([nid isKindOfClass:[NSString class]]) {
      NSString *s = (NSString *)nid;
      if ([s isEqualToString:@"koko-agent-overlay"] ||
          [s hasPrefix:@"koko-agent-overlay/"]) {
        return YES;
      }
    }
  } @catch (__unused NSException *e) {
  }
  return NO;
}

static void KokoCollectOverlayRoots(UIView *view, NSMutableArray<UIView *> *out,
                                    KokoOverlayMuteMode mode)
{
  // Visual capture must exclude every SDK layer, including the cursor: its
  // hand can cover the very text OCR is revalidating. For touch dispatch only
  // mute interactive chrome, keeping the cursor visible to the user.
  if ((mode & KokoOverlayMuteVisibility) ? KokoIsOverlayMarked(view) : KokoIsChromeToMute(view)) {
    [out addObject:view];
    return;
  }
  if (KokoIsOverlayMarked(view)) {
    // Cursor / other koko chrome: do not recurse into children.
    return;
  }
  for (UIView *child in view.subviews) {
    KokoCollectOverlayRoots(child, out, mode);
  }
}

/** Temporarily mute Koko chrome so dump/tap/screenshot see the host app. */
static void KokoPerformHidingOverlays(UIView *root, KokoOverlayMuteMode mode, void (^block)(void))
{
  NSMutableArray<UIView *> *overlays = [NSMutableArray array];
  KokoCollectOverlayRoots(root, overlays, mode);
  // Modal sheets often live in another window.
  for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
    if (![scene isKindOfClass:[UIWindowScene class]]) continue;
    for (UIWindow *w in ((UIWindowScene *)scene).windows) {
      if (w == root) continue;
      KokoCollectOverlayRoots(w, overlays, mode);
    }
  }

  NSMutableArray<NSNumber *> *savedHidden = [NSMutableArray array];
  NSMutableArray<NSNumber *> *savedInteraction = [NSMutableArray array];
  for (UIView *v in overlays) {
    [savedHidden addObject:@(v.hidden)];
    [savedInteraction addObject:@(v.userInteractionEnabled)];
    if (mode & KokoOverlayMuteVisibility) {
      v.hidden = YES;
    }
    if (mode & KokoOverlayMuteInteraction) {
      v.userInteractionEnabled = NO;
    }
  }

  block();

  for (NSUInteger i = 0; i < overlays.count; i++) {
    UIView *v = overlays[i];
    v.hidden = savedHidden[i].boolValue;
    v.userInteractionEnabled = savedInteraction[i].boolValue;
  }
}

static NSDictionary *KokoDumpView(UIView *view, NSString *path, NSInteger depth, NSInteger maxDepth, BOOL skipInvisible, UIView *root)
{
  if (depth > maxDepth) return nil;
  // Never expose SDK chrome in the app UI tree.
  if (KokoIsOverlayMarked(view)) return nil;

  CGRect frame = [view convertRect:view.bounds toView:root];
  BOOL visible = !view.hidden && view.alpha > 0.01 && frame.size.width > 0 && frame.size.height > 0;
  if (skipInvisible && !visible) return nil;

  NSMutableArray *children = [NSMutableArray array];
  NSInteger i = 0;
  for (UIView *child in view.subviews) {
    NSDictionary *childNode = KokoDumpView(child, KokoJoinPath(path, i), depth + 1, maxDepth, skipInvisible, root);
    if (childNode) [children addObject:childNode];
    i += 1;
  }

  NSString *text = KokoAggregateText(view);
  NSMutableDictionary *node = [@{
    @"id": path ?: @"0",
    @"type": NSStringFromClass(view.class),
    @"frame": @{
      @"x": @(frame.origin.x),
      @"y": @(frame.origin.y),
      @"width": @(frame.size.width),
      @"height": @(frame.size.height),
    },
    @"clickable": @(KokoIsClickable(view)),
    @"enabled": @YES,
    @"visible": @(visible),
    @"children": children,
  } mutableCopy];

  if ([view isKindOfClass:[UIScrollView class]]) {
    UIScrollView *scroll = (UIScrollView *)view;
    node[@"scrollable"] = (scroll.scrollEnabled && scroll.contentSize.height + scroll.adjustedContentInset.top + scroll.adjustedContentInset.bottom > scroll.bounds.size.height + 1) ? @YES : @NO;
    node[@"clipsChildren"] = @YES;
  }
  if (text.length) node[@"text"] = text;
  if (view.accessibilityLabel.length) node[@"accessibilityLabel"] = view.accessibilityLabel;
  if (view.accessibilityIdentifier.length) node[@"testID"] = view.accessibilityIdentifier;
  if (([view isKindOfClass:[UITextField class]] && ((UITextField *)view).secureTextEntry) ||
      ([view isKindOfClass:[UITextView class]] && ((UITextView *)view).secureTextEntry)) {
    node[@"secure"] = @YES;
    node[@"text"] = @"[redacted]";
    [node removeObjectForKey:@"accessibilityLabel"];
  }
  // Selected / disabled state. Without it the agent cannot tell that the tab or
  // segment it wants is already active, so it taps again, sees no change, and
  // burns the step budget re-tapping. RN maps accessibilityState onto the same
  // traits, so this covers UIKit chrome and RN views alike.
  UIAccessibilityTraits traits = view.accessibilityTraits;
  BOOL selected = (traits & UIAccessibilityTraitSelected) != 0;
  if (!selected && [view isKindOfClass:[UIControl class]]) {
    selected = ((UIControl *)view).isSelected;
  }
  if (selected) node[@"selected"] = @YES;
  if ((traits & UIAccessibilityTraitNotEnabled) != 0 ||
      ([view isKindOfClass:[UIControl class]] && !((UIControl *)view).isEnabled)) {
    node[@"enabled"] = @NO;
  }
  NSString *cls = NSStringFromClass(view.class);
  if (KokoIsSystemSheetClass(cls)) {
    node[@"sheet"] = @YES;
    // Only real action rows are tappable; AlertController title/container are context.
    BOOL isAction =
        [cls containsString:@"AlertAction"] ||
        [cls containsString:@"UIInterfaceAction"] ||
        [cls isEqualToString:@"UIAlertAction"];
    if (!isAction) {
      node[@"clickable"] = @NO;
    }
  }
  if ([view isKindOfClass:[UIPickerView class]] ||
      [view isKindOfClass:[UIDatePicker class]] ||
      [view isKindOfClass:[UISlider class]] ||
      [view isKindOfClass:[UIStepper class]] ||
      [view isKindOfClass:[UISegmentedControl class]] ||
      (view.accessibilityTraits & UIAccessibilityTraitAdjustable)) {
    node[@"adjustable"] = @YES;
  }
  if ([view isKindOfClass:[UISlider class]]) {
    UISlider *slider = (UISlider *)view;
    node[@"value"] = @(slider.value);
    node[@"min"] = @(slider.minimumValue);
    node[@"max"] = @(slider.maximumValue);
  } else {
    // RNCSlider Fabric wrapper: value lives on nested UISlider.
    UISlider *nested = nil;
    for (UIView *child in view.subviews) {
      if ([child isKindOfClass:[UISlider class]]) {
        nested = (UISlider *)child;
        break;
      }
      for (UIView *grand in child.subviews) {
        if ([grand isKindOfClass:[UISlider class]]) {
          nested = (UISlider *)grand;
          break;
        }
      }
      if (nested) break;
    }
    if (nested) {
      node[@"adjustable"] = @YES;
      node[@"value"] = @(nested.value);
      node[@"min"] = @(nested.minimumValue);
      node[@"max"] = @(nested.maximumValue);
    }
  }
  if ([view isKindOfClass:[UIStepper class]]) {
    UIStepper *stepper = (UIStepper *)view;
    node[@"value"] = @(stepper.value);
    node[@"min"] = @(stepper.minimumValue);
    node[@"max"] = @(stepper.maximumValue);
  }
  if ([view isKindOfClass:[UISegmentedControl class]]) {
    UISegmentedControl *seg = (UISegmentedControl *)view;
    node[@"value"] = @(seg.selectedSegmentIndex);
    node[@"max"] = @(MAX(0, (NSInteger)seg.numberOfSegments - 1));
  }
  if ([view isKindOfClass:[UISwitch class]]) {
    node[@"toggle"] = @YES;
    node[@"on"] = @(((UISwitch *)view).on);
  }
  return node;
}

static BOOL KokoTryAccessibilityActivate(UIView *hit)
{
  for (UIView *v = hit; v; v = v.superview) {
    if (KokoIsChromeView(v)) continue;
    NSString *cls = NSStringFromClass(v.class);
    if (v.isAccessibilityElement && [v accessibilityActivate]) return YES;
    UIAccessibilityTraits traits = v.accessibilityTraits;
    if (((traits & UIAccessibilityTraitButton) ||
         (traits & UIAccessibilityTraitLink) ||
         (traits & UIAccessibilityTraitAdjustable)) &&
        [v accessibilityActivate]) {
      return YES;
    }
    // Fabric / Tamagui Pressable often has no button trait but still activates.
    if (([cls containsString:@"Pressable"] ||
         [cls containsString:@"Touchable"] ||
         [cls containsString:@"RCTViewComponentView"] ||
         [cls containsString:@"RNGestureHandler"]) &&
        [v respondsToSelector:@selector(accessibilityActivate)] &&
        [v accessibilityActivate]) {
      return YES;
    }
  }
  return NO;
}

/** Use the nearest press target; a wrapping row may contain other controls. */
static UIView *KokoBestPressTarget(UIView *hit)
{
  for (UIView *v = hit; v; v = v.superview) {
    if (KokoIsChromeView(v)) break;
    if (KokoIsClickable(v) && v.userInteractionEnabled) {
      return v;
    }
  }
  return hit;
}

static UIView *KokoReactRootNear(UIView *from)
{
  for (UIView *v = from; v; v = v.superview) {
    NSString *cls = NSStringFromClass(v.class);
    if ([cls containsString:@"RCTRoot"] ||
        [cls containsString:@"ReactRoot"] ||
        [cls containsString:@"RCTSurface"] ||
        [cls containsString:@"RCTFabricSurface"] ||
        [cls containsString:@"RCTSurfaceView"]) {
      return v;
    }
  }
  return nil;
}

static BOOL KokoDispatchTapAtPoint(UIWindow *window, CGPoint point)
{
  return KokoDispatchTapOnWindow(window, point);
}

static BOOL KokoDispatchTapOnWindow(UIWindow *window, CGPoint point)
{
  __block BOOL ok = NO;
  // Disable hit-testing without hiding chrome. Touch dispatch pumps the run
  // loop, so a visibility change here would paint missing progress frames.
  KokoPerformHidingOverlays(
      window,
      KokoOverlayMuteInteraction,
      ^{
    UIView *hit = [window hitTest:point withEvent:nil];
    if (!hit || hit == window) return;

    // Prefer buttons/pressables over focusing a nearby TextInput.
    BOOL hitIsButton = NO;
    for (UIView *t = hit; t; t = t.superview) {
      NSString *cls = NSStringFromClass(t.class);
      if ([cls containsString:@"AlertAction"] || [cls containsString:@"UIInterfaceAction"]) {
        hitIsButton = YES;
        break;
      }
      if ((t.accessibilityTraits & UIAccessibilityTraitButton) != 0) {
        hitIsButton = YES;
        break;
      }
      if ([t isKindOfClass:[UIControl class]] &&
          ![t isKindOfClass:[UITextField class]] &&
          ![t isKindOfClass:[UITextView class]]) {
        hitIsButton = YES;
        break;
      }
      if (KokoIsClickable(t) && t.userInteractionEnabled) {
        hitIsButton = YES;
        break;
      }
      if ([t isKindOfClass:[UITextField class]] || [t isKindOfClass:[UITextView class]]) {
        break;
      }
    }

    // UITextField is a UIControl — sendActions alone does NOT becomeFirstResponder.
    if (!hitIsButton) {
      UIView *textInput = KokoNearestTextInput(hit);
      if (textInput) {
        ok = KokoFocusTextInput(textInput);
        if (ok) return;
      }
    }

    // NOTE: Do NOT early-return on accessibilityActivate alone.
    // Fabric/Tamagui often returns YES with zero UI effect (tap_noop).
    // Native controls first, then synthetic touch, then a11y as a supplement.

    UIView *v = hit;
    // Switches: slide the thumb (tap alone is unreliable / wrong UX).
    for (UIView *t = hit; t; t = t.superview) {
      if ([t isKindOfClass:[UISwitch class]]) {
        UISwitch *sw = (UISwitch *)t;
        CGRect b = [sw convertRect:sw.bounds toView:window];
        CGFloat midY = CGRectGetMidY(b);
        CGFloat inset = MAX(6.0, CGRectGetWidth(b) * 0.18);
        CGPoint from = sw.on
            ? CGPointMake(CGRectGetMaxX(b) - inset, midY)
            : CGPointMake(CGRectGetMinX(b) + inset, midY);
        CGPoint to = sw.on
            ? CGPointMake(CGRectGetMinX(b) + inset, midY)
            : CGPointMake(CGRectGetMaxX(b) - inset, midY);
        if (KokoSendSyntheticSwipe(window, from, to, 0.22)) {
          ok = YES;
          return;
        }
        BOOL next = !sw.on;
        [sw setOn:next animated:YES];
        [sw sendActionsForControlEvents:UIControlEventValueChanged];
        ok = YES;
        return;
      }
      // Slider: set value from tap X along the track.
      if ([t isKindOfClass:[UISlider class]]) {
        UISlider *slider = (UISlider *)t;
        CGRect b = [slider convertRect:slider.bounds toView:window];
        CGFloat span = MAX(1.0, CGRectGetWidth(b));
        CGFloat ratio = (point.x - CGRectGetMinX(b)) / span;
        ratio = MAX(0.0, MIN(1.0, ratio));
        float next = slider.minimumValue + (float)ratio * (slider.maximumValue - slider.minimumValue);
        [slider setValue:next animated:YES];
        [slider sendActionsForControlEvents:UIControlEventValueChanged];
        ok = YES;
        return;
      }
      // Stepper: left half −, right half +.
      if ([t isKindOfClass:[UIStepper class]]) {
        UIStepper *stepper = (UIStepper *)t;
        CGRect b = [stepper convertRect:stepper.bounds toView:window];
        double next = stepper.value;
        if (point.x >= CGRectGetMidX(b)) {
          next = MIN(stepper.maximumValue, stepper.value + stepper.stepValue);
        } else {
          next = MAX(stepper.minimumValue, stepper.value - stepper.stepValue);
        }
        stepper.value = next;
        [stepper sendActionsForControlEvents:UIControlEventValueChanged];
        ok = YES;
        return;
      }
      // Segmented control: select segment under tap X.
      if ([t isKindOfClass:[UISegmentedControl class]]) {
        UISegmentedControl *seg = (UISegmentedControl *)t;
        NSInteger count = seg.numberOfSegments;
        if (count > 0) {
          CGRect b = [seg convertRect:seg.bounds toView:window];
          CGFloat span = MAX(1.0, CGRectGetWidth(b));
          NSInteger idx = (NSInteger)floor((point.x - CGRectGetMinX(b)) / span * count);
          idx = MAX(0, MIN(count - 1, idx));
          if (seg.selectedSegmentIndex != idx) {
            seg.selectedSegmentIndex = idx;
            [seg sendActionsForControlEvents:UIControlEventValueChanged];
          }
          ok = YES;
          return;
        }
      }
    }

    v = hit;
    while (v) {
      if ([v isKindOfClass:[UIControl class]] &&
          ![v isKindOfClass:[UITextField class]] &&
          ![v isKindOfClass:[UITextView class]] &&
          ![v isKindOfClass:[UISwitch class]] &&
          ![v isKindOfClass:[UISlider class]] &&
          ![v isKindOfClass:[UIStepper class]]) {
        UIControl *control = (UIControl *)v;
        [control sendActionsForControlEvents:UIControlEventTouchDown];
        [control sendActionsForControlEvents:UIControlEventTouchUpInside];
        ok = YES;
        return;
      }
      v = v.superview;
    }

    // Synthetic touch aimed at the best press ancestor (not a tiny text leaf).
    UIView *press = KokoBestPressTarget(hit);
    // Preserve the selector's point. Re-centering on an ancestor can move a
    // touch between adjacent buttons instead of hitting the requested one.
    CGPoint pressPoint = point;

    // RN's touch handler first, and alone when it is there: it is the real
    // event path for any RN view, and stacking the other strategies on top of
    // a press that did land reads as a double tap.
    if (KokoSendTouchToReactHandler(window, pressPoint, press ?: hit)) {
      ok = YES;
      return;
    }

    BOOL synth = KokoSendSyntheticTouch(window, pressPoint);
    // Also poke common RN / gesture-handler button classes in the ancestry.
    BOOL gestured = KokoFireTapGestures(press ?: hit);
    // A11y last — supplement only; never the sole strategy.
    BOOL a11y = KokoTryAccessibilityActivate(press ?: hit);
    if (!a11y) {
      a11y = KokoTryAccessibilityActivate(hit);
    }
    ok = synth || gestured || a11y;
  });
  return ok;
}

/** Fire RNGestureHandlerButton / UIControl press actions on the view chain. */
static BOOL KokoFireTapGestures(UIView *from)
{
  if (!from) return NO;
  BOOL fired = NO;
  for (UIView *v = from; v; v = v.superview) {
    if (KokoIsChromeView(v)) break;
    NSString *cls = NSStringFromClass(v.class);
    if (![v isKindOfClass:[UIControl class]]) continue;
    if (!([cls containsString:@"RNGestureHandlerButton"] ||
          [cls containsString:@"GestureHandlerButton"] ||
          [cls containsString:@"Pressable"] ||
          [cls containsString:@"Touchable"] ||
          [cls containsString:@"Button"])) {
      continue;
    }
    UIControl *c = (UIControl *)v;
    [c sendActionsForControlEvents:UIControlEventTouchDown];
    [c sendActionsForControlEvents:UIControlEventTouchUpInside];
    fired = YES;
  }
  return fired;
}

/**
 * Hand a tap to React Native's own touch handler.
 *
 * RN routes touches through a UIGestureRecognizer on the surface
 * (RCTSurfaceTouchHandler under Fabric, RCTTouchHandler under the old
 * renderer), not through the pressed view's responder chain. Recognizers are
 * fed by the gesture environment, so calling -touchesBegan: on the view, or
 * even on the RN root, never reaches them and a Pressable sees nothing.
 *
 * Every tap that works today avoids touches altogether: UIControl
 * sendActions, UIScrollView contentOffset, becomeFirstResponder on an input,
 * or a host-registered action. A plain RN view had no path at all, which is
 * why a control the agent can see and aim at correctly still does nothing.
 *
 * Give the recognizer the touch directly.
 */
static BOOL KokoSendTouchToReactHandler(UIWindow *window, CGPoint point, UIView *target)
{
  UIGestureRecognizer *handler = nil;
  UIView *host = nil;
  for (UIView *v = target; v && !handler; v = v.superview) {
    for (UIGestureRecognizer *g in v.gestureRecognizers) {
      if (!g.isEnabled) continue;
      NSString *cls = NSStringFromClass(g.class);
      // RCTSurfaceTouchHandler / RCTTouchHandler, and renderer forks of both.
      if ([cls containsString:@"TouchHandler"]) {
        handler = g;
        host = v;
        break;
      }
    }
  }
  if (!handler) return NO;

  UIView *hit = [window hitTest:point withEvent:nil] ?: target;
  UITouch *touch = KokoMakeTouch(window, hit, point);
  if (!touch) return NO;

  UIEvent *began = KokoEventWithTouch(touch);
  NSSet *set = [NSSet setWithObject:touch];
  [handler touchesBegan:set withEvent:began];

  // RN resolves a press across run-loop ticks; began and ended in one stack
  // reads as a cancelled touch.
  CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.05, false);

  KokoSetTouchPhase(touch, UITouchPhaseEnded);
  UIEvent *ended = KokoEventWithTouch(touch) ?: began;
  [handler touchesEnded:set withEvent:ended];
  (void)host;
  return YES;
}

static BOOL KokoSendSyntheticTouch(UIWindow *window, CGPoint point)
{
  UIView *hit = [window hitTest:point withEvent:nil];
  if (!hit) return NO;
  UIView *press = KokoBestPressTarget(hit);
  UIView *targetView = press ?: hit;

  UITouch *touch = [[UITouch alloc] init];

  @try {
    [touch setValue:window forKey:@"window"];
  } @catch (__unused NSException *e) {
  }

  if ([touch respondsToSelector:NSSelectorFromString(@"setWindow:")]) {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Warc-performSelector-leaks"
    [touch performSelector:NSSelectorFromString(@"setWindow:") withObject:window];
#pragma clang diagnostic pop
  }

  if ([touch respondsToSelector:NSSelectorFromString(@"setView:")]) {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Warc-performSelector-leaks"
    [touch performSelector:NSSelectorFromString(@"setView:") withObject:targetView];
#pragma clang diagnostic pop
  }

  // Extra ivars that RN / gesture handlers often read.
  @try {
    [touch setValue:@(1) forKey:@"tapCount"];
  } @catch (__unused NSException *e) {
  }
  @try {
    [touch setValue:@(1) forKey:@"_tapCount"];
  } @catch (__unused NSException *e) {
  }
  @try {
    NSTimeInterval ts = [[NSProcessInfo processInfo] systemUptime];
    [touch setValue:@(ts) forKey:@"timestamp"];
  } @catch (__unused NSException *e) {
  }

  NSMethodSignature *sig = [UITouch instanceMethodSignatureForSelector:NSSelectorFromString(@"setLocationInWindow:")];
  if (sig) {
    NSInvocation *inv = [NSInvocation invocationWithMethodSignature:sig];
    [inv setSelector:NSSelectorFromString(@"setLocationInWindow:")];
    [inv setTarget:touch];
    [inv setArgument:&point atIndex:2];
    [inv invoke];
  }

  void (^setPhase)(NSInteger) = ^(NSInteger phase) {
    if (![touch respondsToSelector:NSSelectorFromString(@"setPhase:")]) return;
    NSMethodSignature *psig = [UITouch instanceMethodSignatureForSelector:NSSelectorFromString(@"setPhase:")];
    if (!psig) return;
    NSInvocation *pinv = [NSInvocation invocationWithMethodSignature:psig];
    [pinv setSelector:NSSelectorFromString(@"setPhase:")];
    [pinv setTarget:touch];
    [pinv setArgument:&phase atIndex:2];
    [pinv invoke];
  };

  setPhase(UITouchPhaseBegan);
  UIEvent *event = KokoEventWithTouch(touch);
  NSSet *set = [NSSet setWithObject:touch];
  UIView *rnRoot = KokoReactRootNear(targetView);

  // RN Pressable / Fabric needs a run-loop tick between began and ended;
  // same-stack began→ended is often ignored (looks like tap_noop).
  void (^pump)(void) = ^{
    CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.045, false);
  };

  if (!event) {
    [targetView touchesBegan:set withEvent:nil];
    if (rnRoot && rnRoot != targetView) {
      [rnRoot touchesBegan:set withEvent:nil];
    }
    pump();
    setPhase(UITouchPhaseEnded);
    [targetView touchesEnded:set withEvent:nil];
    if (rnRoot && rnRoot != targetView) {
      [rnRoot touchesEnded:set withEvent:nil];
    }
    return YES;
  }

  [[UIApplication sharedApplication] sendEvent:event];
  // Also poke the RN root — Fabric sometimes ignores UIApplication-routed events
  // that never enter the surface's touch handler.
  [targetView touchesBegan:set withEvent:event];
  if (rnRoot && rnRoot != targetView) {
    [rnRoot touchesBegan:set withEvent:event];
  }

  pump();

  setPhase(UITouchPhaseEnded);
  UIEvent *eventEnd = KokoEventWithTouch(touch);
  if (eventEnd) {
    [[UIApplication sharedApplication] sendEvent:eventEnd];
    [targetView touchesEnded:set withEvent:eventEnd];
    if (rnRoot && rnRoot != targetView) {
      [rnRoot touchesEnded:set withEvent:eventEnd];
    }
  } else {
    [targetView touchesEnded:set withEvent:nil];
    if (rnRoot && rnRoot != targetView) {
      [rnRoot touchesEnded:set withEvent:nil];
    }
  }
  return YES;
}

/** Slide a switch thumb; used when a tap lands on UISwitch. */
static BOOL KokoSendSyntheticSwipe(UIWindow *window, CGPoint from, CGPoint to, NSTimeInterval duration)
{
  (void)duration;
  UIView *hit = [window hitTest:from withEvent:nil] ?: [window hitTest:to withEvent:nil];
  if (!hit) return NO;
  for (UIView *t = hit; t; t = t.superview) {
    if ([t isKindOfClass:[UISwitch class]]) {
      UISwitch *sw = (UISwitch *)t;
      // Rightward slide → on, leftward → off (native switch thumb motion).
      BOOL wantOn = to.x >= from.x;
      if (sw.on != wantOn) {
        [sw setOn:wantOn animated:YES];
        [sw sendActionsForControlEvents:UIControlEventValueChanged];
      }
      return YES;
    }
  }
  return NO;
}

static UIEvent *KokoEventWithTouch(UITouch *touch)
{
  // UIApplication _touchesEvent is private; try and return nil on failure.
  UIApplication *app = [UIApplication sharedApplication];
  SEL sel = NSSelectorFromString(@"_touchesEvent");
  if (![app respondsToSelector:sel]) return nil;
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Warc-performSelector-leaks"
  UIEvent *event = [app performSelector:sel];
#pragma clang diagnostic pop
  if (!event) return nil;

  SEL clearSel = NSSelectorFromString(@"_clearTouches");
  if ([event respondsToSelector:clearSel]) {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Warc-performSelector-leaks"
    [event performSelector:clearSel];
#pragma clang diagnostic pop
  }

  SEL addSel = NSSelectorFromString(@"_addTouch:forDelayedDelivery:");
  if ([event respondsToSelector:addSel]) {
    NSMethodSignature *sig = [event methodSignatureForSelector:addSel];
    NSInvocation *inv = [NSInvocation invocationWithMethodSignature:sig];
    [inv setSelector:addSel];
    [inv setTarget:event];
    [inv setArgument:&touch atIndex:2];
    BOOL delayed = NO;
    [inv setArgument:&delayed atIndex:3];
    [inv invoke];
  }
  return event;
}

static BOOL KokoDispatchSwipe(UIWindow *window, CGPoint from, CGPoint to)
{
  __block BOOL ok = NO;
  KokoPerformHidingOverlays(
      window,
      KokoOverlayMuteInteraction,
      ^{
    UIView *hit = [window hitTest:from withEvent:nil];
    UIView *v = hit;
    while (v) {
      // Switch: horizontal swipe / setOn (same as tap path).
      if ([v isKindOfClass:[UISwitch class]]) {
        if (KokoSendSyntheticSwipe(window, from, to, 0.22)) {
          ok = YES;
          return;
        }
        UISwitch *sw = (UISwitch *)v;
        BOOL wantOn = to.x >= from.x;
        if (sw.on != wantOn) {
          [sw setOn:wantOn animated:YES];
          [sw sendActionsForControlEvents:UIControlEventValueChanged];
        }
        ok = YES;
        return;
      }
      // Slider: set value from swipe end X along the track.
      if ([v isKindOfClass:[UISlider class]]) {
        UISlider *slider = (UISlider *)v;
        CGRect b = [slider convertRect:slider.bounds toView:window];
        CGFloat span = MAX(1.0, CGRectGetWidth(b));
        CGFloat ratio = (to.x - CGRectGetMinX(b)) / span;
        ratio = MAX(0.0, MIN(1.0, ratio));
        float next = slider.minimumValue + (float)ratio * (slider.maximumValue - slider.minimumValue);
        [slider setValue:next animated:YES];
        [slider sendActionsForControlEvents:UIControlEventValueChanged];
        ok = YES;
        return;
      }
      // Picker / date wheels: vertical swipe adjusts value.
      if ([v isKindOfClass:[UIPickerView class]] || [v isKindOfClass:[UIDatePicker class]]) {
        if (KokoSendSyntheticTouch(window, from)) {
          // Prefer a short synthetic swipe via scroll if possible
        }
        UIScrollView *probe = nil;
        for (UIView *c in v.subviews) {
          if ([c isKindOfClass:[UIScrollView class]]) {
            probe = (UIScrollView *)c;
            break;
          }
        }
        if (probe) {
          CGPoint offset = probe.contentOffset;
          UIEdgeInsets inset = probe.adjustedContentInset;
          offset.y = KokoBoundedScrollOffset(offset.y, from.y - to.y,
            probe.contentSize.height, probe.bounds.size.height, inset.top, inset.bottom);
          [probe setContentOffset:offset animated:YES];
          ok = YES;
          return;
        }
      }
      if ([v isKindOfClass:[UIScrollView class]]) {
        UIScrollView *scroll = (UIScrollView *)v;
        if (!scroll.scrollEnabled) { v = v.superview; continue; }
        CGPoint offset = scroll.contentOffset;
        UIEdgeInsets inset = scroll.adjustedContentInset;
        BOOL vertical = fabs(from.y - to.y) >= fabs(from.x - to.x);
        if (vertical) {
          if (!KokoScrollHasRange(scroll.contentSize.height, scroll.bounds.size.height, inset.top, inset.bottom)) {
            v = v.superview; continue;
          }
          offset.y = KokoBoundedScrollOffset(offset.y, from.y - to.y,
            scroll.contentSize.height, scroll.bounds.size.height, inset.top, inset.bottom);
        } else {
          if (!KokoScrollHasRange(scroll.contentSize.width, scroll.bounds.size.width, inset.left, inset.right)) {
            v = v.superview; continue;
          }
          offset.x = KokoBoundedScrollOffset(offset.x, from.x - to.x,
            scroll.contentSize.width, scroll.bounds.size.width, inset.left, inset.right);
        }
        // A horizontal carousel must not consume a vertical list scroll, and a
        // nested view already at its boundary must allow its parent to scroll.
        if (fabs(offset.x - scroll.contentOffset.x) < 0.5 && fabs(offset.y - scroll.contentOffset.y) < 0.5) {
          v = v.superview; continue;
        }
        [scroll setContentOffset:offset animated:YES];
        ok = YES;
        return;
      }
      v = v.superview;
    }
    // Unsupported drags must not silently become a tap at the starting point.
  });
  return ok;
}

static UITouch *KokoMakeTouch(UIWindow *window, UIView *view, CGPoint pointInWindow)
{
  UITouch *touch = [[UITouch alloc] init];
  @try {
    [touch setValue:window forKey:@"window"];
  } @catch (__unused NSException *e) {
  }
  if ([touch respondsToSelector:NSSelectorFromString(@"setWindow:")]) {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Warc-performSelector-leaks"
    [touch performSelector:NSSelectorFromString(@"setWindow:") withObject:window];
#pragma clang diagnostic pop
  }
  if ([touch respondsToSelector:NSSelectorFromString(@"setView:")]) {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Warc-performSelector-leaks"
    [touch performSelector:NSSelectorFromString(@"setView:") withObject:view];
#pragma clang diagnostic pop
  }
  SEL locSel = NSSelectorFromString(@"setLocationInWindow:");
  if ([touch respondsToSelector:locSel]) {
    NSMethodSignature *sig = [UITouch instanceMethodSignatureForSelector:locSel];
    if (sig) {
      NSInvocation *inv = [NSInvocation invocationWithMethodSignature:sig];
      [inv setSelector:locSel];
      [inv setTarget:touch];
      [inv setArgument:&pointInWindow atIndex:2];
      [inv invoke];
    }
  }
  SEL phaseSel = NSSelectorFromString(@"setPhase:");
  if ([touch respondsToSelector:phaseSel]) {
    NSInteger began = UITouchPhaseBegan;
    NSMethodSignature *psig = [UITouch instanceMethodSignatureForSelector:phaseSel];
    if (psig) {
      NSInvocation *pinv = [NSInvocation invocationWithMethodSignature:psig];
      [pinv setSelector:phaseSel];
      [pinv setTarget:touch];
      [pinv setArgument:&began atIndex:2];
      [pinv invoke];
    }
  }
  return touch;
}

static UIEvent *KokoEventWithTouches(NSArray<UITouch *> *touches)
{
  UIApplication *app = [UIApplication sharedApplication];
  SEL sel = NSSelectorFromString(@"_touchesEvent");
  if (![app respondsToSelector:sel]) return nil;
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Warc-performSelector-leaks"
  UIEvent *event = [app performSelector:sel];
#pragma clang diagnostic pop
  if (!event) return nil;

  SEL clearSel = NSSelectorFromString(@"_clearTouches");
  if ([event respondsToSelector:clearSel]) {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Warc-performSelector-leaks"
    [event performSelector:clearSel];
#pragma clang diagnostic pop
  }

  SEL addSel = NSSelectorFromString(@"_addTouch:forDelayedDelivery:");
  if ([event respondsToSelector:addSel]) {
    for (UITouch *touch in touches) {
      NSMethodSignature *sig = [event methodSignatureForSelector:addSel];
      NSInvocation *inv = [NSInvocation invocationWithMethodSignature:sig];
      [inv setSelector:addSel];
      [inv setTarget:event];
      UITouch *t = touch;
      [inv setArgument:&t atIndex:2];
      BOOL delayed = NO;
      [inv setArgument:&delayed atIndex:3];
      [inv invoke];
    }
  }
  return event;
}

static void KokoSetTouchPhase(UITouch *touch, UITouchPhase phase)
{
  SEL phaseSel = NSSelectorFromString(@"setPhase:");
  if (![touch respondsToSelector:phaseSel]) return;
  NSInteger p = phase;
  NSMethodSignature *psig = [UITouch instanceMethodSignatureForSelector:phaseSel];
  if (!psig) return;
  NSInvocation *pinv = [NSInvocation invocationWithMethodSignature:psig];
  [pinv setSelector:phaseSel];
  [pinv setTarget:touch];
  [pinv setArgument:&p atIndex:2];
  [pinv invoke];
}

static void KokoSetTouchLocation(UITouch *touch, CGPoint pointInWindow)
{
  SEL locSel = NSSelectorFromString(@"setLocationInWindow:");
  if (![touch respondsToSelector:locSel]) return;
  NSMethodSignature *sig = [UITouch instanceMethodSignatureForSelector:locSel];
  if (!sig) return;
  NSInvocation *inv = [NSInvocation invocationWithMethodSignature:sig];
  [inv setSelector:locSel];
  [inv setTarget:touch];
  [inv setArgument:&pointInWindow atIndex:2];
  [inv invoke];
}

/**
 * Two-finger pinch. scale>1 fingers move apart (zoom in); scale<1 together (zoom out).
 * Prefers UIScrollView zoomScale when available; else synthesizes multi-touch.
 */
static BOOL KokoSendSyntheticPinch(UIWindow *window, CGPoint center, CGFloat scale, NSTimeInterval duration)
{
  UIView *hit = [window hitTest:center withEvent:nil];
  if (!hit) return NO;

  CGFloat startHalf = 48.0;
  CGFloat endHalf = MAX(10.0, MIN(260.0, startHalf * scale));
  CGPoint p1Start = CGPointMake(center.x - startHalf, center.y);
  CGPoint p2Start = CGPointMake(center.x + startHalf, center.y);
  CGPoint p1End = CGPointMake(center.x - endHalf, center.y);
  CGPoint p2End = CGPointMake(center.x + endHalf, center.y);

  UITouch *t1 = KokoMakeTouch(window, hit, p1Start);
  UITouch *t2 = KokoMakeTouch(window, hit, p2Start);
  if (!t1 || !t2) return NO;

  NSArray *pair = @[t1, t2];
  UIEvent *began = KokoEventWithTouches(pair);
  if (began) {
    [[UIApplication sharedApplication] sendEvent:began];
  } else {
    NSSet *set = [NSSet setWithArray:pair];
    [hit touchesBegan:set withEvent:nil];
  }

  NSInteger steps = MAX(4, (NSInteger)(duration / 0.03));
  for (NSInteger i = 1; i <= steps; i++) {
    CGFloat t = (CGFloat)i / (CGFloat)steps;
    CGPoint a = CGPointMake(p1Start.x + (p1End.x - p1Start.x) * t,
                            p1Start.y + (p1End.y - p1Start.y) * t);
    CGPoint b = CGPointMake(p2Start.x + (p2End.x - p2Start.x) * t,
                            p2Start.y + (p2End.y - p2Start.y) * t);
    KokoSetTouchLocation(t1, a);
    KokoSetTouchLocation(t2, b);
    KokoSetTouchPhase(t1, UITouchPhaseMoved);
    KokoSetTouchPhase(t2, UITouchPhaseMoved);
    UIEvent *moved = KokoEventWithTouches(pair);
    if (moved) {
      [[UIApplication sharedApplication] sendEvent:moved];
    } else {
      NSSet *set = [NSSet setWithArray:pair];
      [hit touchesMoved:set withEvent:nil];
    }
  }

  KokoSetTouchLocation(t1, p1End);
  KokoSetTouchLocation(t2, p2End);
  KokoSetTouchPhase(t1, UITouchPhaseEnded);
  KokoSetTouchPhase(t2, UITouchPhaseEnded);
  UIEvent *ended = KokoEventWithTouches(pair);
  if (ended) {
    [[UIApplication sharedApplication] sendEvent:ended];
  } else {
    NSSet *set = [NSSet setWithArray:pair];
    [hit touchesEnded:set withEvent:nil];
  }
  return YES;
}

static BOOL KokoDispatchPinch(UIWindow *window, CGPoint center, CGFloat scale, NSTimeInterval duration)
{
  __block BOOL ok = NO;
  KokoPerformHidingOverlays(
      window,
      KokoOverlayMuteInteraction,
      ^{
    UIView *hit = [window hitTest:center withEvent:nil];
    for (UIView *v = hit; v; v = v.superview) {
      if ([v isKindOfClass:[UIScrollView class]]) {
        UIScrollView *scroll = (UIScrollView *)v;
        if (scroll.maximumZoomScale > scroll.minimumZoomScale + 0.01) {
          CGFloat next = scroll.zoomScale * scale;
          next = MIN(scroll.maximumZoomScale, MAX(scroll.minimumZoomScale, next));
          [scroll setZoomScale:next animated:YES];
          ok = YES;
          return;
        }
      }
    }
    ok = KokoSendSyntheticPinch(window, center, scale, duration);
  });
  return ok;
}

static UIResponder *KokoFindFirstResponder(UIView *view)
{
  if (view.isFirstResponder) return view;
  for (UIView *child in view.subviews) {
    UIResponder *r = KokoFindFirstResponder(child);
    if (r) return r;
  }
  return nil;
}

static BOOL KokoLooksLikeTextInput(UIView *view)
{
  if (!view) return NO;
  if ([view isKindOfClass:[UITextField class]] || [view isKindOfClass:[UITextView class]]) return YES;
  NSString *cls = NSStringFromClass(view.class);
  return [cls containsString:@"UITextField"] ||
         [cls containsString:@"UITextView"] ||
         [cls containsString:@"TextField"] ||
         [cls containsString:@"TextInput"];
}

/** Walk hit → ancestors to the concrete editable field (must be ON the field, not a sibling). */
static UIView *KokoNearestTextInput(UIView *hit)
{
  if (!hit) return nil;
  UIView *v = hit;
  while (v) {
    if (KokoIsOverlayMarked(v)) return nil;
    // Buttons / pressables win — e.g. "Add" sits beside TextInput in the same row.
    if ((v.accessibilityTraits & UIAccessibilityTraitButton) != 0) return nil;
    if ([v isKindOfClass:[UIControl class]] &&
        ![v isKindOfClass:[UITextField class]] &&
        ![v isKindOfClass:[UITextView class]]) {
      return nil;
    }
    if ([v isKindOfClass:[UITextField class]] || [v isKindOfClass:[UITextView class]]) {
      return v;
    }
    if (KokoLooksLikeTextInput(v)) {
      // Walking up from hit ⇒ hit is inside this wrapper; resolve concrete field.
      UIView *inner = KokoFindEditableTextInput(v);
      return inner ?: v;
    }
    v = v.superview;
  }
  // Do NOT search parent rows for sibling TextInputs — that stole Add taps.
  return nil;
}

/** Make window key + becomeFirstResponder so the software keyboard actually appears. */
static BOOL KokoFocusTextInput(UIView *field)
{
  if (!field) return NO;
  UIView *target = field;
  if (![target isKindOfClass:[UITextField class]] && ![target isKindOfClass:[UITextView class]]) {
    UIView *inner = KokoFindEditableTextInput(field);
    if (inner) target = inner;
  }
  UIWindow *w = target.window;
  if (w && !w.isKeyWindow) {
    [w makeKeyWindow];
  }
  if (![target canBecomeFirstResponder]) return NO;
  if (target.isFirstResponder) return YES;
  return [target becomeFirstResponder];
}

/** Prefer visible UITextField / UITextView (incl. RN RCTUITextField). Skip Koko overlays entirely. */
static UIView *KokoFindEditableTextInput(UIView *view)
{
  if (!view || view.hidden || view.alpha < 0.01) return nil;
  if (KokoIsOverlayMarked(view)) return nil; // do not recurse into koko chrome (chat composer etc.)
  if (KokoLooksLikeTextInput(view) && view.userInteractionEnabled) {
    // Prefer concrete UIKit fields over RN wrapper containers.
    if ([view isKindOfClass:[UITextField class]] || [view isKindOfClass:[UITextView class]]) {
      return view;
    }
  }
  // Depth-first: prefer deeper (actual field) over containers
  UIView *best = nil;
  for (UIView *child in view.subviews) {
    UIView *hit = KokoFindEditableTextInput(child);
    if (hit) best = hit;
  }
  if (best) return best;
  if (KokoLooksLikeTextInput(view) && view.userInteractionEnabled) return view;
  return nil;
}

/**
 * Type into the focused field using UIKeyInput.insertText so React Native
 * controlled TextInputs receive onChangeText (setting .text alone does not).
 */
static BOOL KokoTypeText(UIWindow *window, NSString *text, BOOL clear)
{
  UIResponder *responder = KokoFindFirstResponder(window);
  UIView *field = nil;
  if ([responder isKindOfClass:[UIView class]]) {
    NSString *cls = NSStringFromClass([(UIView *)responder class]);
    if ([responder isKindOfClass:[UITextField class]] ||
        [responder isKindOfClass:[UITextView class]] ||
        [cls containsString:@"TextField"] ||
        [cls containsString:@"TextInput"] ||
        [cls containsString:@"UITextField"]) {
      field = (UIView *)responder;
    }
  }
  if (!field) {
    field = KokoFindEditableTextInput(window);
    if (!field) return NO;
  }
  if (!KokoFocusTextInput(field)) {
    // Still try insertText if somehow focused by another path
    if (!field.isFirstResponder) return NO;
  }

  id<UIKeyInput> keyInput = nil;
  if ([field conformsToProtocol:@protocol(UIKeyInput)]) {
    keyInput = (id<UIKeyInput>)field;
  }

  if (clear) {
    if ([field isKindOfClass:[UITextField class]]) {
      UITextField *tf = (UITextField *)field;
      UITextPosition *start = tf.beginningOfDocument;
      UITextPosition *end = tf.endOfDocument;
      UITextRange *all = [tf textRangeFromPosition:start toPosition:end];
      if (all) [tf setSelectedTextRange:all];
    } else if ([field isKindOfClass:[UITextView class]]) {
      UITextView *tv = (UITextView *)field;
      UITextPosition *start = tv.beginningOfDocument;
      UITextPosition *end = tv.endOfDocument;
      UITextRange *all = [tv textRangeFromPosition:start toPosition:end];
      if (all) [tv setSelectedTextRange:all];
    }
    if (keyInput) {
      // deleteBackward until empty (works with RN)
      NSInteger guard = 0;
      while (keyInput.hasText && guard++ < 2000) {
        [keyInput deleteBackward];
      }
    } else if ([field isKindOfClass:[UITextField class]]) {
      ((UITextField *)field).text = @"";
    } else if ([field isKindOfClass:[UITextView class]]) {
      ((UITextView *)field).text = @"";
    }
  }

  if (text.length == 0) return YES;

  if (keyInput) {
    [keyInput insertText:text];
  } else if ([field conformsToProtocol:@protocol(UITextInput)]) {
    id<UITextInput> ti = (id<UITextInput>)field;
    UITextRange *sel = ti.selectedTextRange ?: [ti textRangeFromPosition:ti.endOfDocument toPosition:ti.endOfDocument];
    [ti replaceRange:sel withText:text];
  } else if ([field isKindOfClass:[UITextField class]]) {
    UITextField *tf = (UITextField *)field;
    tf.text = [NSString stringWithFormat:@"%@%@", tf.text ?: @"", text];
  } else if ([field isKindOfClass:[UITextView class]]) {
    UITextView *tv = (UITextView *)field;
    tv.text = [NSString stringWithFormat:@"%@%@", tv.text ?: @"", text];
  } else {
    return NO;
  }

  if ([field isKindOfClass:[UIControl class]]) {
    [(UIControl *)field sendActionsForControlEvents:UIControlEventEditingChanged];
  }
  [[NSNotificationCenter defaultCenter] postNotificationName:UITextFieldTextDidChangeNotification object:field];
  [[NSNotificationCenter defaultCenter] postNotificationName:UITextViewTextDidChangeNotification object:field];
  // Dismiss keyboard so the next tap (Add / submit) isn't covered or mis-hit.
  [field resignFirstResponder];
  return YES;
}
