package com.geoffreyzigante.will

//
//  HumanDetectorPlugin.kt
//  WillApp — Android
//
//  Portage Android du frame processor "detectHumans". Le contrat est
//  specifie dans plugins/CONTRAT_NATIF.md : toute divergence de cle, d unite
//  ou de repere produit deux comportements differents entre iOS et Android
//  SANS lever la moindre erreur. C est le mode de panne a rendre impossible.
//
//  Equivalence des moteurs :
//      iOS      VNDetectFaceRectanglesRequest  (Apple Vision)
//      Android  FaceDetection PERFORMANCE_MODE_FAST  (ML Kit)
//
//  Ni landmarks ni classification : seule la bounding box est consommee.
//  Les activer multiplierait le cout par frame pour une donnee inutilisee.
//
//  Appel JS (worklet), identique a iOS :
//      const { count, ts, faces } = detectHumans(frame, {
//        zoneWidthPercent: 0.3, axis: 'midY'
//      })
//
//  ─── LES TROIS PIEGES DU PORTAGE ────────────────────────────────────────
//
//  1. REPERE. Apple Vision renvoie des coordonnees NORMALISEES avec l origine
//     en BAS a gauche ; le code iOS bascule cy (`1.0 - midY`). ML Kit renvoie
//     des PIXELS avec l origine en HAUT a gauche. Il faut donc diviser par la
//     taille de l image et NE PAS inverser cy. Une inversion en trop placerait
//     tous les visages en miroir vertical : le tracker de lignes continuerait
//     de fonctionner, mais sur les mauvaises trajectoires.
//
//  2. TEMPS. `ts` doit etre une horloge MONOTONE en SECONDES. Le tracker n en
//     consomme que les differences pour estimer les vitesses.
//     System.currentTimeMillis() est proscrit : il saute a la synchro NTP et
//     produirait des vitesses aberrantes. On utilise le timestamp de l image.
//
//  3. ROTATION. `rotationDegrees` doit etre passe a InputImage, sinon ML Kit
//     analyse une image couchee et ne detecte quasiment rien. Les dimensions
//     utilisees pour normaliser doivent etre celles de l image APRES rotation.
//
//  AUCUN SEUIL ICI. Le plugin mesure, le JS decide (cf. CONTRAT_NATIF.md).
//  `axis` et `zoneWidthPercent` arrivent de JS ; rien d autre ne doit
//  apparaitre dans ce fichier.
//
//  ⚠️ NON COMPILE NI TESTE — ecrit d apres le contrat, en attente du premier
//  build Android. A verifier en priorite : le nom de la classe enregistree,
//  la version de l API frame processor de VisionCamera, et le repere renvoye.
//

import android.annotation.SuppressLint
import android.media.Image
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetector
import com.google.mlkit.vision.face.FaceDetectorOptions
import com.mrousavy.camera.core.types.Orientation
import com.mrousavy.camera.frameprocessors.Frame
import com.mrousavy.camera.frameprocessors.FrameProcessorPlugin
import com.mrousavy.camera.frameprocessors.VisionCameraProxy
import java.util.concurrent.TimeUnit

class HumanDetectorPlugin(
  @Suppress("UNUSED_PARAMETER") proxy: VisionCameraProxy,
  @Suppress("UNUSED_PARAMETER") options: Map<String, Any>?,
) : FrameProcessorPlugin() {

  private val detector: FaceDetector = FaceDetection.getClient(
    FaceDetectorOptions.Builder()
      // FAST : ~2-3x plus rapide que ACCURATE pour une bbox equivalente sur
      // des visages de face. On cible 10 fps d analyse.
      .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_FAST)
      .setLandmarkMode(FaceDetectorOptions.LANDMARK_MODE_NONE)
      .setClassificationMode(FaceDetectorOptions.CLASSIFICATION_MODE_NONE)
      .setContourMode(FaceDetectorOptions.CONTOUR_MODE_NONE)
      // Ecarte le bruit : un "visage" de moins de 5% de la largeur d image
      // est trop petit pour Rekognition de toute facon. Ce n est PAS un seuil
      // metier — c est le plancher du detecteur, l equivalent implicite du
      // comportement d Apple Vision.
      .setMinFaceSize(0.05f)
      .build()
  )

  // Memoise le dernier count logge : sans ca, 10 lignes de log par seconde.
  // Meme comportement que la version iOS.
  private var lastLoggedRaw: Int = -1
  private var lastLoggedFiltered: Int = -1

  @SuppressLint("UnsafeOptInUsageError")
  override fun callback(frame: Frame, arguments: Map<String, Any>?): Any {
    val empty = mapOf(
      "count" to 0,
      "ts" to 0.0,
      "faces" to emptyList<Map<String, Any>>(),
    )

    val image: Image = try {
      frame.image
    } catch (e: Throwable) {
      return empty
    }

    // Rotation attendue par ML Kit : celle qu il faut APPLIQUER a l image
    // pour la redresser. VisionCamera, lui, expose l orientation REELLE de
    // la frame — c est l inverse, et Frame.getOrientation() le dit
    // explicitement (il appelle `.reversed()` sur la valeur du capteur).
    // On refait donc le chemin en sens inverse avant de convertir en degres.
    //
    // Sans ce `reversed()`, les deux orientations paysage seraient
    // interverties : les visages seraient detectes a 180 degres de leur
    // position reelle et le tracker suivrait des trajectoires inversees,
    // SANS qu aucune erreur ne soit levee. Exactement le mode de panne que
    // l en-tete de ce fichier decrit.
    //
    // `toDegrees()` n existe pas sur l enum Orientation de VisionCamera 4.x
    // — c est ce qui faisait echouer la compilation. La table ci-dessous
    // reprend les bornes de Orientation.fromRotationDegrees().
    val rotation = when (frame.orientation.reversed()) {
      Orientation.PORTRAIT -> 0
      Orientation.LANDSCAPE_LEFT -> 90
      Orientation.PORTRAIT_UPSIDE_DOWN -> 180
      Orientation.LANDSCAPE_RIGHT -> 270
    }
    val inputImage = InputImage.fromMediaImage(image, rotation)

    // Dimensions APRES rotation — sinon la normalisation est transposee sur
    // les orientations portrait (90 / 270).
    val imgW = inputImage.width.toFloat()
    val imgH = inputImage.height.toFloat()
    if (imgW <= 0f || imgH <= 0f) return empty

    // Horloge monotone, en secondes. Le tracker n en lit que les differences.
    val ts = TimeUnit.NANOSECONDS.toMillis(frame.timestamp) / 1000.0

    val axis = (arguments?.get("axis") as? String) ?: "midY"
    var zoneWidth = (arguments?.get("zoneWidthPercent") as? Number)?.toDouble() ?: 1.0
    zoneWidth = zoneWidth.coerceIn(0.0, 1.0)
    val half = zoneWidth / 2.0
    val zMin = 0.5 - half
    val zMax = 0.5 + half

    return try {
      // ML Kit est asynchrone par defaut. Dans un frame processor on est deja
      // sur un thread de fond dedie : on attend le resultat, sinon la frame
      // serait recyclee avant la fin de l analyse.
      val faces = com.google.android.gms.tasks.Tasks.await(detector.process(inputImage))

      val out = ArrayList<Map<String, Any>>(faces.size)
      var filtered = 0
      for (f in faces) {
        val b = f.boundingBox
        // ML Kit : pixels, origine EN HAUT a gauche. Pas d inversion de cy —
        // c est deja le repere attendu cote JS (cf. piege n°1).
        val cx = (b.exactCenterX() / imgW).toDouble()
        val cy = (b.exactCenterY() / imgH).toDouble()
        val w = (b.width() / imgW).toDouble()
        val h = (b.height() / imgH).toDouble()

        val c = if (axis == "midX") cx else cy
        if (c in zMin..zMax) filtered++

        out.add(mapOf("cx" to cx, "cy" to cy, "w" to w, "h" to h))
      }

      if (faces.size != lastLoggedRaw || filtered != lastLoggedFiltered) {
        android.util.Log.d(
          "FaceDetector",
          "raw=${faces.size} filtered=$filtered axis=$axis " +
            "zone=$zoneWidth rot=$rotation size=${imgW.toInt()}x${imgH.toInt()}",
        )
        lastLoggedRaw = faces.size
        lastLoggedFiltered = filtered
      }

      // `count` = visages EN ZONE. `faces` = TOUS, zone comprise ou non.
      // Les deux ne sont pas interchangeables : le tracker doit voir un
      // coureur approcher pour disposer d une vitesse au franchissement de la
      // premiere ligne (cf. CONTRAT_NATIF.md §1).
      mapOf("count" to filtered, "ts" to ts, "faces" to out)
    } catch (e: Throwable) {
      android.util.Log.w("FaceDetector", "detection failed: ${e.message}")
      empty
    }
  }
}
