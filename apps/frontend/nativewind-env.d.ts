/// <reference types="nativewind/types" />

/**
 * NativeWind processes the stylesheet through the Metro/babel pipeline, so the
 * `import '../global.css'` side-effect import has no TypeScript module shape.
 */
declare module '*.css';

declare module '*.png' {
  const asset: number;
  export default asset;
}
