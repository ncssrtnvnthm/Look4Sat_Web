// Preserve console.log in production builds for debugging
module.exports = function(config) {
  // Disable TerserPlugin's console removal
  if (config.optimization && config.optimization.minimizer) {
    config.optimization.minimizer = config.optimization.minimizer.map(function(minimizer) {
      if (minimizer.constructor && minimizer.constructor.name === 'TerserPlugin') {
        minimizer.options = minimizer.options || {};
        minimizer.options.terserOptions = minimizer.options.terserOptions || {};
        minimizer.options.terserOptions.compress = minimizer.options.terserOptions.compress || {};
        minimizer.options.terserOptions.compress.drop_console = false;
        minimizer.options.terserOptions.compress.pure_funcs = null;
      }
      return minimizer;
    });
  }
  return config;
};
