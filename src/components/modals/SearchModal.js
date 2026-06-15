// Modal Mes evenements (recherche). Bottom-sheet, tri ASC strict
// (decision user 2026-06-04 : toutes les listes d events).

import React from 'react';
import { Modal, View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { s } from '../../constants/styles';
import { formatDateLong, cityLabel, isUpcoming } from '../../utils/format';

export function SearchModal({ visible, events, onClose, onPick }) {
  const upcoming = events
    .filter(e => isUpcoming(e.event_date, e.event_date_end))
    .sort((a, b) => (a.event_date || '').localeCompare(b.event_date || ''));
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity activeOpacity={1} style={s.modalBackdrop} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={s.modalSheet} onPress={() => {}}>
          <TouchableOpacity onPress={onClose} hitSlop={20}>
            <View style={s.modalHandle} />
          </TouchableOpacity>
          <Text style={s.modalTitle}>Mon événement</Text>
          <ScrollView style={{ maxHeight: 400, marginTop: 8 }}>
            {upcoming.length === 0 && <Text style={s.empty}>Aucun événement à venir</Text>}
            {upcoming.map(e => (
              <TouchableOpacity key={e.code} style={s.eventPick} onPress={() => { onPick(e); onClose(); }}>
                <Text style={s.eventPickName}>{e.name}</Text>
                <Text style={s.eventPickDate}>{formatDateLong(e.event_date, e.event_date_end)} · {cityLabel(e.location)}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}
