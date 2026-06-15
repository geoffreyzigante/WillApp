// Agrege TOUTES les cles `will:cart:*` d AsyncStorage en une Map
// <eventCode, photoKeys[]>. Utilise par PanierScreen (onglet Panier global)
// pour afficher le panier cross-event + total agrege.
//
// Phase 1 : lecture locale (rapide). Phase 2 : fetch backend si authed,
// REPLACE local (backend = source of truth). La migration union du panier
// anonyme est faite UNE fois dans App.useEffect au login. Ici on remplace
// strict pour respecter les suppressions cross-device.

import { useState, useEffect, useCallback, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  cartChangeListeners,
  emitCartChange,
  pushCartToBackend,
  getCurrentRunnerSession,
} from '../services/cart';
import { API_URL } from '../constants/api';

export function useAllCarts() {
  const [carts, setCarts] = useState(new Map());
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Phase 1 : lecture locale
      try {
        const allKeys = await AsyncStorage.getAllKeys();
        const cartKeys = (allKeys || []).filter((k) => k.startsWith('will:cart:'));
        const entries = cartKeys.length > 0 ? await AsyncStorage.multiGet(cartKeys) : [];
        if (cancelled) return;
        const m = new Map();
        for (const [k, v] of entries) {
          const code = k.substring('will:cart:'.length);
          try {
            const arr = JSON.parse(v || '[]');
            if (Array.isArray(arr) && arr.length > 0) m.set(code, arr);
          } catch {}
        }
        setCarts(m);
      } catch {
        if (!cancelled) setCarts(new Map());
      }
      // Phase 2 : fetch backend si authed
      const s = getCurrentRunnerSession();
      if (!s?.token || cancelled) return;
      try {
        const r = await fetch(`${API_URL}/runner/cart`, {
          headers: { Authorization: `Bearer ${s.token}` },
        });
        if (!r.ok || cancelled) return;
        const data = await r.json().catch(() => null);
        const backend = (data && data.carts && typeof data.carts === 'object') ? data.carts : {};
        const allKeys2 = await AsyncStorage.getAllKeys();
        const cartKeys2 = (allKeys2 || []).filter((k) => k.startsWith('will:cart:'));
        if (cancelled) return;
        const localCodes = cartKeys2.map((k) => k.substring('will:cart:'.length));
        const allCodes = new Set([...Object.keys(backend), ...localCodes]);
        const merged = new Map();
        for (const code of allCodes) {
          const remote = backend[code] || [];
          if (remote.length > 0) {
            merged.set(code, remote);
            await AsyncStorage.setItem(`will:cart:${code}`, JSON.stringify(remote));
          } else {
            await AsyncStorage.removeItem(`will:cart:${code}`);
          }
        }
        if (cancelled) return;
        setCarts(merged);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [version]);
  useEffect(() => {
    const fn = () => setVersion((v) => v + 1);
    cartChangeListeners.add(fn);
    return () => { cartChangeListeners.delete(fn); };
  }, []);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const total = useMemo(() => {
    let n = 0;
    for (const arr of carts.values()) n += arr.length;
    return n;
  }, [carts]);
  const remove = useCallback((eventCode, photoKey) => {
    if (!eventCode || !photoKey) return;
    const k = `will:cart:${eventCode}`;
    AsyncStorage.getItem(k).then((v) => {
      try {
        const arr = JSON.parse(v || '[]');
        const next = Array.isArray(arr) ? arr.filter((x) => x !== photoKey) : [];
        if (next.length === 0) {
          AsyncStorage.removeItem(k).then(() => emitCartChange()).catch(() => {});
        } else {
          AsyncStorage.setItem(k, JSON.stringify(next)).then(() => emitCartChange()).catch(() => {});
        }
        pushCartToBackend(eventCode, next);
      } catch {}
    }).catch(() => {});
  }, []);
  return { carts, total, remove, refresh };
}
