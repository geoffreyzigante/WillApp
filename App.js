import { CameraView, useCameraPermissions } from 'expo-camera';
import { useState, useRef } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ActivityIndicator } from 'react-native';

const WORKER_URL = "https://will-api.geoffreyzigante.workers.dev";
const ADMIN_SECRET = "will";
const EVENT = "test-ios";
const WILL_ID = "will_ios_01";

export default function App() {
  const [permission, requestPermission] = useCameraPermissions();
  const [status, setStatus] = useState('idle');
  const [photoCount, setPhotoCount] = useState(0);
  const cameraRef = useRef(null);
  const shootingRef = useRef(false);

  const startBurst = async () => {
    if (!cameraRef.current || shootingRef.current) return;
    shootingRef.current = true;
    setStatus('shooting');

    for (let i = 0; i < 5; i++) {
      if (!shootingRef.current) break;
      try {
        const photo = await cameraRef.current.takePictureAsync({
          quality: 0.9,
          base64: false,
          skipProcessing: false,
        });
        uploadPhoto(photo, i);
        setPhotoCount(c => c + 1);
        await new Promise(r => setTimeout(r, 300));
      } catch (e) {
        console.log('Erreur photo:', e);
      }
    }

    shootingRef.current = false;
    setStatus('idle');
  };

  const uploadPhoto = async (photo, index) => {
    try {
      const ts = Date.now();
      const now = new Date();
      const hms = now.toTimeString().slice(0,8).replace(/:/g,'');
      const date = now.toISOString().slice(0,10).replace(/-/g,'');
      const key = `${EVENT}/${WILL_ID}/${date}/${hms}_${ts}_${String(index).padStart(3,'0')}.jpg`;

      const response = await fetch(photo.uri);
      const blob = await response.blob();

      await fetch(`${WORKER_URL}/${key}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'image/jpeg',
          'Authorization': `Bearer ${ADMIN_SECRET}`,
        },
        body: blob,
      });
      console.log('Photo uploadée:', key);
    } catch (e) {
      console.log('Erreur upload:', e);
    }
  };

  if (!permission) return (
    <View style={styles.container}>
      <ActivityIndicator color="#fff" />
    </View>
  );

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Will</Text>
        <Text style={styles.subtitle}>Accès caméra nécessaire</Text>
        <TouchableOpacity style={styles.btn} onPress={requestPermission}>
          <Text style={styles.btnText}>Autoriser</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView style={styles.camera} facing="back" ref={cameraRef}>
        <View style={styles.overlay}>
          <Text style={styles.title}>Will</Text>
          <View style={styles.statusBadge}>
            <View style={[styles.dot, {
              backgroundColor: status === 'shooting' ? '#4ade80' : '#94a3b8'
            }]} />
            <Text style={styles.statusText}>
              {status === 'shooting' ? 'Rafale en cours...' : 'En attente'}
            </Text>
          </View>
          <Text style={styles.counter}>{photoCount}</Text>
          <Text style={styles.counterLabel}>photos prises</Text>
          <TouchableOpacity style={styles.btn} onPress={startBurst} disabled={status === 'shooting'}>
            <Text style={styles.btnText}>
              {status === 'shooting' ? '...' : 'Déclencher (test)'}
            </Text>
          </TouchableOpacity>
        </View>
      </CameraView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  camera: {
    flex: 1,
    width: '100%',
  },
  overlay: {
    flex: 1,
    backgroundColor: 'transparent',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 40,
    paddingTop: 70,
    paddingBottom: 60,
  },
  title: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#fff',
    letterSpacing: 4,
  },
  subtitle: {
    fontSize: 16,
    color: '#94a3b8',
    textAlign: 'center',
    marginVertical: 16,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 24,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  statusText: {
    color: '#fff',
    fontSize: 14,
  },
  counter: {
    color: '#fff',
    fontSize: 72,
    fontWeight: 'bold',
  },
  counterLabel: {
    color: '#94a3b8',
    fontSize: 14,
    marginTop: -10,
  },
  btn: {
    backgroundColor: '#3b82f6',
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 14,
    width: '100%',
    alignItems: 'center',
  },
  btnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
