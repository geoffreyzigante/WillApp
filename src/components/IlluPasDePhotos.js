// Illustration "IlluPasDePhotos" — meme SVG que le site (assets/illu-pas-de-photos.svg),
// converti en react-native-svg : les classes CSS du fichier d origine ne sont
// pas supportees par react-native-svg, les proprietes sont donc inlinees.
import React from 'react';
import Svg, { Ellipse, Path, Polyline } from 'react-native-svg';

export function IlluPasDePhotos({ height = 84, trait = '#000', blanc = '#fff' }) {
  const [, , vbW, vbH] = '0 0 1064.46 1459.91'.split(' ').map(Number);
  const width = Math.round(height * (vbW / vbH));
  return (
    <Svg width={width} height={height} viewBox="0 0 1064.46 1459.91">
      <Path fill="#f4a6ff" d="M952.72,550.37c2.27-.94,4.57-1.74,6.83-2.78,86.15-39.61,127.52-133.64,92.4-210.01-30.25-65.78-107.37-96.87-183.23-78.96.94-2.27,2-4.46,2.86-6.79,32.9-88.93-4.33-184.67-83.17-213.83-67.9-25.12-144.43,7.42-185.39,73.73-.94-2.27-1.74-4.57-2.78-6.83C560.63,18.76,466.6-22.61,390.23,12.51c-65.78,30.25-96.87,107.37-78.96,183.23-2.27-.94-4.46-2-6.79-2.86-88.93-32.9-184.67,4.33-213.83,83.17-25.12,67.9,7.42,144.43,73.73,185.39-2.27.94-4.57,1.74-6.83,2.78-86.15,39.62-127.52,133.64-92.4,210.01,30.25,65.78,107.37,96.87,183.23,78.95-.94,2.28-2,4.46-2.86,6.79-32.9,88.93,4.33,184.67,83.17,213.84,67.9,25.12,144.43-7.42,185.39-73.74.94,2.27,1.74,4.57,2.78,6.83,39.62,86.15,133.64,127.52,210.01,92.4,65.78-30.25,96.87-107.37,78.96-183.23,2.28.94,4.46,2,6.79,2.86,88.93,32.9,184.67-4.33,213.84-83.16,25.12-67.9-7.42-144.43-73.73-185.4Z" />
      <Ellipse fill={blanc} cx="388.34" cy="471.57" rx="94.67" ry="131.04" />
      <Ellipse cx="388.34" cy="471.57" rx="43.05" ry="58.11" />
      <Path fill="none" stroke={trait} strokeLinecap="round" strokeLinejoin="round" strokeWidth="41.96" d="M373.76,878.2c-2.35,38.23-5.28,77.22-8.86,116.95-13.39,148.69-33.94,286.32-58.13,411.59-21.2-4.69-51.64-8.93-87.93-5.73-44.27,3.9-78.76,17.26-100.3,27.62" />
      <Path fill="none" stroke={trait} strokeLinecap="round" strokeLinejoin="round" strokeWidth="41.96" d="M659.56,900.91c9.35,175.91,18.7,351.81,28.05,527.72h0c32.2-4.51,72.01-7.39,117.39-4.68,38.95,2.33,73.13,8.24,101.48,14.98" />
      <Path fill="none" stroke={trait} strokeLinecap="round" strokeLinejoin="round" strokeWidth="41.96" d="M611.8,451.01c10.32,10.42,44.65,42.37,94.18,41.07,45.94-1.2,77.62-30.29,88.29-41.07" />
      <Polyline fill="none" stroke={trait} strokeLinecap="round" strokeLinejoin="round" strokeWidth="41.96" points="259.71 578.72 247.08 663.49 393.33 653.73" />
      <Polyline fill="none" stroke={trait} strokeLinecap="round" strokeLinejoin="round" strokeWidth="41.96" points="557.98 378.04 568.6 299.19 421.36 303.03" />
      <Path fill="none" stroke={trait} strokeLinecap="round" strokeLinejoin="round" strokeWidth="41.96" d="M940.13,482.57c-11.95-28.26-27.34-59.56-47.29-92.31-32.48-53.34-67.7-95.18-98.57-126.74-27.94-3.91-66.23-6.27-110.89,0-54.64,7.68-97.4,25.27-125.41,39.5" />
      <Path fill="none" stroke={trait} strokeLinecap="round" strokeLinejoin="round" strokeWidth="41.96" d="M464.6,696.42c26.67,6.48,64.57,12.64,109.96,10.21,40.27-2.16,73.68-10.39,98.04-18.38" />
      <Path fill={blanc} d="M399.51,471.32s13.84-16.19,30.91-16.19,17.07,32.39,0,32.39-30.91-16.19-30.91-16.19Z" />
      <Path fill="none" stroke={trait} strokeLinecap="round" strokeLinejoin="round" strokeWidth="41.96" d="M20.98,718.06c15.7,7.02,57.91,23.38,110.91,13.18,68.9-13.26,106.56-61.89,115.2-73.68" />
      <Path fill="none" stroke={trait} strokeLinecap="round" strokeLinejoin="round" strokeWidth="41.96" d="M557.98,294.61c-1.97-3.43-11.04-18.41-30.09-24.14-23.38-7.03-42.43,5.71-44.88,7.4" />
      <Path fill="none" stroke={trait} strokeLinecap="round" strokeLinejoin="round" strokeWidth="41.96" d="M513.33,253.22c2.7-1.32,26.3-12.33,49.63,0,14.29,7.55,20.84,19.83,23.06,24.56" />
      <Path fill="none" stroke={trait} strokeLinecap="round" strokeLinejoin="round" strokeWidth="41.96" d="M262.5,667.32c1.97,3.43,11.04,18.41,30.09,24.14,23.38,7.03,42.43-5.71,44.88-7.4" />
      <Path fill="none" stroke={trait} strokeLinecap="round" strokeLinejoin="round" strokeWidth="41.96" d="M307.14,708.71c-2.7,1.32-26.3,12.33-49.63,0-14.29-7.55-20.84-19.83-23.06-24.56" />
    </Svg>
  );
}
