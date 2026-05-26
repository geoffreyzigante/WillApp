/**
 * Expo Config Plugin: with-exposure-reader
 *
 * Installe le frame processor plugin "readExposure" dans le projet iOS au
 * build EAS :
 *   1. Copie ExposureReaderPlugin.swift + .m dans ios/WillApp/
 *   2. Les ajoute au PBXProject (sources de l'app)
 *
 * Idempotent : si les fichiers existent deja avec le bon contenu, no-op.
 * Fail-loud : throws si le projet iOS n'est pas la (mauvais profile EAS).
 *
 * Le plugin lit les attachments EXIF du CMSampleBuffer de preview (ISO,
 * shutter, brightness) en lecture seule. Co-habite sans conflit avec
 * with-human-detector : deux plugins independants enregistres sous deux
 * noms JS distincts (detectHumans / readExposure), appeles sequentiellement
 * sur la meme Frame dans le worklet.
 */

const { withDangerousMod, withXcodeProject } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const PLUGIN_DIR = __dirname;
const SWIFT_FILENAME = 'ExposureReaderPlugin.swift';
const OBJC_FILENAME = 'ExposureReaderPlugin.m';

function copyPluginSources(projectRoot, iosProjectName) {
  const targetDir = path.join(projectRoot, 'ios', iosProjectName);
  if (!fs.existsSync(targetDir)) {
    throw new Error(
      `[with-exposure-reader] Cible introuvable : ${targetDir}. ` +
        'Le prebuild iOS a-t-il tourne ?'
    );
  }
  for (const name of [SWIFT_FILENAME, OBJC_FILENAME]) {
    const src = path.join(PLUGIN_DIR, name);
    const dst = path.join(targetDir, name);
    const content = fs.readFileSync(src, 'utf8');
    if (fs.existsSync(dst) && fs.readFileSync(dst, 'utf8') === content) {
      console.log(`[with-exposure-reader] ${name} a jour`);
      continue;
    }
    fs.writeFileSync(dst, content, 'utf8');
    console.log(`[with-exposure-reader] ${name} copie vers ios/${iosProjectName}/`);
  }
}

module.exports = function withExposureReader(config) {
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
      throw new Error('[with-exposure-reader] PBXGroup app introuvable');
    }
    for (const name of [SWIFT_FILENAME, OBJC_FILENAME]) {
      const alreadyAdded = Object.values(project.pbxBuildFileSection())
        .some(bf => bf && bf.fileRef_comment === name);
      if (alreadyAdded) {
        console.log(`[with-exposure-reader] ${name} deja dans Xcode project`);
        continue;
      }
      project.addSourceFile(
        path.join(iosProjectName, name),
        { target: project.getFirstTarget().uuid },
        groupKey,
      );
      console.log(`[with-exposure-reader] ${name} ajoute au Xcode project`);
    }
    return cfg;
  });

  return config;
};
