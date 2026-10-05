// Only the static web exporter sets this. Native manifests retain app.json.
module.exports = ({ config }) => {
  if (process.env.EAS_BUILD_PROFILE === 'production') {
    const domain = process.env.EXPO_PUBLIC_API_DOMAIN;
    const origin = domain ? (/^https:\/\//.test(domain) ? domain : `https://${domain}`).replace(/\/$/, '') : '';
    if (origin !== 'https://api.ucfilters.com') throw new Error('Production binary requires the approved API origin');
    if (!(process.env.EXPO_PUBLIC_COMPANION_BUILD_ID || process.env.EAS_BUILD_ID)) {
      throw new Error('Production binary requires an identifiable release');
    }
  }
  return ({
  ...config,
  extra: {
    ...config.extra,
    companionRelease: process.env.EXPO_PUBLIC_COMPANION_BUILD_ID || process.env.EAS_BUILD_ID || 'development',
  },
  experiments: {
    ...config.experiments,
    ...(process.env.UC_WEB_EXPORT_BASE_PATH
      ? { baseUrl: process.env.UC_WEB_EXPORT_BASE_PATH }
      : {}),
  },
  });
};