// Lets Node run the kit's TypeScript, and the viewer's and the e2e suite's modules it reuses, without a build. Node
// strips the types itself. What it cannot do is find `./manifest` or `./hlsTags.js` when the file is `.ts`, as a
// bundler does, so a relative import that fails is tried again with the TypeScript extension.
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (!specifier.startsWith('.')) throw error;
      const candidates = [specifier.replace(/\.js$/, '.ts'), `${specifier}.ts`, `${specifier}/index.ts`];
      for (const candidate of candidates) {
        if (candidate === specifier) continue;
        try {
          return nextResolve(candidate, context);
        } catch {
          // the next spelling
        }
      }
      throw error;
    }
  },
});
