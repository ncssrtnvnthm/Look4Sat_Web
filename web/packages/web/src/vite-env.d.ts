/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare module '*.wasm' {
  const content: WebAssembly.Module;
  export default content;
}
