/**
 * Expo Config Plugin: with-human-detector-android
 *
 * Pendant Android de with-human-detector. Au prebuild :
 *   1. Copie HumanDetectorPlugin.kt dans android/app/src/main/java/<package>/
 *   2. Ajoute la dependance ML Kit face-detection au build.gradle de l app
 *   3. Enregistre le plugin sous le nom JS "detectHumans" dans MainApplication
 *
 * Le nom JS est IDENTIQUE a iOS : App.js appelle detectHumans() sans savoir
 * sur quelle plateforme il tourne. C est tout l interet du contrat natif.
 *
 * Idempotent : chaque etape verifie sa propre marque avant d ecrire.
 * Fail-loud : throws si une ancre a bouge, plutot que produire un build qui
 * compile mais ne detecte rien.
 *
 * ⚠️ NON EXECUTE — aucun prebuild Android n a encore tourne sur ce projet.
 * Les trois ancres (build.gradle, MainApplication, arborescence java) sont a
 * verifier au premier `expo prebuild -p android`.
 */

const {
  withDangerousMod,
  withAppBuildGradle,
  withMainApplication,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const KT_FILENAME = 'HumanDetectorPlugin.kt';
// Version epinglee : ML Kit face detection embarque son modele dans l APK
// (~16 Mo). L alternative "unbundled" via Google Play Services telecharge le
// modele au premier lancement — inacceptable ici, un benevole peut ouvrir
// l app pour la premiere fois sur le parking d un event, sans reseau.
const MLKIT_DEP = 'com.google.mlkit:face-detection:16.1.7';

function javaDirFor(projectRoot, pkg) {
  return path.join(
    projectRoot,
    'android', 'app', 'src', 'main', 'java',
    ...pkg.split('.'),
  );
}

module.exports = function withHumanDetectorAndroid(config) {
  // ── 1. Source Kotlin ────────────────────────────────────────────────────
  config = withDangerousMod(config, [
    'android',
    async (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const pkg = cfg.android?.package;
      if (!pkg) {
        throw new Error(
          '[with-human-detector-android] android.package absent de app.json — ' +
          'aucun build Android possible sans lui.'
        );
      }
      const targetDir = javaDirFor(projectRoot, pkg);
      if (!fs.existsSync(targetDir)) {
        throw new Error(
          `[with-human-detector-android] Cible introuvable : ${targetDir}. ` +
          'Le prebuild Android a-t-il tourne ?'
        );
      }
      const src = path.join(__dirname, KT_FILENAME);
      const dst = path.join(targetDir, KT_FILENAME);
      let content = fs.readFileSync(src, 'utf8');
      // Le fichier est ecrit avec un package par defaut ; on le reecrit pour
      // suivre app.json plutot que d imposer un nom en dur.
      content = content.replace(/^package .*$/m, `package ${pkg}`);
      if (fs.existsSync(dst) && fs.readFileSync(dst, 'utf8') === content) {
        console.log(`[with-human-detector-android] ${KT_FILENAME} a jour`);
        return cfg;
      }
      fs.writeFileSync(dst, content, 'utf8');
      console.log(`[with-human-detector-android] ${KT_FILENAME} copie vers ${targetDir}`);
      return cfg;
    },
  ]);

  // ── 2. Dependance gradle ────────────────────────────────────────────────
  config = withAppBuildGradle(config, (cfg) => {
    const gradle = cfg.modResults.contents;
    if (gradle.includes('mlkit:face-detection')) {
      console.log('[with-human-detector-android] dependance ML Kit deja presente');
      return cfg;
    }
    const anchor = 'dependencies {';
    if (!gradle.includes(anchor)) {
      throw new Error('[with-human-detector-android] bloc dependencies introuvable dans build.gradle');
    }
    cfg.modResults.contents = gradle.replace(
      anchor,
      `${anchor}\n    // Detection de visages (frame processor detectHumans).\n` +
      `    implementation "${MLKIT_DEP}"`,
    );
    console.log('[with-human-detector-android] dependance ML Kit ajoutee');
    return cfg;
  });

  // ── 3. Enregistrement du plugin ─────────────────────────────────────────
  // VisionCamera resout les frame processors par NOM. Sans cet enregistrement
  // le build compile parfaitement et initFrameProcessorPlugin('detectHumans')
  // renvoie null au runtime — panne silencieuse, cote JS l app leve alors
  // "detectHumans plugin not loaded".
  config = withMainApplication(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (src.includes('HumanDetectorPlugin')) {
      console.log('[with-human-detector-android] plugin deja enregistre');
      return cfg;
    }
    const isKotlin = cfg.modResults.language === 'kt';
    if (!isKotlin) {
      throw new Error(
        '[with-human-detector-android] MainApplication en Java non supporte. ' +
        'Expo SDK 54 genere du Kotlin — ancre a revoir.'
      );
    }
    // APRES super.onCreate() : le premier jet inserait juste apres la
    // signature de onCreate(), donc AVANT super. Le registre etant statique
    // ca fonctionnait, mais executer du code avant super.onCreate() dans une
    // Application est une mauvaise pratique — le contexte n est pas encore
    // pleinement initialise. Le JS n appelle initFrameProcessorPlugin que
    // bien plus tard : rien n impose d enregistrer si tot.
    const anchor = 'super.onCreate()';
    if (!src.includes(anchor)) {
      throw new Error('[with-human-detector-android] super.onCreate() introuvable dans MainApplication');
    }
    src = src.replace(
      anchor,
      `${anchor}\n    com.mrousavy.camera.frameprocessors.FrameProcessorPluginRegistry\n` +
      `      .addFrameProcessorPlugin("detectHumans") { proxy, options ->\n` +
      `        HumanDetectorPlugin(proxy, options)\n` +
      `      }`,
    );
    cfg.modResults.contents = src;
    console.log('[with-human-detector-android] plugin enregistre sous "detectHumans"');
    return cfg;
  });

  return config;
};
