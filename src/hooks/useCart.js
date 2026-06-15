// Hook panier scoped a un event. Storage local AsyncStorage cle
// `will:cart:{eventCode}` (array de photo.id = R2 key). Sync auto via
// cartChangeListeners + push backend cote runner authentifie.
//
// Retourne { cart, count, toggle, remove, persist }.

import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { cartChangeListeners, emitCartChange, pushCartToBackend } from '../services/cart';

export function useCart(eventCode) {
  const [cart, setCart] = useState([]);
  const [version, setVersion] = useState(0);
  const storageKey = eventCode ? `will:cart:${eventCode}` : null;
  useEffect(() => {
    if (!storageKey) { setCart([]); return; }
    let cancelled = false;
    AsyncStorage.getItem(storageKey).then((v) => {
      if (cancelled) return;
      try {
        const arr = v ? JSON.parse(v) : [];
        setCart(Array.isArray(arr) ? arr : []);
      } catch { setCart([]); }
    }).catch(() => { if (!cancelled) setCart([]); });
    return () => { cancelled = true; };
  }, [storageKey, version]);
  useEffect(() => {
    const fn = () => setVersion((v) => v + 1);
    cartChangeListeners.add(fn);
    return () => { cartChangeListeners.delete(fn); };
  }, []);
  const persist = useCallback((next) => {
    setCart(next);
    if (storageKey) {
      AsyncStorage.setItem(storageKey, JSON.stringify(next)).then(() => emitCartChange()).catch(() => {});
      pushCartToBackend(eventCode, next);
    }
  }, [storageKey, eventCode]);
  const toggle = useCallback((key) => {
    if (!key) return;
    setCart((prev) => {
      const i = prev.indexOf(key);
      const next = i >= 0 ? prev.filter((k) => k !== key) : [...prev, key];
      if (storageKey) {
        AsyncStorage.setItem(storageKey, JSON.stringify(next)).then(() => emitCartChange()).catch(() => {});
        pushCartToBackend(eventCode, next);
      }
      return next;
    });
  }, [storageKey, eventCode]);
  const remove = useCallback((key) => {
    if (!key) return;
    setCart((prev) => {
      const next = prev.filter((k) => k !== key);
      if (storageKey) {
        AsyncStorage.setItem(storageKey, JSON.stringify(next)).then(() => emitCartChange()).catch(() => {});
        pushCartToBackend(eventCode, next);
      }
      return next;
    });
  }, [storageKey, eventCode]);
  return { cart, count: cart.length, toggle, remove, persist };
}
