declare module 'hypercore-crypto' {
  interface KeyPair {
    publicKey: Buffer;
    secretKey: Buffer;
  }

  const hypercoreCrypto: {
    keyPair(): KeyPair;
    sign(message: Buffer, secretKey: Buffer): Buffer;
    verify(message: Buffer, signature: Buffer, publicKey: Buffer): boolean;
  };

  export default hypercoreCrypto;
}