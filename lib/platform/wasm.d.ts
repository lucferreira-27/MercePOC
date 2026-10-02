/** Módulos `.wasm` chegam compilados no Worker (CompiledWasm do @cloudflare/vite-plugin). */
declare module '*.wasm' {
  const compiled: WebAssembly.Module;
  export default compiled;
}
