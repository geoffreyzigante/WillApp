/**
 * Expo Config Plugin: with-thermal-monitor
 *
 * Installe le module natif ThermalMonitor dans le projet iOS au build EAS :
 *   1. Copie ThermalMonitor.swift + .m dans ios/WillApp/
 *   2. Les ajoute au PBXProject (sources de l'app)
 *
 * Le module wraps ProcessInfo.thermalState (iOS 11+) et notifie le JS sur
 * les transitions thermiques via event ThermalStateChanged. Cote app, on
 * baisse CONCURRENCY upload (3 -> 2 a serious, 1 a critical) pour soulager
 * le NPU/CPU/baseband sur events 4h+ -- la capture reste a cadence pleine.
 *
 * Pattern identique a with-photo-metadata-burner.js. Idempotent.
 */

const { withDangerousMod, withXcodeProject } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const PLUGIN_DIR = __dirname;
const SWIFT_FILENAME = 'ThermalMonitor.swift';
const OBJC_FILENAME = 'ThermalMonitor.m';

function copyPluginSources(projectRoot, iosProjectName) {
  const targetDir = path.join(projectRoot, 'ios', iosProjectName);
  if (!fs.existsSync(targetDir)) {
    throw new Error(
      `[with-thermal-monitor] Cible introuvable : ${targetDir}. ` +
        'Le prebuild iOS a-t-il tourne ?'
    );
  }
  for (const name of [SWIFT_FILENAME, OBJC_FILENAME]) {
    const src = path.join(PLUGIN_DIR, name);
    const dst = path.join(targetDir, name);
    const content = fs.readFileSync(src, 'utf8');
    if (fs.existsSync(dst) && fs.readFileSync(dst, 'utf8') === content) {
      console.log(`[with-thermal-monitor] ${name} a jour`);
      continue;
    }
    fs.writeFileSync(dst, content, 'utf8');
    console.log(`[with-thermal-monitor] ${name} copie vers ios/${iosProjectName}/`);
  }
}

module.exports = function withThermalMonitor(config) {
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
      throw new Error('[with-thermal-monitor] PBXGroup app introuvable');
    }
    for (const name of [SWIFT_FILENAME, OBJC_FILENAME]) {
      const alreadyAdded = Object.values(project.pbxBuildFileSection())
        .some(bf => bf && bf.fileRef_comment === name);
      if (alreadyAdded) {
        console.log(`[with-thermal-monitor] ${name} deja dans Xcode project`);
        continue;
      }
      project.addSourceFile(
        path.join(iosProjectName, name),
        { target: project.getFirstTarget().uuid },
        groupKey,
      );
      console.log(`[with-thermal-monitor] ${name} ajoute au Xcode project`);
    }
    return cfg;
  });

  return config;
};
