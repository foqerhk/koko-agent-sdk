#include <assert.h>
#include "../KokoAgentSdk/KokoScrollBounds.h"

int main(void) {
  assert(KokoScrollHasRange(1200, 800, 0, 0));
  assert(!KokoScrollHasRange(200, 800, 0, 0));
  assert(!KokoScrollHasRange(800, 800, 0, 0));
  assert(KokoScrollHasRange(800, 800, 20, 0));
  assert(!KokoScrollHasRange(NAN, 800, 0, 0));
  assert(KokoBoundedScrollOffset(0, -500, 1200, 800, 0, 0) == 0);
  assert(KokoBoundedScrollOffset(300, 500, 1200, 800, 0, 0) == 400);
  assert(KokoBoundedScrollOffset(0, -500, 1200, 800, 20, 10) == -20);
  assert(KokoBoundedScrollOffset(300, 500, 1200, 800, 20, 10) == 410);
  assert(KokoBoundedScrollOffset(0, 500, 200, 800, 0, 0) == 0);
  return 0;
}
