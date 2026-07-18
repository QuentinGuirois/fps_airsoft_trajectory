const mobile = require('./lighthouserc-mobile.cjs');

module.exports = {
  ci: {
    ...mobile.ci,
    collect: {
      ...mobile.ci.collect,
      settings: {
        ...mobile.ci.collect.settings,
        preset: 'desktop',
        formFactor: 'desktop',
        screenEmulation: { mobile: false, width: 1440, height: 900, deviceScaleFactor: 1, disabled: false },
      },
    },
    upload: { target: 'filesystem', outputDir: '.lighthouseci/desktop' },
  },
};
