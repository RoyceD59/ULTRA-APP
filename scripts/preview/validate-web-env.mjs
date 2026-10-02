const mode = process.argv[2];
if (!['hub', 'companion'].includes(mode)) throw new Error('Specify hub or companion');
const values = mode === 'hub'
  ? [process.env.VITE_API_BASE_URL]
  : [process.env.EXPO_PUBLIC_API_DOMAIN, process.env.EXPO_PUBLIC_DOMAIN];
const expected = mode === 'hub' ? ['http://localhost:5000'] : ['localhost:5000', 'localhost:3000'];
if (values.some((value, index) => value !== expected[index])) {
  throw new Error(`${mode} preview build refuses non-local origins`);
}
if (mode === 'companion' && process.env.EXPO_PUBLIC_PREVIEW_SAFE_MODE !== '1') {
  throw new Error('Companion preview must disable connected sign-in');
}