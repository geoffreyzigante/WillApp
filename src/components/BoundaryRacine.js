// Filet de securite au tout premier rendu.
//
// Une erreur JavaScript pendant le rendu initial fait quitter l app sans un
// mot : l ecran affiche le lanceur, puis plus rien. Ce boundier attrape
// l erreur et l affiche, ce qui transforme un plantage muet en message
// lisible — et copiable — depuis le telephone.
//
// Il enveloppe la racine, donc il ne doit lui-meme rien importer de
// complique : ni police custom, ni couleur du theme, ni SVG.

import React from 'react';
import { View, Text, ScrollView } from 'react-native';

export class BoundaryRacine extends React.Component {
  constructor(props) {
    super(props);
    this.state = { erreur: null, pile: '' };
  }
  static getDerivedStateFromError(erreur) {
    return { erreur };
  }
  componentDidCatch(erreur, info) {
    console.warn('[racine] plantage au rendu :', erreur?.message || erreur, info?.componentStack);
    this.setState({ pile: String(info?.componentStack || '').slice(0, 1500) });
  }
  render() {
    const { erreur, pile } = this.state;
    if (!erreur) return this.props.children;
    return (
      <View style={{ flex: 1, backgroundColor: '#1a0b2e', paddingTop: 70, paddingHorizontal: 20 }}>
        <Text selectable style={{ color: '#f4a6ff', fontSize: 18, fontWeight: '700', marginBottom: 12 }}>
          Erreur au démarrage
        </Text>
        <ScrollView>
          <Text selectable style={{ color: '#fff', fontSize: 13, marginBottom: 16 }}>
            {String(erreur?.message || erreur)}
          </Text>
          <Text selectable style={{ color: '#fff', fontSize: 11, opacity: 0.75, marginBottom: 16 }}>
            {String(erreur?.stack || '').slice(0, 1200)}
          </Text>
          <Text selectable style={{ color: '#c9a7ff', fontSize: 11 }}>{pile}</Text>
        </ScrollView>
      </View>
    );
  }
}
