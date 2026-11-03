#ifndef KokoScrollBounds_h
#define KokoScrollBounds_h
#include <math.h>

static inline int KokoScrollHasRange(double content, double viewport,
                                     double leading, double trailing) {
  return isfinite(content) && isfinite(viewport) &&
    content + leading + trailing > viewport + 1.0;
}

/* UIKit permits programmatic offsets past both ends, unlike a settled drag. */
static inline double KokoBoundedScrollOffset(double current, double delta,
                                             double content, double viewport,
                                             double leading, double trailing) {
  double minimum = -leading;
  double maximum = fmax(minimum, content - viewport + trailing);
  double next = current + delta;
  if (!isfinite(next)) next = minimum;
  return fmax(minimum, fmin(maximum, next));
}
#endif
