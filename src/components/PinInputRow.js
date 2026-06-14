// Composant input PIN : 4 cases numeriques separees, auto-focus + auto-advance.
// Utilise dans le wizard de creation (step 4), l'edition drill-down, et le
// login photographe. La prop `onComplete` declenche au remplissage 4eme case.
//
// 2 variantes :
//   - default (useNumpad=false) : 4 TextInput natifs, clavier system iOS
//   - useNumpad=true : pad custom 3x4 (1-9 / vide / 0 / ⌫) pour eviter le
//     KeyboardAvoidingView qui fait sauter les modals

import React, { useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, TextInput, Animated } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { C } from '../constants/colors';
import { Haptics } from '../services/haptics';

export function PinInputRow({ value, onChange, onComplete, autoFocus = true, focusTrigger = 0, error = false, size = 'lg', useNumpad = false }) {
  const inputs = useRef([null, null, null, null]);
  const digits = String(value || '').padEnd(4, ' ').split('').slice(0, 4).map(c => c === ' ' ? '' : c);
  const shake = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (autoFocus) {
      const t = setTimeout(() => inputs.current[0]?.focus(), 200);
      return () => clearTimeout(t);
    }
  }, [autoFocus]);

  // focusTrigger : bumpe par le parent pour reposer le focus sur la 1ere case
  // (ex: passage a l'etape PIN du wizard, ou re-affichage du modal d'edition).
  useEffect(() => {
    if (focusTrigger > 0) {
      const t = setTimeout(() => inputs.current[0]?.focus(), 120);
      return () => clearTimeout(t);
    }
  }, [focusTrigger]);

  useEffect(() => {
    if (!error) return;
    Animated.sequence([
      Animated.timing(shake, { toValue: 8, duration: 50, useNativeDriver: true }),
      Animated.timing(shake, { toValue: -8, duration: 50, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 6, duration: 50, useNativeDriver: true }),
      Animated.timing(shake, { toValue: -6, duration: 50, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start();
  }, [error, shake]);

  const setDigitAt = (i, raw) => {
    const d = String(raw || '').replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[i] = d;
    const joined = next.join('').slice(0, 4);
    onChange(joined);
    if (d && i < 3) inputs.current[i + 1]?.focus();
    if (joined.length === 4 && /^\d{4}$/.test(joined) && onComplete) {
      setTimeout(() => onComplete(joined), 80);
    }
  };

  const onKeyPress = (i, e) => {
    if (e.nativeEvent.key === 'Backspace' && !digits[i] && i > 0) {
      inputs.current[i - 1]?.focus();
      const next = [...digits];
      next[i - 1] = '';
      onChange(next.join(''));
    }
  };

  const boxW = size === 'lg' ? 60 : 52;
  const boxH = size === 'lg' ? 68 : 60;
  const fontSize = size === 'lg' ? 30 : 26;

  // Mode pad custom : pas de TextInput (donc pas de clavier system, donc
  // pas de KeyboardAvoidingView qui fait sauter la modal). 4 Views read-only
  // pour les digits + un keypad 3x4 (1-9 / · 0 ⌫) en dessous.
  if (useNumpad) {
    const pressDigit = (d) => {
      try { Haptics?.selectionAsync?.(); } catch {}
      const cur = String(value || '');
      if (cur.length >= 4) return;
      const next = cur + String(d);
      onChange(next);
      if (next.length === 4 && /^\d{4}$/.test(next) && onComplete) {
        setTimeout(() => onComplete(next), 80);
      }
    };
    const pressDelete = () => {
      try { Haptics?.selectionAsync?.(); } catch {}
      const cur = String(value || '');
      if (cur.length === 0) return;
      onChange(cur.slice(0, -1));
    };
    return (
      <View>
        <Animated.View style={{ flexDirection: 'row', justifyContent: 'center', gap: 12, transform: [{ translateX: shake }] }}>
          {[0, 1, 2, 3].map(i => {
            const filled = !!digits[i];
            return (
              <View
                key={i}
                style={{
                  width: boxW, height: boxH,
                  borderRadius: 14,
                  borderWidth: 1.5,
                  borderColor: error ? C.error : (filled ? C.primary : '#e8defc'),
                  backgroundColor: filled ? '#faf9ff' : '#fff',
                  alignItems: 'center', justifyContent: 'center',
                }}
              >
                <Text style={{
                  fontSize, fontWeight: '700',
                  fontFamily: 'AVEstiana',
                  color: C.primary,
                }}>
                  {digits[i]}
                </Text>
              </View>
            );
          })}
        </Animated.View>
        {/* Keypad 3x4 : 1-9 / vide 0 backspace */}
        <View style={{ marginTop: 22, alignItems: 'center' }}>
          {[[1, 2, 3], [4, 5, 6], [7, 8, 9], [null, 0, 'del']].map((row, ri) => (
            <View key={ri} style={{ flexDirection: 'row', gap: 16, marginBottom: ri < 3 ? 12 : 0 }}>
              {row.map((k, ci) => {
                if (k === null) return <View key={ci} style={{ width: 64, height: 64 }} />;
                if (k === 'del') {
                  return (
                    <TouchableOpacity
                      key={ci}
                      onPress={pressDelete}
                      activeOpacity={0.5}
                      style={{
                        width: 64, height: 64, borderRadius: 32,
                        alignItems: 'center', justifyContent: 'center',
                      }}
                      accessibilityLabel="Effacer"
                    >
                      <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
                        <Path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z" stroke={C.text} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
                        <Path d="m18 9-6 6M12 9l6 6" stroke={C.text} strokeWidth={1.8} strokeLinecap="round" />
                      </Svg>
                    </TouchableOpacity>
                  );
                }
                return (
                  <TouchableOpacity
                    key={ci}
                    onPress={() => pressDigit(k)}
                    activeOpacity={0.5}
                    style={{
                      width: 64, height: 64, borderRadius: 32,
                      backgroundColor: '#f5f3ff',
                      alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    <Text style={{
                      fontSize: 26, fontWeight: '400',
                      color: C.text, fontFamily: 'Montserrat',
                    }}>
                      {k}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}
        </View>
      </View>
    );
  }

  return (
    <Animated.View style={{ flexDirection: 'row', justifyContent: 'center', gap: 12, transform: [{ translateX: shake }] }}>
      {[0, 1, 2, 3].map(i => {
        const filled = !!digits[i];
        return (
          <TextInput
            key={i}
            ref={r => (inputs.current[i] = r)}
            value={digits[i]}
            onChangeText={v => setDigitAt(i, v)}
            onKeyPress={e => onKeyPress(i, e)}
            keyboardType="number-pad"
            maxLength={1}
            selectTextOnFocus
            textContentType="oneTimeCode"
            style={{
              width: boxW, height: boxH,
              borderRadius: 14,
              borderWidth: 1.5,
              borderColor: error ? C.error : (filled ? C.primary : '#e8defc'),
              backgroundColor: filled ? '#faf9ff' : '#fff',
              fontSize, fontWeight: '700',
              fontFamily: 'AVEstiana',
              color: C.primary,
              textAlign: 'center',
            }}
          />
        );
      })}
    </Animated.View>
  );
}
