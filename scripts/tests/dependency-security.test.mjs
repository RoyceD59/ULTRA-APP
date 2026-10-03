import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { createRequire } from "node:module";
import test from "node:test";

// Resolve through real consumers, never an arbitrary retained pnpm store copy.
function dependency(artifact, chain) {
  let require = createRequire(new URL(`../../artifacts/${artifact}/package.json`, import.meta.url));
  for (const name of chain.slice(0, -1)) {
    require = createRequire(require.resolve(name));
  }
  return require(chain.at(-1));
}

const braces = dependency("api-server", ["http-proxy-middleware", "micromatch", "braces"]);
const CachePolicy = dependency("uc-companion", ["@expo/ngrok", "got", "cacheable-request", "http-cache-semantics"]);
const forge = dependency("uc-companion", ["expo", "@expo/cli", "node-forge"]);

test("braces keeps ordinary glob compilation and expansion", () => {
  assert.deepEqual(braces.expand("a/{b,c}/{1..3}"), [
    "a/b/1", "a/b/2", "a/b/3", "a/c/1", "a/c/2", "a/c/3",
  ]);
  assert.equal(braces.compile("a/{b,c}"), "a/(b|c)");
  assert.equal(braces.stringify(braces.parse("a/{b,c}")), "a/{b,c}");
});

test("braces rejects deep braces and parentheses before recursive AST walks", () => {
  for (const [open, close] of [["{", "}"], ["(", ")"]]) {
    const pattern = open.repeat(4000) + "a,b" + close.repeat(4000);
    for (const method of ["parse", "compile", "expand", "stringify", "create"]) {
      assert.throws(() => braces[method](pattern), { name: "SyntaxError", message: /nesting depth/ });
    }
  }
});

test("braces guards externally supplied ASTs as well as strings", () => {
  for (const method of ["compile", "expand", "stringify"]) {
    let ast = { type: "text", value: "x" };
    for (let i = 0; i < 4000; i++) ast = { type: "root", nodes: [ast] };
    assert.throws(() => braces[method](ast), { name: "SyntaxError", message: /nesting depth/ });
  }
});

const request = { url: "https://example.test/resource", method: "GET", headers: {} };

test("max-stale cannot revive security-zeroed cache entries (including restored entries)", () => {
  const responses = [
    { "cache-control": "private, max-age=600" },
    { "cache-control": "no-store, max-age=600" },
    { "cache-control": "no-cache, max-age=600" },
    { "cache-control": "max-age=600", "set-cookie": "session=other-user" },
    { "cache-control": "max-age=600", vary: "*" },
    { "cache-control": "proxy-revalidate, max-age=0" },
  ];
  for (const headers of responses) {
    const initial = new CachePolicy(request, { status: 200, headers });
    for (const policy of [initial, CachePolicy.fromObject(initial.toObject())]) {
      for (const directive of ["max-stale", "max-stale=999999999"]) {
        const incoming = { ...request, headers: { "cache-control": directive } };
        assert.equal(policy.satisfiesWithoutRevalidation(incoming), false, JSON.stringify(headers));
        assert.equal(policy.evaluateRequest(incoming).response, undefined);
      }
    }
  }
});

test("cache still serves public fresh entries and intentionally stale entries", () => {
  const fresh = new CachePolicy(request, { status: 200, headers: { "cache-control": "public, max-age=600" } });
  assert.equal(fresh.satisfiesWithoutRevalidation(request), true);
  const stale = new CachePolicy(request, { status: 200, headers: { "cache-control": "public, max-age=0" } });
  assert.equal(stale.satisfiesWithoutRevalidation({
    ...request, headers: { "cache-control": "max-stale=600" },
  }), true);
});

test("RSA PKCS#1 verification accepts valid signatures but rejects garbage inside DigestAlgorithm", () => {
  const { privateKey: pem } = generateKeyPairSync("rsa", {
    modulusLength: 1024, publicExponent: 3,
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
    publicKeyEncoding: { type: "pkcs1", format: "pem" },
  });
  const privateKey = forge.pki.privateKeyFromPem(pem);
  const publicKey = forge.pki.setRsaPublicKey(privateKey.n, privateKey.e);
  const digest = forge.md.sha256.create().update("security regression");
  const bytes = digest.digest().getBytes();
  assert.equal(publicKey.verify(bytes, privateKey.sign(digest)), true);
  const { asn1 } = forge;
  const node = (type, constructed, value) => asn1.create(asn1.Class.UNIVERSAL, type, constructed, value);
  const oid = () => node(asn1.Type.OID, false, asn1.oidToDer(forge.oids.sha256).getBytes());
  const nullParameter = () => node(asn1.Type.NULL, false, "");
  const sign = algorithm => privateKey.sign(asn1.toDer(node(asn1.Type.SEQUENCE, true, [
    node(asn1.Type.SEQUENCE, true, algorithm),
    node(asn1.Type.OCTETSTRING, false, bytes),
  ])).getBytes(), "NONE");
  // SHA-256 permits absent or empty NULL parameters.
  assert.equal(publicKey.verify(bytes, sign([oid()])), true);
  for (const algorithm of [
    [oid(), nullParameter(), node(asn1.Type.OCTETSTRING, false, "garbage")],
    [oid(), node(asn1.Type.OCTETSTRING, false, "garbage")],
    [oid(), node(asn1.Type.NULL, false, "garbage")],
  ]) {
    assert.throws(() => publicKey.verify(bytes, sign(algorithm)), /valid RSASSA-PKCS1-v1_5/);
  }
});

test("Nodemailer upgrade retains the SMTP message composition API", async () => {
  const mailer = dependency("api-server", ["nodemailer"]);
  const transport = mailer.createTransport({ streamTransport: true, buffer: true });
  const result = await transport.sendMail({
    from: "Ultra Clear <team@example.test>", to: "Customer <customer@example.test>",
    subject: "Security compatibility check", text: "Delivery test", html: "<p>Delivery test</p>",
  });
  assert.deepEqual(result.envelope.to, ["customer@example.test"]);
  assert.match(result.message.toString(), /Subject: Security compatibility check/);
  assert.match(result.message.toString(), /Delivery test/);
});