//To run this script use the command "npx tsx scripts/generate-keys.ts"

import { generateKeyPairSync } from "crypto";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

console.log("\n=== PRIVATE KEY (Base64) - User Service ONLY ===");
console.log(Buffer.from(privateKey).toString("base64"));

console.log("\n=== PUBLIC KEY (Base64) - User + Chat Services ===");
console.log(Buffer.from(publicKey).toString("base64"));