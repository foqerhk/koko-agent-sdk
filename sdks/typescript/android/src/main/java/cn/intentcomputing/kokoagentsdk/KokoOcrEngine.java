package cn.intentcomputing.kokoagentsdk;

import android.graphics.Bitmap;
import com.facebook.react.bridge.Promise;

/** The bridge can load this interface without any optional ML Kit classes. */
interface KokoOcrEngine {
  void recognize(Bitmap bitmap, int maxTokens, int originX, int originY, float density, Promise promise);
}
