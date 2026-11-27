/**
 * Decodes an uploaded file. Japanese exchanges often export Shift_JIS; everything else is
 * UTF-8 (sometimes with a BOM).
 *
 * Uses the runtime's `TextDecoder` (browsers, Node). Hermes (React Native) lacks Shift_JIS,
 * so mobile uploads should be decoded by the API.
 */
interface Decoder {
  decode(input: Uint8Array): string;
}
type DecoderCtor = new (label: string, options?: { fatal?: boolean }) => Decoder;

export function decodeText(bytes: Uint8Array): { text: string; encoding: 'utf-8' | 'shift_jis' } {
  const Ctor = (globalThis as { TextDecoder?: DecoderCtor }).TextDecoder;
  if (!Ctor)
    throw new Error('TextDecoder is not available in this runtime; decode files server-side.');
  try {
    return { text: new Ctor('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' };
  } catch {
    return { text: new Ctor('shift_jis').decode(bytes), encoding: 'shift_jis' };
  }
}
