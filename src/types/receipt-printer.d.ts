declare module '@point-of-sale/receipt-printer-encoder' {
  interface Encoder {
    initialize(): Encoder;
    align(alignment: 'left' | 'center' | 'right'): Encoder;
    bold(enabled: boolean): Encoder;
    size(width: number, height: number): Encoder;
    text(content: string): Encoder;
    newline(): Encoder;
    image(data: ArrayBuffer, width: number, height: number): Encoder;
    cut(): Encoder;
    encode(): Uint8Array;
  }

  export function encoderBuilder(): Encoder;
}