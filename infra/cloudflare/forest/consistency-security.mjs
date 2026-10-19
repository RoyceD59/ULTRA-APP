/** Only the owner-approved security delta; no application-source transplants. */
export const ORIGINAL_CANDIDATE = 'db2ef861871dcff39cde08350d9374e9b8d1220409e2f506141cf9c4666cad59';
export const SECURITY_UPGRADES = [
  { name: 'compression', from: '1.8.1', to: '1.8.2',
    oldIntegrity: 'sha512-9mAqGPHLakhCLeNyxPkK4xVo746zQ/czLH1Ky+vkitMnWfWZps8r0qXuwhwizagCRttsL4lfG4pIOvaWLpAP0w==',
    integrity: 'sha512-o8vI5RE5A6EVVOd9o41jKp41aJom+QTEO/Bx8MYNjexMo/Bv2WOjUfZr+aL0WnYSgymUy6zeguqLTsIhV0gMvQ==' },
  { name: 'proxy-addr', from: '2.0.7', to: '2.0.8',
    oldIntegrity: 'sha512-llQsMLSUDUPT44jdrU/O37qlnifitDP+ZwrmmZcoSKyLKvtZxpyV0n2/bD/N4tBAAZ/gJEdZU7KMraoK1+XYAg==',
    integrity: 'sha512-5nnx0yGyVUcY6t9RnWcARWtwT9F1D8O9rt08htPvnd49W1IgZtmLkhu9WfMzQj1cFxjHIO6connUNVW5k7AVyQ==' },
  { name: 'source-map-js', from: '1.2.1', to: '1.2.2',
    oldIntegrity: 'sha512-UXWMKhLOwVKb728IUtQPXxfYU+usdybtUrK/8uGE8CQMvrhOpwvzDBwj0QhSL7MQc7vIsISBG8VQ8+IDQxpfQA==',
    integrity: 'sha512-KGj/8Y43x35aZVDtt+J4mK1hoLGHULMYfSkODJNQjNDC3oW1PqPoxMwo0pLUsWM/UEGzON/NxeHywEfNXNP3Vw==' },
];

export function securityLock(original) {
  let result = original;
  for (const upgrade of SECURITY_UPGRADES) {
    const prefix = `  ${upgrade.name}@${upgrade.from}:`;
    if (result.split(prefix).length !== 3
        || result.split(upgrade.oldIntegrity).length !== 2) {
      throw new Error(`Unexpected frozen security anchor: ${upgrade.name}`);
    }
    result = result.replaceAll(prefix, `  ${upgrade.name}@${upgrade.to}:`)
      .replace(upgrade.oldIntegrity, upgrade.integrity);
    const reference = `      ${upgrade.name}: ${upgrade.from}\n`;
    const count = result.split(reference).length - 1;
    if (count !== (upgrade.name === 'source-map-js' ? 3 : 1)) {
      throw new Error(`Unexpected dependency reference count: ${upgrade.name}`);
    }
    result = result.replaceAll(reference, `      ${upgrade.name}: ${upgrade.to}\n`);
  }
  const anchor = '  compression@1.8.2:\n    dependencies:\n      bytes: 3.1.2\n      compressible: 2.0.18\n      debug: 2.6.9\n';
  if (result.split(anchor).length !== 2 || !result.includes('  destroy@1.2.0: {}')) {
    throw new Error('Unexpected compression dependency graph');
  }
  return result.replace(anchor, `${anchor}      destroy: 1.2.0\n`);
}
