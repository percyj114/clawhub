# Offscreen home image proof

At a 1280 x 720 viewport, the initial document changed from 49 image preload links to 1, while the jsDelivr preconnect changed from 1 to 0. An uncached development reload observed 71 to 15 initial image requests and 3,330,822 to 354,926 encoded image bytes.

The remaining preload is the first-viewport ClawHub logo. The LCP element remained the `Install` headline, and that logo retained its 123 x 128 natural dimensions and low request priority. After scrolling, all 3 Apps images and all 52 Footer images had non-zero natural dimensions; category switching, marquee content, links, and labels remained functional.

The candidate still requested 12 jsDelivr icon masks at low priority when the Apps section entered the browser's native loading threshold. This proof establishes removal of eager scheduling, not removal of the underlying visible resources.
