package cn.intentcomputing.kokoagentsdk;

import android.app.Activity;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Rect;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Base64;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.CompoundButton;
import android.widget.EditText;
import android.widget.TextView;
import androidx.annotation.Nullable;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.ReadableMap;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;
import java.io.ByteArrayOutputStream;
import java.util.ArrayList;

public class KokoAgentSdkModule extends ReactContextBaseJavaModule {
  private final Handler mainHandler = new Handler(Looper.getMainLooper());

  public KokoAgentSdkModule(ReactApplicationContext reactContext) {
    super(reactContext);
  }

  @Override
  public String getName() {
    return "KokoAgentSdk";
  }

  @Override
  public java.util.Map<String, Object> getConstants() {
    java.util.HashMap<String, Object> constants = new java.util.HashMap<>();
    String packageName = getReactApplicationContext().getPackageName();
    constants.put("hostAppId", packageName != null ? packageName : "");
    return constants;
  }

  @ReactMethod
  public void dumpViewTree(ReadableMap options, Promise promise) {
    runOnUi(
        () -> {
          try {
            View root = rootView();
            if (root == null) {
              promise.reject("no_window", "No root view");
              return;
            }
            int maxDepth = options.hasKey("maxDepth") ? options.getInt("maxDepth") : 30;
            boolean skipInvisible =
                !options.hasKey("skipInvisible") || options.getBoolean("skipInvisible");
            WritableMap tree = dumpView(root, "0", 0, maxDepth, skipInvisible);
            promise.resolve(tree);
          } catch (Exception e) {
            promise.reject("dump_failed", e);
          }
        });
  }

  @ReactMethod
  public void dispatchTap(double x, double y, Promise promise) {
    runOnUi(
        () -> {
          try {
            View root = rootView();
            if (root == null) {
              promise.reject("no_window", "No root view");
              return;
            }
            boolean ok =
                withOverlaysMuted(
                    root,
                    true,
                    true,
                    () -> injectTap(root, toPx(x), toPx(y)));
            if (ok) {
              promise.resolve(null);
            } else {
              promise.reject("tap_failed", "Could not dispatch tap");
            }
          } catch (Exception e) {
            promise.reject("tap_failed", e);
          }
        });
  }

  @ReactMethod
  public void invokeAlertAction(String title, Promise promise) {
    runOnUi(
        () -> {
          String want = title == null ? "" : title.trim();
          if (want.isEmpty()) {
            promise.reject("bad_title", "title required");
            return;
          }
          try {
            if (pressLabeled(want)) {
              promise.resolve(null);
              return;
            }
            promise.reject(
                "alert_action_failed", "No alert action matching '" + want + "'");
          } catch (Exception e) {
            promise.reject("alert_action_failed", e);
          }
        });
  }

  /**
   * Press a dialog button by its label, front window first.
   *
   * Reaching dialog buttons by coordinate needs the dump and the touch to
   * agree on which window is on top; going by label works even when the
   * planner only knows what the button said. Matches iOS, where alert actions
   * are model objects with no dependable view to aim at.
   */
  private boolean pressLabeled(String title) {
    String wanted = title.toLowerCase();
    ArrayList<View> roots = allRootViews();

    for (View root : roots) {
      ArrayList<View> candidates = new ArrayList<>();
      collectLabeled(root, candidates);

      for (View v : candidates) {
        if (labelOf(v).toLowerCase().equals(wanted)) return pressView(root, v);
      }

      // Substring either way covers "确认清空" against a button reading "清空",
      // but only when it picks out one label — otherwise it is a guess.
      View only = null;
      int hits = 0;
      for (View v : candidates) {
        String label = labelOf(v).toLowerCase();
        if (label.isEmpty()) continue;
        if (label.contains(wanted) || wanted.contains(label)) {
          only = v;
          hits += 1;
        }
      }
      if (hits == 1 && only != null && pressView(root, only)) return true;
    }
    return false;
  }

  /**
   * Alert actions are not reliably clickable views: an AlertDialog's choices are
   * AdapterView rows whose click goes through the list, not the row. Land a real
   * touch at the label's centre first and only then fall back to performClick.
   */
  private boolean pressView(View root, View target) {
    int[] loc = new int[2];
    target.getLocationOnScreen(loc);
    float cx = loc[0] + target.getWidth() / 2f;
    float cy = loc[1] + target.getHeight() / 2f;
    if (dispatchTouchAt(root, cx, cy)) return true;
    for (View v = target; v != null; ) {
      if (v.isClickable() && v.isEnabled() && v.performClick()) return true;
      Object parent = v.getParent();
      v = parent instanceof View ? (View) parent : null;
    }
    return false;
  }

  private String labelOf(View v) {
    CharSequence desc = v.getContentDescription();
    if (desc != null && desc.length() > 0) return desc.toString().trim();
    String text = extractText(v);
    return text == null ? "" : text.trim();
  }

  private void collectLabeled(View v, ArrayList<View> out) {
    if (v.getVisibility() != View.VISIBLE || !v.isShown()) return;
    if (isKokoOverlay(v)) return;
    // A ViewGroup's text is only its descendants concatenated, so it is a
    // candidate solely when it carries its own contentDescription — otherwise
    // every ancestor would match and make the substring pass ambiguous.
    boolean ownsLabel =
        !(v instanceof ViewGroup) || (v.getContentDescription() != null
            && v.getContentDescription().length() > 0);
    if (ownsLabel && v.getWidth() > 0 && v.getHeight() > 0 && !labelOf(v).isEmpty()) {
      out.add(v);
    }
    if (v instanceof ViewGroup) {
      ViewGroup g = (ViewGroup) v;
      for (int i = 0; i < g.getChildCount(); i++) {
        collectLabeled(g.getChildAt(i), out);
      }
    }
  }

  @ReactMethod
  public void dispatchSwipe(
      double fromX, double fromY, double toX, double toY, double durationMs, Promise promise) {
    runOnUi(
        () -> {
          try {
            View root = rootView();
            if (root == null) {
              promise.reject("no_window", "No root view");
              return;
            }
            long duration = Math.max(50L, (long) durationMs);
            boolean ok =
                injectSwipe(
                    root, toPx(fromX), toPx(fromY), toPx(toX), toPx(toY), duration);
            if (ok) {
              promise.resolve(null);
            } else {
              promise.reject("swipe_failed", "Could not dispatch swipe");
            }
          } catch (Exception e) {
            promise.reject("swipe_failed", e);
          }
        });
  }

  /** Two-finger pinch at (x,y). scale>1 zoom in, scale<1 zoom out. */
  @ReactMethod
  public void dispatchPinch(
      double x, double y, double scale, double durationMs, Promise promise) {
    runOnUi(
        () -> {
          try {
            View root = rootView();
            if (root == null) {
              promise.reject("no_window", "No root view");
              return;
            }
            if (!(scale > 0.05 && scale < 20.0) || Double.isNaN(scale) || Double.isInfinite(scale)) {
              promise.reject("bad_scale", "scale must be a finite number around 0.05…20");
              return;
            }
            long duration = Math.max(120L, Math.min(1200L, (long) durationMs));
            boolean ok =
                withOverlaysMuted(
                    root,
                    true,
                    true,
                    () -> injectPinch(root, toPx(x), toPx(y), (float) scale, duration));
            if (ok) {
              promise.resolve(null);
            } else {
              promise.reject("pinch_failed", "Could not dispatch pinch");
            }
          } catch (Exception e) {
            promise.reject("pinch_failed", e);
          }
        });
  }

  @ReactMethod
  public void typeText(String text, boolean clear, Promise promise) {
    runOnUi(
        () -> {
          try {
            View root = rootView();
            EditText focused = findFocusedEditText(root);
            if (focused == null) {
              focused = findFirstEditText(root);
              if (focused != null) {
                focused.requestFocus();
              }
            }
            if (focused == null) {
              promise.reject("no_focus", "No focused text input");
              return;
            }
            focused.requestFocus();
            if (clear) {
              focused.setText("");
            }
            int start = focused.getSelectionStart();
            int end = focused.getSelectionEnd();
            if (start < 0) start = focused.length();
            if (end < 0) end = focused.length();
            focused.getText().replace(Math.min(start, end), Math.max(start, end), text);
            focused.setSelection(Math.min(start, end) + text.length());
            promise.resolve(null);
          } catch (Exception e) {
            promise.reject("type_failed", e);
          }
        });
  }

  @ReactMethod
  public void focusNode(String nodeId, Promise promise) {
    runOnUi(
        () -> {
          try {
            EditText field = findFirstEditText(rootView());
            if (field == null) {
              promise.reject("no_focus", "No text input to focus");
              return;
            }
            field.requestFocus();
            promise.resolve(null);
          } catch (Exception e) {
            promise.reject("focus_failed", e);
          }
        });
  }

  @ReactMethod
  public void captureScreenshot(ReadableMap options, Promise promise) {
    runOnUi(
        () -> {
          try {
            View root = rootView();
            if (root == null) {
              promise.reject("no_window", "No root view");
              return;
            }
            boolean hideOverlays =
                !options.hasKey("hideOverlays") || options.getBoolean("hideOverlays");
            WritableMap result =
                withOverlaysMuted(
                    root,
                    hideOverlays,
                    false,
                    () -> {
                      int w = root.getWidth();
                      int h = root.getHeight();
                      if (w <= 0 || h <= 0) {
                        return null;
                      }
                      Bitmap bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
                      Canvas canvas = new Canvas(bitmap);
                      root.draw(canvas);
                      ByteArrayOutputStream baos = new ByteArrayOutputStream();
                      bitmap.compress(Bitmap.CompressFormat.PNG, 100, baos);
                      String b64 = Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP);
                      WritableMap map = Arguments.createMap();
                      map.putString("pngBase64", b64);
                      map.putDouble("width", w);
                      map.putDouble("height", h);
                      map.putDouble("scale", root.getResources().getDisplayMetrics().density);
                      return map;
                    });
            if (result == null) {
              promise.reject("screenshot_failed", "Could not capture");
              return;
            }
            promise.resolve(result);
          } catch (Exception e) {
            promise.reject("screenshot_failed", e);
          }
        });
  }

  /**
   * On-device OCR, the counterpart to Vision on iOS.
   *
   * Android has no OCR in the platform, so this needs ML Kit. The dependency
   * is compileOnly: it is several megabytes of bundled models that a host
   * embedding this SDK should not pay for unless it wants text recognition, so
   * a host opts in by declaring it and we report "unavailable" otherwise.
   * Callers already treat the backend as advisory and fall back to the dump.
   */
  @ReactMethod
  public void recognizeScreenText(ReadableMap options, Promise promise) {
    runOnUi(
        () -> {
          try {
            View root = rootView();
            if (root == null) {
              promise.reject("no_window", "No root view");
              return;
            }
            boolean hideOverlays =
                !options.hasKey("hideOverlays") || options.getBoolean("hideOverlays");
            int maxTokens = options.hasKey("maxTokens") ? options.getInt("maxTokens") : 24;
            Bitmap shot =
                withOverlaysMuted(root, hideOverlays, false, () -> snapshotBitmap(root));
            if (shot == null) {
              promise.reject("ocr_failed", "Could not capture screen");
              return;
            }
            TextRecognizer recognizer = textRecognizer();
            if (recognizer == null) {
              promise.resolve(emptyOcrResult("unavailable"));
              return;
            }
            recognizer
                .process(InputImage.fromBitmap(shot, 0))
                .addOnSuccessListener(text -> promise.resolve(ocrResult(text, maxTokens, root)))
                .addOnFailureListener(e -> promise.reject("ocr_failed", e));
          } catch (LinkageError e) {
            promise.resolve(emptyOcrResult("unavailable"));
          } catch (Exception e) {
            promise.reject("ocr_failed", e);
          }
        });
  }

  @Nullable
  private Bitmap snapshotBitmap(View root) {
    int w = root.getWidth();
    int h = root.getHeight();
    if (w <= 0 || h <= 0) return null;
    Bitmap bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
    root.draw(new Canvas(bitmap));
    return bitmap;
  }

  /**
   * The Chinese model also reads Latin script, so prefer it; either artifact
   * may be the one the host declared, and neither may be present.
   */
  @Nullable
  private TextRecognizer textRecognizer() {
    try {
      return TextRecognition.getClient(new ChineseTextRecognizerOptions.Builder().build());
    } catch (LinkageError | RuntimeException ignored) {
      // Chinese model not on the classpath; try the default one.
    }
    try {
      return TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
    } catch (LinkageError | RuntimeException ignored) {
      return null;
    }
  }

  private WritableMap ocrResult(Text text, int maxTokens, View root) {
    WritableArray tokens = Arguments.createArray();
    WritableArray texts = Arguments.createArray();
    ArrayList<String> seen = new ArrayList<>();
    int[] origin = new int[2];
    root.getLocationOnScreen(origin);
    for (Text.TextBlock block : text.getTextBlocks()) {
      for (Text.Line line : block.getLines()) {
        String s = line.getText() == null ? "" : line.getText().trim();
        if (s.isEmpty()) continue;
        WritableMap entry = Arguments.createMap();
        entry.putString("text", s);
        entry.putDouble("confidence", lineConfidence(line));
        Rect bounds = line.getBoundingBox();
        if (bounds != null && bounds.width() > 0 && bounds.height() > 0) {
          // ML Kit reports pixels in the root bitmap. Agent taps use
          // window-absolute logical coordinates, so include both root origin
          // and density conversion here at the native boundary.
          WritableMap frame = Arguments.createMap();
          frame.putDouble("x", toLogical(origin[0] + bounds.left));
          frame.putDouble("y", toLogical(origin[1] + bounds.top));
          frame.putDouble("width", toLogical(bounds.width()));
          frame.putDouble("height", toLogical(bounds.height()));
          entry.putMap("frame", frame);
        }
        texts.pushMap(entry);
        if (seen.size() < maxTokens && !seen.contains(s)) {
          seen.add(s);
          tokens.pushString(s);
        }
      }
    }
    WritableMap map = Arguments.createMap();
    map.putArray("tokens", tokens);
    map.putArray("texts", texts);
    map.putString("backend", "mlkit");
    return map;
  }

  private double lineConfidence(Text.Line line) {
    try {
      Float c = line.getConfidence();
      if (c != null) return c;
    } catch (LinkageError | RuntimeException ignored) {
      // Older model artifacts do not report it.
    }
    return 1.0;
  }

  private WritableMap emptyOcrResult(String backend) {
    WritableMap map = Arguments.createMap();
    map.putArray("tokens", Arguments.createArray());
    map.putArray("texts", Arguments.createArray());
    map.putString("backend", backend);
    return map;
  }

  @ReactMethod
  public void focusAt(double x, double y, Promise promise) {
    runOnUi(
        () -> {
          try {
            View root = rootView();
            if (root == null) {
              promise.reject("no_window", "No root view");
              return;
            }
            View hit = findViewAt(root, toPx(x), toPx(y));
            EditText field = null;
            View v = hit;
            while (v != null) {
              if (v instanceof EditText) {
                field = (EditText) v;
                break;
              }
              v = v.getParent() instanceof View ? (View) v.getParent() : null;
            }
            if (field == null) {
              field = findFirstEditText(root);
            }
            if (field == null) {
              promise.reject("no_focus", "No text input to focus at point");
              return;
            }
            field.requestFocus();
            promise.resolve(null);
          } catch (Exception e) {
            promise.reject("focus_failed", e);
          }
        });
  }

  @ReactMethod
  public void dismissKeyboard(Promise promise) {
    runOnUi(
        () -> {
          try {
            Activity activity = getReactApplicationContext().getCurrentActivity();
            View root = rootView();
            if (root != null) {
              root.clearFocus();
            }
            if (activity != null) {
              android.view.inputmethod.InputMethodManager imm =
                  (android.view.inputmethod.InputMethodManager)
                      activity.getSystemService(android.content.Context.INPUT_METHOD_SERVICE);
              View focus = activity.getCurrentFocus();
              if (imm != null && focus != null) {
                imm.hideSoftInputFromWindow(focus.getWindowToken(), 0);
              } else if (imm != null && root != null) {
                imm.hideSoftInputFromWindow(root.getWindowToken(), 0);
              }
            }
            promise.resolve(null);
          } catch (Exception e) {
            promise.reject("keyboard_failed", e);
          }
        });
  }

  @ReactMethod
  public void scrollIntoView(double x, double y, Promise promise) {
    // No-op: page ScrollViews jumped before tap (looked like a secret swipe).
    promise.resolve(null);
  }

  /**
   * Everything crossing the bridge is in RN logical units, matching iOS points,
   * because the JS side lays the cursor and chrome out in those units. Android
   * view geometry is pixels, so convert at the boundary and keep the native
   * helpers pixel-only.
   */
  private float density() {
    return getReactApplicationContext().getResources().getDisplayMetrics().density;
  }

  private float toPx(double logical) {
    return (float) (logical * density());
  }

  private double toLogical(float px) {
    return px / density();
  }

  /**
   * Prefer the front-most decor view (includes dialogs / popups when available).
   */
  @Nullable
  private View rootView() {
    return topMostRootView();
  }

  @Nullable
  @SuppressWarnings("unchecked")
  private View topMostRootView() {
    ArrayList<View> roots = allRootViews();
    return roots.isEmpty() ? null : roots.get(0);
  }

  /**
   * Every attached window root, front to back.
   *
   * Dialogs, popups and menus each get their own window, so anything that only
   * looks at the activity's decor view cannot see them.
   */
  private ArrayList<View> allRootViews() {
    ArrayList<View> out = new ArrayList<>();
    try {
      Class<?> wmg = Class.forName("android.view.WindowManagerGlobal");
      Object instance = wmg.getMethod("getInstance").invoke(null);
      java.lang.reflect.Field viewsField = wmg.getDeclaredField("mViews");
      viewsField.setAccessible(true);
      Object raw = viewsField.get(instance);
      if (raw instanceof java.util.List) {
        java.util.List<View> views = (java.util.List<View>) raw;
        for (int i = views.size() - 1; i >= 0; i--) {
          View v = views.get(i);
          if (v != null && v.getVisibility() == View.VISIBLE && v.isShown()) {
            View root = v.getRootView();
            if (!out.contains(root) && !isKokoOwnedWindow(root)) out.add(root);
          }
        }
      }
    } catch (Throwable ignored) {
      // Hidden API; fall back to the activity below.
    }
    if (out.isEmpty()) {
      Activity activity = getReactApplicationContext().getCurrentActivity();
      if (activity != null && activity.getWindow() != null) {
        out.add(activity.getWindow().getDecorView().getRootView());
      }
    }
    return out;
  }

  /**
   * A window holding nothing but SDK chrome. Hosts that fall back to the Modal
   * overlay would otherwise put it in front of their own window, and dump /
   * tap would aim at the progress pill instead of the App.
   */
  private boolean isKokoOwnedWindow(View root) {
    View content = root.findViewById(android.R.id.content);
    return subtreeIsAllKoko(content != null ? content : root);
  }

  private boolean subtreeIsAllKoko(View v) {
    if (isKokoOverlay(v)) return true;
    if (!(v instanceof ViewGroup)) return false;
    ViewGroup g = (ViewGroup) v;
    boolean sawKoko = false;
    for (int i = 0; i < g.getChildCount(); i++) {
      View c = g.getChildAt(i);
      if (c.getVisibility() != View.VISIBLE) continue;
      if (!subtreeIsAllKoko(c)) return false;
      sawKoko = true;
    }
    return sawKoko;
  }

  @Nullable
  private View findViewAt(View root, float x, float y) {
    if (root == null) return null;
    int[] loc = new int[2];
    root.getLocationOnScreen(loc);
    float lx = x - loc[0];
    float ly = y - loc[1];
    return findViewAtLocal(root, lx, ly);
  }

  @Nullable
  private View findViewAtLocal(View view, float x, float y) {
    if (view.getVisibility() != View.VISIBLE) return null;
    if (x < 0 || y < 0 || x > view.getWidth() || y > view.getHeight()) return null;
    if (view instanceof ViewGroup) {
      ViewGroup g = (ViewGroup) view;
      for (int i = g.getChildCount() - 1; i >= 0; i--) {
        View child = g.getChildAt(i);
        float cx = x - child.getLeft() + view.getScrollX();
        float cy = y - child.getTop() + view.getScrollY();
        View hit = findViewAtLocal(child, cx, cy);
        if (hit != null) return hit;
      }
    }
    return view;
  }

  private void runOnUi(Runnable block) {
    if (Looper.myLooper() == Looper.getMainLooper()) {
      block.run();
    } else {
      mainHandler.post(block);
    }
  }

  @Nullable
  private WritableMap dumpView(
      View view, String path, int depth, int maxDepth, boolean skipInvisible) {
    if (depth > maxDepth) {
      return null;
    }
    if (isKokoOverlay(view)) {
      return null;
    }
    boolean visible =
        view.getVisibility() == View.VISIBLE
            && view.isShown()
            && view.getWidth() > 0
            && view.getHeight() > 0;
    if (skipInvisible && !visible) {
      return null;
    }

    int[] loc = new int[2];
    view.getLocationOnScreen(loc);

    WritableArray children = Arguments.createArray();
    if (view instanceof ViewGroup) {
      ViewGroup group = (ViewGroup) view;
      for (int i = 0; i < group.getChildCount(); i++) {
        WritableMap child =
            dumpView(group.getChildAt(i), path + "/" + i, depth + 1, maxDepth, skipInvisible);
        if (child != null) {
          children.pushMap(child);
        }
      }
    }

    WritableMap map = Arguments.createMap();
    map.putString("id", path);
    map.putString("type", view.getClass().getName());
    WritableMap frame = Arguments.createMap();
    frame.putDouble("x", toLogical(loc[0]));
    frame.putDouble("y", toLogical(loc[1]));
    frame.putDouble("width", toLogical(view.getWidth()));
    frame.putDouble("height", toLogical(view.getHeight()));
    map.putMap("frame", frame);
    CharSequence desc = view.getContentDescription();
    boolean clickable = view.isClickable() || view.isLongClickable();
    // RN: labeled + focusable views are often press targets even if clickable flag is false.
    if (!clickable && desc != null && desc.length() > 0 && view.isFocusable()) {
      clickable = true;
    }
    String cls = view.getClass().getName();
    if (!clickable
        && (cls.contains("Button")
            || cls.contains("Switch")
            || cls.contains("CheckBox")
            || cls.contains("Radio")
            || cls.contains("Spinner")
            || cls.contains("Chip")
            || cls.contains("Tab"))) {
      clickable = view.isEnabled();
    }
    map.putBoolean("clickable", clickable);
    map.putBoolean("enabled", view.isEnabled());
    map.putBoolean("visible", visible);
    map.putBoolean("scrollable", view.canScrollVertically(1) || view.canScrollVertically(-1));
    map.putBoolean("clipsChildren", view instanceof ViewGroup && ((ViewGroup) view).getClipChildren());
    map.putArray("children", children);

    String text = extractText(view);
    if (text != null && !text.isEmpty()) {
      map.putString("text", text);
    }
    if (desc != null && desc.length() > 0) {
      map.putString("accessibilityLabel", desc.toString());
    }
    if (cls.contains("Switch") || cls.contains("CheckBox") || cls.contains("Toggle")) {
      map.putBoolean("toggle", true);
    }
    if (cls.contains("Spinner")
        || cls.contains("Picker")
        || cls.contains("SeekBar")
        || cls.contains("Rating")
        || cls.contains("Slider")
        || cls.contains("Stepper")
        || cls.contains("NumberPicker")
        || cls.contains("Segmented")) {
      map.putBoolean("adjustable", true);
    }
    if (view instanceof android.widget.SeekBar) {
      android.widget.SeekBar bar = (android.widget.SeekBar) view;
      map.putDouble("value", bar.getProgress());
      map.putDouble("min", 0);
      map.putDouble("max", bar.getMax());
    }
    if (view instanceof android.widget.NumberPicker) {
      android.widget.NumberPicker np = (android.widget.NumberPicker) view;
      map.putDouble("value", np.getValue());
      map.putDouble("min", np.getMinValue());
      map.putDouble("max", np.getMaxValue());
    }
    if (cls.contains("Dialog") || cls.contains("Popup") || cls.contains("BottomSheet")) {
      map.putBoolean("sheet", true);
    }
    if (view instanceof EditText) {
      int inputType = ((EditText) view).getInputType();
      int variation = inputType & android.text.InputType.TYPE_MASK_VARIATION;
      boolean secure =
          variation == android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD
              || variation == android.text.InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
              || variation == android.text.InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD
              || variation == android.text.InputType.TYPE_NUMBER_VARIATION_PASSWORD
              || ((EditText) view).getTransformationMethod()
                  instanceof android.text.method.PasswordTransformationMethod;
      if (secure) {
        map.putBoolean("secure", true);
        map.putString("text", "[redacted]");
        map.putString("accessibilityLabel", null);
      }
    }
    Object tag = view.getTag();
    if (tag != null) {
      String tagStr = String.valueOf(tag);
      if (!tagStr.isEmpty() && !tagStr.startsWith("android.")) {
        map.putString("testID", tagStr);
      }
    }
    return map;
  }

  @Nullable
  private String extractText(View view) {
    if (view instanceof EditText) {
      int variation = ((EditText) view).getInputType() & android.text.InputType.TYPE_MASK_VARIATION;
      if (variation == android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD
          || variation == android.text.InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
          || variation == android.text.InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD
          || variation == android.text.InputType.TYPE_NUMBER_VARIATION_PASSWORD
          || ((EditText) view).getTransformationMethod() instanceof android.text.method.PasswordTransformationMethod) {
        return "[redacted]";
      }
    }
    if (view instanceof TextView) {
      CharSequence t = ((TextView) view).getText();
      if (t != null && t.length() > 0) {
        return t.toString();
      }
    }
    if (view instanceof ViewGroup) {
      ViewGroup group = (ViewGroup) view;
      ArrayList<String> parts = new ArrayList<>();
      for (int i = 0; i < group.getChildCount(); i++) {
        String t = extractText(group.getChildAt(i));
        if (t != null && !t.isEmpty()) {
          parts.add(t);
        }
      }
      if (!parts.isEmpty()) {
        return join(parts, " ");
      }
    }
    return null;
  }

  private static String join(ArrayList<String> parts, String sep) {
    StringBuilder sb = new StringBuilder();
    for (int i = 0; i < parts.size(); i++) {
      if (i > 0) sb.append(sep);
      sb.append(parts.get(i));
    }
    return sb.toString();
  }

  private boolean isKokoOverlay(View view) {
    String id = kokoOverlayId(view);
    return id != null && id.startsWith("koko-agent-");
  }

  /** Progress / sheet chrome only — cursor stays visible during tap. */
  private boolean isKokoChromeToMute(View view) {
    String id = kokoOverlayId(view);
    return id != null && (id.equals("koko-agent-overlay") || id.startsWith("koko-agent-overlay/"));
  }

  private String kokoOverlayId(View view) {
    Object tag = view.getTag();
    if (tag != null) {
      String s = String.valueOf(tag);
      if (s.startsWith("koko-agent-")) return s;
    }
    try {
      int resId =
          view.getResources()
              .getIdentifier("react_test_id", "id", view.getContext().getPackageName());
      if (resId == 0) {
        resId =
            view.getResources()
                .getIdentifier("react_test_id", "id", "com.facebook.react");
      }
      if (resId != 0) {
        Object t = view.getTag(resId);
        if (t != null) {
          String s = String.valueOf(t);
          if (s.startsWith("koko-agent-")) return s;
        }
      }
    } catch (Exception ignored) {
    }
    return null;
  }

  private void collectOverlayRoots(View view, ArrayList<View> out, boolean hide) {
    // Captures must also hide the cursor so it cannot obscure OCR targets.
    // Touch dispatch still mutes only interactive chrome and keeps it visible.
    if (hide ? isKokoOverlay(view) : isKokoChromeToMute(view)) {
      out.add(view);
      return;
    }
    if (isKokoOverlay(view)) {
      return;
    }
    if (view instanceof ViewGroup) {
      ViewGroup g = (ViewGroup) view;
      for (int i = 0; i < g.getChildCount(); i++) {
        collectOverlayRoots(g.getChildAt(i), out, hide);
      }
    }
  }

  private interface OverlayAction<T> {
    T run();
  }

  private <T> T withOverlaysMuted(
      View root, boolean hide, boolean disableInteraction, OverlayAction<T> action) {
    ArrayList<View> overlays = new ArrayList<>();
    collectOverlayRoots(root, overlays, hide);
    ArrayList<Integer> vis = new ArrayList<>();
    ArrayList<Boolean> enabled = new ArrayList<>();
    ArrayList<Boolean> clickable = new ArrayList<>();
    for (View v : overlays) {
      vis.add(v.getVisibility());
      enabled.add(v.isEnabled());
      clickable.add(v.isClickable());
      if (hide) {
        v.setVisibility(View.INVISIBLE);
      }
      if (disableInteraction) {
        v.setEnabled(false);
        v.setClickable(false);
      }
    }
    try {
      return action.run();
    } finally {
      for (int i = 0; i < overlays.size(); i++) {
        View v = overlays.get(i);
        v.setVisibility(vis.get(i));
        v.setEnabled(enabled.get(i));
        v.setClickable(clickable.get(i));
      }
    }
  }

  private boolean injectTap(View root, float x, float y) {
    View hit = findTopChildAt(root, x, y);
    if (hit != null) {
      CompoundButton toggle = findToggle(hit);
      if (toggle != null) {
        // Prefer a short horizontal slide (thumb motion) over a click.
        int[] loc = new int[2];
        toggle.getLocationOnScreen(loc);
        float midY = loc[1] + toggle.getHeight() / 2f;
        float inset = Math.max(6f, toggle.getWidth() * 0.18f);
        boolean on = toggle.isChecked();
        float fromX = on ? loc[0] + toggle.getWidth() - inset : loc[0] + inset;
        float toX = on ? loc[0] + inset : loc[0] + toggle.getWidth() - inset;
        if (injectSwipe(root, fromX, midY, toX, midY, 220)) {
          if (toggle.isChecked() == on) {
            toggle.setChecked(!on);
          }
          return true;
        }
        toggle.toggle();
        return true;
      }
      View v = hit;
      while (v != null) {
        if (v instanceof android.widget.SeekBar) {
          android.widget.SeekBar bar = (android.widget.SeekBar) v;
          int[] loc = new int[2];
          bar.getLocationOnScreen(loc);
          float span = Math.max(1f, bar.getWidth());
          float ratio = (x - loc[0]) / span;
          ratio = Math.max(0f, Math.min(1f, ratio));
          bar.setProgress(Math.round(ratio * bar.getMax()));
          return true;
        }
        if (v instanceof android.widget.NumberPicker) {
          android.widget.NumberPicker np = (android.widget.NumberPicker) v;
          int[] loc = new int[2];
          np.getLocationOnScreen(loc);
          if (y < loc[1] + np.getHeight() / 2f) {
            np.setValue(Math.min(np.getMaxValue(), np.getValue() + 1));
          } else {
            np.setValue(Math.max(np.getMinValue(), np.getValue() - 1));
          }
          return true;
        }
        Object parent = v.getParent();
        v = parent instanceof View ? (View) parent : null;
      }
    }
    // Aim at the press target rather than the text leaf under the finger: RN
    // puts the handler on the wrapper, and a leaf can sit outside its bounds.
    View press = bestPressTarget(hit);
    float px = x;
    float py = y;
    if (press != null && press != hit) {
      int[] loc = new int[2];
      press.getLocationOnScreen(loc);
      if (press.getWidth() > 0 && press.getHeight() > 0) {
        px = loc[0] + press.getWidth() / 2f;
        py = loc[1] + press.getHeight() / 2f;
      }
    }

    if (dispatchTouchAt(root, px, py)) return true;

    // The event can be swallowed by a scroll container between the root and
    // the target, which leaves the press target untouched. Call it directly.
    for (View v = press != null ? press : hit; v != null; ) {
      if (v.isClickable() && v.isEnabled() && v.performClick()) return true;
      Object parent = v.getParent();
      v = parent instanceof View ? (View) parent : null;
    }
    return false;
  }

  /**
   * Screen position of {@code root}.
   *
   * dispatchTouchEvent reads events in root-local coordinates while the dump
   * reports screen ones. They only agree while root sits at the screen origin,
   * which stops being true as soon as a dialog window is on top.
   */
  private float[] rootOrigin(View root) {
    int[] loc = new int[2];
    root.getLocationOnScreen(loc);
    return new float[] {loc[0], loc[1]};
  }

  /** Send a down/up pair to {@code root}, in that view's coordinate space. */
  private boolean dispatchTouchAt(View root, float screenX, float screenY) {
    float[] o = rootOrigin(root);
    float x = screenX - o[0];
    float y = screenY - o[1];
    long downTime = SystemClock.uptimeMillis();
    MotionEvent down = MotionEvent.obtain(downTime, downTime, MotionEvent.ACTION_DOWN, x, y, 0);
    MotionEvent up =
        MotionEvent.obtain(downTime, downTime + 40, MotionEvent.ACTION_UP, x, y, 0);
    boolean d = root.dispatchTouchEvent(down);
    boolean u = root.dispatchTouchEvent(up);
    down.recycle();
    up.recycle();
    return d || u;
  }

  /**
   * Nearest ancestor that looks like something you press.
   *
   * Mirrors the iOS press-target climb so both platforms aim at the same node
   * for the same tree.
   */
  @Nullable
  private View bestPressTarget(@Nullable View from) {
    View v = from;
    while (v != null) {
      if (v.isClickable() || v.isLongClickable()) return v;
      String cls = v.getClass().getName();
      if (cls.contains("Button") || cls.contains("Pressab") || cls.contains("Touchable")) {
        return v;
      }
      Object parent = v.getParent();
      v = parent instanceof View ? (View) parent : null;
    }
    return from;
  }

  @Nullable
  private CompoundButton findToggle(@Nullable View view) {
    View v = view;
    while (v != null) {
      if (v instanceof CompoundButton) {
        String cls = v.getClass().getName();
        if (cls.contains("Switch") || cls.contains("Toggle") || cls.contains("CheckBox")) {
          return (CompoundButton) v;
        }
      }
      Object parent = v.getParent();
      v = parent instanceof View ? (View) parent : null;
    }
    return null;
  }

  @Nullable
  private View findTopChildAt(View root, float x, float y) {
    if (root instanceof ViewGroup) {
      ViewGroup g = (ViewGroup) root;
      for (int i = g.getChildCount() - 1; i >= 0; i--) {
        View child = g.getChildAt(i);
        if (child.getVisibility() != View.VISIBLE) continue;
        int[] loc = new int[2];
        child.getLocationOnScreen(loc);
        if (x >= loc[0]
            && x <= loc[0] + child.getWidth()
            && y >= loc[1]
            && y <= loc[1] + child.getHeight()) {
          View deeper = findTopChildAt(child, x, y);
          return deeper != null ? deeper : child;
        }
      }
    }
    return root;
  }

  private boolean injectSwipe(
      View root, float fromX, float fromY, float toX, float toY, long durationMs) {
    // SeekBar: set progress from end X.
    View hit = findTopChildAt(root, fromX, fromY);
    if (hit != null) {
      View v = hit;
      while (v != null) {
        if (v instanceof android.widget.SeekBar) {
          android.widget.SeekBar bar = (android.widget.SeekBar) v;
          int[] loc = new int[2];
          bar.getLocationOnScreen(loc);
          float span = Math.max(1f, bar.getWidth());
          float ratio = (toX - loc[0]) / span;
          ratio = Math.max(0f, Math.min(1f, ratio));
          int next = Math.round(ratio * bar.getMax());
          bar.setProgress(next);
          return true;
        }
        Object parent = v.getParent();
        v = parent instanceof View ? (View) parent : null;
      }
    }

    float[] o = rootOrigin(root);
    float sx = fromX - o[0];
    float sy = fromY - o[1];
    float ex = toX - o[0];
    float ey = toY - o[1];

    long downTime = SystemClock.uptimeMillis();
    MotionEvent down =
        MotionEvent.obtain(downTime, downTime, MotionEvent.ACTION_DOWN, sx, sy, 0);
    root.dispatchTouchEvent(down);
    down.recycle();

    int steps = 8;
    for (int i = 1; i <= steps; i++) {
      float t = i / (float) steps;
      float x = sx + (ex - sx) * t;
      float y = sy + (ey - sy) * t;
      long moveTime = downTime + durationMs * i / steps;
      MotionEvent move =
          MotionEvent.obtain(downTime, moveTime, MotionEvent.ACTION_MOVE, x, y, 0);
      root.dispatchTouchEvent(move);
      move.recycle();
    }

    MotionEvent up =
        MotionEvent.obtain(downTime, downTime + durationMs, MotionEvent.ACTION_UP, ex, ey, 0);
    boolean ok = root.dispatchTouchEvent(up);
    up.recycle();
    return ok;
  }

  /** Two-finger pinch gesture centered at the screen point (cx, cy). */
  private boolean injectPinch(View root, float cx, float cy, float scale, long durationMs) {
    float[] o = rootOrigin(root);
    cx -= o[0];
    cy -= o[1];
    float startHalf = 48f;
    float endHalf = Math.max(10f, Math.min(260f, startHalf * scale));

    float p1sx = cx - startHalf;
    float p1sy = cy;
    float p2sx = cx + startHalf;
    float p2sy = cy;
    float p1ex = cx - endHalf;
    float p1ey = cy;
    float p2ex = cx + endHalf;
    float p2ey = cy;

    long downTime = SystemClock.uptimeMillis();
    MotionEvent.PointerProperties[] props = new MotionEvent.PointerProperties[2];
    props[0] = new MotionEvent.PointerProperties();
    props[0].id = 0;
    props[0].toolType = MotionEvent.TOOL_TYPE_FINGER;
    props[1] = new MotionEvent.PointerProperties();
    props[1].id = 1;
    props[1].toolType = MotionEvent.TOOL_TYPE_FINGER;

    MotionEvent.PointerCoords[] coords = new MotionEvent.PointerCoords[2];
    coords[0] = new MotionEvent.PointerCoords();
    coords[0].x = p1sx;
    coords[0].y = p1sy;
    coords[0].pressure = 1f;
    coords[0].size = 1f;
    coords[1] = new MotionEvent.PointerCoords();
    coords[1].x = p2sx;
    coords[1].y = p2sy;
    coords[1].pressure = 1f;
    coords[1].size = 1f;

    MotionEvent down0 =
        MotionEvent.obtain(
            downTime,
            downTime,
            MotionEvent.ACTION_DOWN,
            1,
            props,
            coords,
            0,
            0,
            1f,
            1f,
            0,
            0,
            0,
            0);
    root.dispatchTouchEvent(down0);
    down0.recycle();

    int pointer1Down =
        MotionEvent.ACTION_POINTER_DOWN | (1 << MotionEvent.ACTION_POINTER_INDEX_SHIFT);
    MotionEvent down1 =
        MotionEvent.obtain(
            downTime,
            downTime + 10,
            pointer1Down,
            2,
            props,
            coords,
            0,
            0,
            1f,
            1f,
            0,
            0,
            0,
            0);
    root.dispatchTouchEvent(down1);
    down1.recycle();

    int steps = Math.max(4, (int) (durationMs / 30));
    for (int i = 1; i <= steps; i++) {
      float t = i / (float) steps;
      coords[0].x = p1sx + (p1ex - p1sx) * t;
      coords[0].y = p1sy + (p1ey - p1sy) * t;
      coords[1].x = p2sx + (p2ex - p2sx) * t;
      coords[1].y = p2sy + (p2ey - p2sy) * t;
      long moveTime = downTime + durationMs * i / steps;
      MotionEvent move =
          MotionEvent.obtain(
              downTime,
              moveTime,
              MotionEvent.ACTION_MOVE,
              2,
              props,
              coords,
              0,
              0,
              1f,
              1f,
              0,
              0,
              0,
              0);
      root.dispatchTouchEvent(move);
      move.recycle();
    }

    coords[0].x = p1ex;
    coords[0].y = p1ey;
    coords[1].x = p2ex;
    coords[1].y = p2ey;
    int pointer1Up =
        MotionEvent.ACTION_POINTER_UP | (1 << MotionEvent.ACTION_POINTER_INDEX_SHIFT);
    MotionEvent up1 =
        MotionEvent.obtain(
            downTime,
            downTime + durationMs,
            pointer1Up,
            2,
            props,
            coords,
            0,
            0,
            1f,
            1f,
            0,
            0,
            0,
            0);
    root.dispatchTouchEvent(up1);
    up1.recycle();

    MotionEvent up0 =
        MotionEvent.obtain(
            downTime,
            downTime + durationMs + 10,
            MotionEvent.ACTION_UP,
            1,
            props,
            coords,
            0,
            0,
            1f,
            1f,
            0,
            0,
            0,
            0);
    boolean ok = root.dispatchTouchEvent(up0);
    up0.recycle();
    return ok;
  }

  @Nullable
  private EditText findFocusedEditText(@Nullable View view) {
    if (view == null) return null;
    if (view instanceof EditText && view.isFocused()) {
      return (EditText) view;
    }
    if (view instanceof ViewGroup) {
      ViewGroup group = (ViewGroup) view;
      for (int i = 0; i < group.getChildCount(); i++) {
        EditText hit = findFocusedEditText(group.getChildAt(i));
        if (hit != null) return hit;
      }
    }
    return null;
  }

  @Nullable
  private EditText findFirstEditText(@Nullable View view) {
    if (view == null) return null;
    if (view instanceof EditText && view.getVisibility() == View.VISIBLE) {
      return (EditText) view;
    }
    if (view instanceof ViewGroup) {
      ViewGroup group = (ViewGroup) view;
      EditText best = null;
      for (int i = 0; i < group.getChildCount(); i++) {
        EditText hit = findFirstEditText(group.getChildAt(i));
        if (hit != null) best = hit;
      }
      return best;
    }
    return null;
  }
}
