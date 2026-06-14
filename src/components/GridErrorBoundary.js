// ErrorBoundary generique pour les ecrans a liste (galerie photos perso /
// orga / event). Evite qu'une URL malformee ou un render thrown dans une
// cellule fasse planter tout l'ecran. Affiche un fallback avec retry.

import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';

export class GridErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.warn('GridErrorBoundary caught:', error?.message || error, info?.componentStack);
  }
  reset = () => this.setState({ hasError: false, error: null });
  render() {
    if (this.state.hasError) {
      return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 }}>
          <Text style={{ color: '#1a1a1a', fontSize: 16, fontWeight: '700', marginBottom: 8, textAlign: 'center' }}>
            Impossible d'afficher cette page
          </Text>
          <Text style={{ color: 'rgba(123,47,255,0.3)', fontSize: 13, marginBottom: 16, textAlign: 'center' }}>
            {this.state.error?.message || 'Erreur de rendu inattendue.'}
          </Text>
          <TouchableOpacity onPress={this.reset} style={{ backgroundColor: '#7B2FFF', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 10 }}>
            <Text style={{ color: '#fff', fontWeight: '600' }}>Réessayer</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}
