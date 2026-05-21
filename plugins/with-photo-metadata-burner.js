/**
 * Expo Config Plugin: with-photo-metadata-burner
 *
 * Installe le module natif RCT PhotoMetadataBurner dans le projet iOS au
 * build EAS :
 *   1. Copie PhotoMetadataBurner.swift + .m dans ios/WillApp/
 *   2. Les ajoute au PBXProject (sources de l'app)
 *
 * Pattern identique a with-human-detector.js. Idempotent (skip si deja
 * a jour ou deja reference dans Xcode).
 */

const { withDangerousMod, withXcodeProject } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const PLUGIN_DIR = __dirname;
const SWIFT_FILENAME = 'PhotoMetadataBurner.swift';
const OBJC_FILENAME = 'PhotoMetadataBurner.m';

function copyPluginSources(projectRoot, iosProjectName) {
  const targetDir = path.join(projectRoot, 'ios', iosProjectName);
  if (!fs.existsSync(targetDir)) {
    throw new Error(
      `[with-photo-metadata-burner] Cible introuvable : ${targetDir}. ` +
        'Le prebuild iOS a-t-il tourne ?'
    );
  }
  for (const name of [SWIFT_FILENAME, OBJC_FILENAME]) {
    const src = path.join(PLUGIN_DIR, name);
    const dst = path.join(targetDir, name);
    const content = fs.readFileSync(src, 'utf8');
    if (fs.existsSync(dst) && fs.readFileSync(dst, 'utf8') === content) {
      console.log(`[with-photo-metadata-burner] ${name} a jour`);
      continue;
    }
    fs.writeFileSync(dst, content, 'utf8');
    console.log(`[with-photo-metadata-burner] ${name} copie vers ios/${iosProjectName}/`);
  }
}

module.exports = function withPhotoMetadataBurner(config) {
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
      throw new Error('[with-photo-metadata-burner] PBXGroup app introuvable');
    }
    for (const name of [SWIFT_FILENAME, OBJC_FILENAME]) {
      const alreadyAdded = Object.values(project.pbxBuildFileSection())
        .some(bf => bf && bf.fileRef_comment === name);
      if (alreadyAdded) {
        console.log(`[with-photo-metadata-burner] ${name} deja dans Xcode project`);
        continue;
      }
      project.addSourceFile(
        path.join(iosProjectName, name),
        { target: project.getFirstTarget().uuid },
        groupKey,
      );
      console.log(`[with-photo-metadata-burner] ${name} ajoute au Xcode project`);
    }
    return cfg;
  });

  return config;
};
