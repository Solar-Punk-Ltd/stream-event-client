/**
 * jsdom has no `Element.scrollTo`, which every browser the page supports has. It moves `scrollTop` at
 * once, which is all a suite without layout can see. Suites in the node environment have no Element.
 */
if (typeof Element !== 'undefined' && typeof Element.prototype.scrollTo !== 'function') {
  Element.prototype.scrollTo = function scrollTo(this: Element, options?: ScrollToOptions | number) {
    if (typeof options === 'object' && options.top !== undefined) {
      this.scrollTop = options.top;
    }
  } as Element['scrollTo'];
}
