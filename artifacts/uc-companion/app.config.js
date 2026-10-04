// Only the static web exporter sets this. Native manifests retain app.json.
module.exports = ({ config }) => ({
  ...config,
  experiments: {
    ...config.experiments,
    ...(process.env.UC_WEB_EXPORT_BASE_PATH
      ? { baseUrl: process.env.UC_WEB_EXPORT_BASE_PATH }
      : {}),
  },
});