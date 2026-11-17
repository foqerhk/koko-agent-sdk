package cn.intentcomputing.kokoagentsdk;

import android.graphics.Bitmap;
import android.graphics.Rect;
import androidx.annotation.Nullable;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;
import java.util.ArrayList;

/** Loaded by name only after optional OCR APIs have been found at runtime. */
public final class KokoMlKitOcr implements KokoOcrEngine {
  public KokoMlKitOcr() {}

  @Override
  public void recognize(Bitmap bitmap, int maxTokens, int originX, int originY, float density, Promise promise) {
    TextRecognizer recognizer = recognizer();
    if (recognizer == null) {
      bitmap.recycle();
      WritableMap empty = Arguments.createMap();
      empty.putArray("tokens", Arguments.createArray());
      empty.putArray("texts", Arguments.createArray());
      empty.putString("backend", "unavailable");
      promise.resolve(empty);
      return;
    }
    try {
      recognizer.process(InputImage.fromBitmap(bitmap, 0))
          .addOnSuccessListener(text -> promise.resolve(result(text, maxTokens, originX, originY, density)))
          .addOnFailureListener(error -> promise.reject("ocr_failed", error))
          .addOnCompleteListener(task -> {
            recognizer.close();
            if (!bitmap.isRecycled()) bitmap.recycle();
          });
    } catch (RuntimeException | LinkageError error) {
      recognizer.close();
      if (!bitmap.isRecycled()) bitmap.recycle();
      throw error;
    }
  }

  @Nullable
  private TextRecognizer recognizer() {
    try { return Chinese.create(); } catch (LinkageError | RuntimeException ignored) {}
    try { return Latin.create(); } catch (LinkageError | RuntimeException ignored) { return null; }
  }

  // Keep model-specific classes out of one another's method descriptors.
  private static final class Chinese {
    static TextRecognizer create() {
      return TextRecognition.getClient(new ChineseTextRecognizerOptions.Builder().build());
    }
  }
  private static final class Latin {
    static TextRecognizer create() {
      return TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
    }
  }

  private WritableMap result(Text text, int maxTokens, int originX, int originY, float density) {
    WritableArray tokens = Arguments.createArray();
    WritableArray texts = Arguments.createArray();
    ArrayList<String> seen = new ArrayList<>();
    for (Text.TextBlock block : text.getTextBlocks()) {
      for (Text.Line line : block.getLines()) {
        String value = line.getText() == null ? "" : line.getText().trim();
        if (value.isEmpty()) continue;
        WritableMap entry = Arguments.createMap();
        entry.putString("text", value);
        Float confidence = null;
        try { confidence = line.getConfidence(); } catch (LinkageError | RuntimeException ignored) {}
        entry.putDouble("confidence", confidence == null ? 1.0 : confidence);
        Rect bounds = line.getBoundingBox();
        if (bounds != null && bounds.width() > 0 && bounds.height() > 0) {
          WritableMap frame = Arguments.createMap();
          frame.putDouble("x", (originX + bounds.left) / density);
          frame.putDouble("y", (originY + bounds.top) / density);
          frame.putDouble("width", bounds.width() / density);
          frame.putDouble("height", bounds.height() / density);
          entry.putMap("frame", frame);
        }
        texts.pushMap(entry);
        if (seen.size() < maxTokens && !seen.contains(value)) { seen.add(value); tokens.pushString(value); }
      }
    }
    WritableMap out = Arguments.createMap();
    out.putArray("tokens", tokens);
    out.putArray("texts", texts);
    out.putString("backend", "mlkit");
    return out;
  }
}
