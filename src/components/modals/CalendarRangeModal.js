// Picker calendrier custom (sans dependance externe). Mode plage : 1er tap
// = debut, 2e tap = fin. Si le 2e tap est < debut, la selection redemarre
// depuis ce jour. Meme jour tape deux fois => event 1 jour (end === start).
// Le grid affiche 6 semaines x 7 jours commencant un lundi pour rester
// proche du Calendrier iOS / dashboard.

import React, { useState, useEffect, useMemo } from 'react';
import { Modal, View, Text, TouchableOpacity } from 'react-native';
import { C } from '../../constants/colors';
import { formatDateForForm } from '../../utils/format';

export function CalendarRangeModal({ visible, onClose, initialStart, initialEnd, minDate, onConfirm }) {
  const today = useMemo(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d;
  }, []);
  const minD = useMemo(() => {
    if (!minDate) return null;
    const d = new Date(minDate); d.setHours(0, 0, 0, 0); return d;
  }, [minDate]);
  const initialView = initialStart || today;
  const [viewYear, setViewYear] = useState(initialView.getFullYear());
  const [viewMonth, setViewMonth] = useState(initialView.getMonth());
  const [start, setStart] = useState(initialStart ? new Date(initialStart) : null);
  const [end, setEnd] = useState(initialEnd ? new Date(initialEnd) : null);

  useEffect(() => {
    if (visible) {
      const init = initialStart || today;
      setViewYear(init.getFullYear());
      setViewMonth(init.getMonth());
      setStart(initialStart ? new Date(initialStart) : null);
      setEnd(initialEnd ? new Date(initialEnd) : null);
    }
  }, [visible]);

  const monthDays = useMemo(() => {
    const first = new Date(viewYear, viewMonth, 1);
    const firstWeekday = (first.getDay() + 6) % 7; // 0=Lun ... 6=Dim
    const grid = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(viewYear, viewMonth, 1 - firstWeekday + i);
      d.setHours(0, 0, 0, 0);
      grid.push(d);
    }
    return grid;
  }, [viewYear, viewMonth]);

  const sameDay = (a, b) => a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const isCurrentMonth = (d) => d.getMonth() === viewMonth;
  const isBeforeMin = (d) => minD && d < minD;

  const onTapDay = (d) => {
    if (isBeforeMin(d) || !isCurrentMonth(d)) return;
    const dn = new Date(d); dn.setHours(0, 0, 0, 0);
    if (!start || (start && end)) {
      setStart(dn); setEnd(null);
      return;
    }
    if (sameDay(dn, start)) {
      setEnd(dn);
      return;
    }
    if (dn < start) {
      setStart(dn); setEnd(null);
    } else {
      setEnd(dn);
    }
  };

  const goPrev = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1); }
    else setViewMonth(viewMonth - 1);
  };
  const goNext = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1); }
    else setViewMonth(viewMonth + 1);
  };

  const canConfirm = !!start;
  const isSingle = start && (!end || sameDay(start, end));
  const handleConfirm = () => {
    if (!start) return;
    onConfirm(start, isSingle ? null : end);
    onClose();
  };

  const monthRaw = new Date(viewYear, viewMonth, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  const monthLabel = monthRaw.charAt(0).toUpperCase() + monthRaw.slice(1);

  const summary = (() => {
    if (!start) return 'Tape un jour pour commencer';
    if (!end) return `Début : ${start.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })} · tape un 2e jour pour finir (ou le même pour 1 jour)`;
    return formatDateForForm(start.toISOString().slice(0, 10), sameDay(start, end) ? null : end.toISOString().slice(0, 10));
  })();

  // Cell renderer factorise : on separe le fill (bar pale violet) du dot
  // (cercle primary), pour rendre les bords du range proprement. On gate
  // sur inMonth pour ne pas tracer la range sur les jours grises du mois adjacent.
  const renderCell = (d, idx) => {
    const inMonth = isCurrentMonth(d);
    const disabled = !inMonth || isBeforeMin(d);
    const isStart = inMonth && sameDay(d, start);
    const isEnd = inMonth && sameDay(d, end);
    const hasRange = start && end && !sameDay(start, end);
    const inMiddle = inMonth && hasRange && d > start && d < end;
    const showLeftBar = inMonth && hasRange && (inMiddle || (isEnd && !isStart));
    const showRightBar = inMonth && hasRange && (inMiddle || (isStart && !isEnd));
    const isEdge = isStart || isEnd;
    return (
      <TouchableOpacity
        key={idx}
        onPress={() => onTapDay(d)}
        disabled={disabled}
        activeOpacity={0.7}
        style={{ flex: 1, height: 42, alignItems: 'center', justifyContent: 'center' }}
      >
        {showLeftBar ? (
          <View style={{ position: 'absolute', top: 6, bottom: 6, left: 0, right: '50%', backgroundColor: '#EDE5FF' }} />
        ) : null}
        {showRightBar ? (
          <View style={{ position: 'absolute', top: 6, bottom: 6, left: '50%', right: 0, backgroundColor: '#EDE5FF' }} />
        ) : null}
        {isEdge ? (
          <View style={{ position: 'absolute', width: 36, height: 36, borderRadius: 18, backgroundColor: C.primary }} />
        ) : null}
        <Text style={{
          color: disabled ? '#cfcadd' : isEdge ? '#fff' : (showLeftBar || showRightBar) ? C.text : C.text,
          fontWeight: isEdge ? '700' : '500',
          fontSize: 14,
        }}>
          {d.getDate()}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity activeOpacity={1} onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
        <TouchableOpacity activeOpacity={1} onPress={() => {}} style={{ backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 18, paddingBottom: 30 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <TouchableOpacity onPress={goPrev} hitSlop={8} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: '#f5f3ff' }}>
              <Text style={{ fontSize: 22, color: C.primary, marginTop: -2 }}>‹</Text>
            </TouchableOpacity>
            <Text style={{ fontSize: 17, fontWeight: '700', color: C.text }}>{monthLabel}</Text>
            <TouchableOpacity onPress={goNext} hitSlop={8} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: '#f5f3ff' }}>
              <Text style={{ fontSize: 22, color: C.primary, marginTop: -2 }}>›</Text>
            </TouchableOpacity>
          </View>
          <View style={{ flexDirection: 'row', marginBottom: 2 }}>
            {['L','M','M','J','V','S','D'].map((d, i) => (
              <View key={i} style={{ flex: 1, alignItems: 'center', paddingVertical: 4 }}>
                <Text style={{ color: C.textSoft, fontSize: 11, fontWeight: '700' }}>{d}</Text>
              </View>
            ))}
          </View>
          {Array.from({ length: 6 }).map((_, row) => (
            <View key={row} style={{ flexDirection: 'row' }}>
              {monthDays.slice(row * 7, row * 7 + 7).map((d, i) => renderCell(d, `${row}-${i}`))}
            </View>
          ))}
          <Text style={{ color: C.textSoft, fontSize: 12, textAlign: 'center', marginTop: 14, paddingHorizontal: 4, lineHeight: 17 }}>
            {summary}
          </Text>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
            <TouchableOpacity onPress={onClose} style={{ flex: 1, paddingVertical: 14, borderRadius: 14, alignItems: 'center', backgroundColor: '#f5f3ff' }}>
              <Text style={{ color: C.primary, fontSize: 15, fontWeight: '700' }}>Annuler</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleConfirm} disabled={!canConfirm} style={{ flex: 1, paddingVertical: 14, borderRadius: 14, alignItems: 'center', backgroundColor: C.pinkPill, opacity: canConfirm ? 1 : 0.5 }}>
              <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>Confirmer</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}
