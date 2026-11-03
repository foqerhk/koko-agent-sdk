#ifndef KokoOcrBounds_h
#define KokoOcrBounds_h
#include <math.h>

typedef struct { double x, y, width, height; } KokoOcrFrame;

/* Vision's normalized bottom-left rectangle -> window points, top-left origin. */
static inline int KokoOcrWindowFrame(double x, double y, double width, double height,
                                     double windowWidth, double windowHeight, KokoOcrFrame *out) {
  if (!out || !isfinite(x) || !isfinite(y) || !isfinite(width) || !isfinite(height) ||
      !isfinite(windowWidth) || !isfinite(windowHeight) || width <= 0 || height <= 0 ||
      windowWidth <= 0 || windowHeight <= 0) return 0;
  const double left = fmax(0, x), right = fmin(1, x + width);
  const double bottom = fmax(0, y), top = fmin(1, y + height);
  if (right <= left || top <= bottom) return 0;
  *out = (KokoOcrFrame){ left * windowWidth, (1 - top) * windowHeight,
                         (right - left) * windowWidth, (top - bottom) * windowHeight };
  return 1;
}
#endif
