#include <assert.h>
#include "../KokoAgentSdk/KokoOcrBounds.h"

int main(void) {
  KokoOcrFrame frame;
  assert(KokoOcrWindowFrame(.25, .7, .5, .1, 400, 800, &frame));
  assert(fabs(frame.x - 100) < 1e-6 && fabs(frame.y - 160) < 1e-6);
  assert(fabs(frame.width - 200) < 1e-6 && fabs(frame.height - 80) < 1e-6);
  assert(KokoOcrWindowFrame(-.1, .9, .3, .2, 400, 800, &frame));
  assert(fabs(frame.x) < 1e-6 && fabs(frame.y) < 1e-6);
  assert(fabs(frame.width - 80) < 1e-6 && fabs(frame.height - 80) < 1e-6);
  assert(!KokoOcrWindowFrame(0, 0, 0, 1, 400, 800, &frame));
  assert(!KokoOcrWindowFrame(NAN, 0, 1, 1, 400, 800, &frame));
  assert(!KokoOcrWindowFrame(2, 0, 1, 1, 400, 800, &frame));
  return 0;
}
