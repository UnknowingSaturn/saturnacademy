// Typed wrapper around the vendored LZMA-alone decoder.
//
// Dukascopy `.bi5` files are raw LZMA-alone streams (5-byte props + 8-byte
// uncompressed size + payload) — NOT gzip/deflate, so Deno's built-in
// `DecompressionStream` cannot read them.
//
// `LZMA.decompress` is synchronous when called without a callback and returns
// a plain array of *signed* bytes (-128..127); this wrapper normalises that to
// a `Uint8Array`.

// @ts-ignore — vendored JS module without type declarations.
import { LZMA } from "./lzma_worker.js";

export function lzmaDecompress(input: Uint8Array): Uint8Array {
  const decoded = (LZMA as { decompress(d: Uint8Array): number[] | Uint8Array }).decompress(input);
  if (decoded instanceof Uint8Array) return decoded;
  const out = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i++) {
    const v = decoded[i];
    out[i] = v < 0 ? v + 256 : v;
  }
  return out;
}
