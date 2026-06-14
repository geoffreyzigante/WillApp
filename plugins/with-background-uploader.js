/**
 * Expo Config Plugin: with-background-uploader
 *
 * Installe le module natif BackgroundUploader dans le projet iOS au build EAS :
 *   1. Copie BackgroundUploader.swift + .m dans ios/WillApp/
 *   2. Les ajoute au PBXProject (sources de l'app)
 *
 * Le module utilise URLSessionConfiguration.background(withIdentifier:) pour
 * deleguer les uploads PUT R2 a iOS. L'app peut etre minimisee, ecran eteint,
 * voire suspended -- iOS continue l'upload et notifie via RCTEventEmitter
 * (BackgroundUploaderComplete / Progress).
 *
 * Pas de modifications Info.plist requises pour la V1 : URLSession background
 * fonctionne hors process iOS sans UIBackgroundModes. Limitation : si l'app
 * est explicitement killed (swipe app switcher), les tasks sont cancelled.
 *
 * Pattern identique a with-photo-metadata-burner.js. Idempotent.
 */

const { withDangerousMod, withXcodeProject } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const PLUGIN_DIR = __dirname;
const SWIFT_FILENAME = 'BackgroundUploader.swift';
const OBJC_FILENAME = 'BackgroundUploader.m';

function copyPluginSources(projectRoot, iosProjectName) {
  const targetDir = path.join(projectRoot, 'ios', iosProjectName);
  if (!fs.existsSync(targetDir)) {
    throw new Error(
      `[with-background-uploader] Cible introuvable : ${targetDir}. ` +
        'Le prebuild iOS a-t-il tourne ?'
    );
  }
  for (const name of [SWIFT_FILENAME, OBJC_FILENAME]) {
    const src = path.join(PLUGIN_DIR, name);
    const dst = path.join(targetDir, name);
    const content = fs.readFileSync(src, 'utf8');
    if (fs.existsSync(dst) && fs.readFileSync(dst, 'utf8') === content) {
      console.log(`[with-background-uploader] ${name} a jour`);
      continue;
    }
    fs.writeFileSync(dst, content, 'utf8');
    console.log(`[with-background-uploader] ${name} copie vers ios/${iosProjectName}/`);
  }
}

module.exports = function withBackgroundUploader(config) {
  config = withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const iosProjectName = cfg.modRequest.projectName || 'WillApp';
      copyPluginSources(projectRoot, iosProjectName);
      return cfg;
    },
  ]);

  config = withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const iosProjectName = cfg.modRequest.projectName || 'WillApp';
    const groupKey =
      project.findPBXGroupKey({ name: iosProjectName }) ||
      project.findPBXGroupKey({ path: iosProjectName });
    if (!groupKey) {
      throw new Error('[with-background-uploader] PBXGroup app introuvable');
    }
    for (const name of [SWIFT_FILENAME, OBJC_FILENAME]) {
      const alreadyAdded = Object.values(project.pbxBuildFileSection())
        .some(bf => bf && bf.fileRef_comment === name);
      if (alreadyAdded) {
        console.log(`[with-background-uploader] ${name} deja dans Xcode project`);
        continue;
      }
      project.addSourceFile(
        path.join(iosProjectName, name),
        { target: project.getFirstTarget().uuid },
        groupKey,
      );
      console.log(`[with-background-uploader] ${name} ajoute au Xcode project`);
    }
    return cfg;
  });

  return config;
};
