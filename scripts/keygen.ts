import hypercoreCrypto from 'hypercore-crypto';

/**
 * Generates an Ed25519 keypair for signing catalog manifests.
 * @intent To provide cryptographic signing keys for manifest verification
 * @guarantee Prints the public and secret keys in hex format to stdout
 */
const { publicKey, secretKey } = hypercoreCrypto.keyPair();

console.log('=== MESH ARKADE KEYPAIR ===');
console.log('PUBLIC KEY (64 hex chars - embed in mesh-arkade client):');
console.log(publicKey.toString('hex'));
console.log('');
console.log('SECRET KEY (128 hex chars - store as GitHub Secret MESH_SIGNING_KEY):');
console.log(secretKey.toString('hex'));
console.log('');
console.log('=== IMPORTANT ===');
console.log('Store the secret key as "MESH_SIGNING_KEY" in GitHub repo secrets.');
console.log('Record the public key in the README under "Key Management".');