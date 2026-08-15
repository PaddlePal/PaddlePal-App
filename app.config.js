// Wraps app.json so EAS Build can swap in a cloud-uploaded
// GoogleService-Info.plist without it ever being committed to git.
//
// Local/cable builds: GOOGLE_SERVICES_INFO_PLIST is unset, so this falls
// back to the existing local ./GoogleService-Info.plist — unchanged
// behavior, nothing to configure.
//
// EAS builds: the "preview" build profile's environment provides
// GOOGLE_SERVICES_INFO_PLIST as a path to the uploaded secret file, and
// that path is used instead.
const appJson = require('./app.json');

appJson.expo.ios.googleServicesFile =
  process.env.GOOGLE_SERVICES_INFO_PLIST ?? appJson.expo.ios.googleServicesFile;

module.exports = appJson;
