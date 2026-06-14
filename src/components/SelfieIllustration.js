// Pictogramme selfie : visage stylise avec cadre photo, default size 128.
// Utilise dans la step 2 du signup wizard et dans l'etat "selfie manquant"
// de PhotosScreen.

import React from 'react';
import { SvgXml } from 'react-native-svg';

export function SelfieIllustration({ size = 128, color = '#7B2FFF' }) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 17.61 17.61">
  <path fill="${color}" d="M1.86,3.28c0-.77.62-1.4,1.4-1.4h4.12V0H1.4C.62,0,0,.62,0,1.4v5.98h1.86V3.28Z"/>
  <path fill="${color}" d="M16.21,0h-5.98v1.88h4.12c.77,0,1.4.62,1.4,1.4v4.1h1.86V1.4C17.61.62,16.98,0,16.21,0Z"/>
  <path fill="${color}" d="M15.75,13.64c0,.54-.31,1.01-.76,1.24-.23-1.89-2.9-3.38-6.18-3.38s-5.95,1.49-6.18,3.38c-.45-.23-.76-.7-.76-1.24v-3.41H0v5.98C0,16.98.62,17.61,1.4,17.61h2.84s0,0,0,0h9.12s0,0,0,0h2.84c.77,0,1.4-.62,1.4-1.4v-5.98h-1.86v3.41Z"/>
  <path fill="${color}" d="M5.73,6.82c0,1.87,1.38,3.38,3.08,3.38s3.08-1.51,3.08-3.38-1.38-3.38-3.08-3.38-3.08,1.51-3.08,3.38Z"/>
</svg>`;
  return <SvgXml xml={xml} width={size} height={size} />;
}
