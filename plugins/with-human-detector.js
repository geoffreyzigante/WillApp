/**
 * Expo Config Plugin: with-human-detector
 *
 * Installe le frame processor plugin Apple Vision "detectHumans" dans le
 * projet iOS au build EAS :
 *   1. Copie HumanDetectorPlugin.swift + .m dans ios/WillApp/
 *   2. Les ajoute au PBXProject (sources de l'app)
 *
 * Idempotent : si les fichiers existent deja avec le bon contenu, no-op.
 * Fail-loud : throws si le projet iOS n'est pas la (mauvais profile EAS).
 *
 * Apple Vision (VNDetectHumanRectanglesRequest) est ~3-5x plus lourd que
 * la detection visage MLKit ; on throttle a 1 frame sur 3 cote JS pour
 * tenir ~10 fps d'analyse (cf. App.js frameProcessor).
 */

const { withDangerousMod, withXcodeProject } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const PLUGIN_DIR = __dirname;
const SWIFT_FILENAME = 'HumanDetectorPlugin.swift';
const OBJC_FILENAME = 'HumanDetectorPlugin.m';

function copyPluginSources(projectRoot, iosProjectName) {
  const targetDir = path.join(projectRoot, 'ios', iosProjectName);
  if (!fs.existsSync(targetDir)) {
    throw new Error(
      `[with-human-detector] Cible introuvable : ${targetDir}. ` +
        'Le prebuild iOS a-t-il tourne ?'
    );
  }
  for (const name of [SWIFT_FILENAME, OBJC_FILENAME]) {
    const src = path.join(PLUGIN_DIR, name);
    const dst = path.join(targetDir, name);
    const content = fs.readFileSync(src, 'utf8');
    if (fs.existsSync(dst) && fs.readFileSync(dst, 'utf8') === content) {
      console.log(`[with-human-detector] ${name} a jour`);
      continue;
    }
    fs.writeFileSync(dst, content, 'utf8');
    console.log(`[with-human-detector] ${name} copie vers ios/${iosProjectName}/`);
  }
}

module.exports = function withHumanDetector(config) {
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
      throw new Error('[with-human-detector] PBXGroup app introuvable');
    }
    for (const name of [SWIFT_FILENAME, OBJC_FILENAME]) {
      const alreadyAdded = Object.values(project.pbxBuildFileSection())
        .some(bf => bf && bf.fileRef_comment === name);
      if (alreadyAdded) {
        console.log(`[with-human-detector] ${name} deja dans Xcode project`);
        continue;
      }
      project.addSourceFile(
        path.join(iosProjectName, name),
        { target: project.getFirstTarget().uuid },
        groupKey,
      );
      console.log(`[with-human-detector] ${name} ajoute au Xcode project`);
    }
    return cfg;
  });

  return config;
};
