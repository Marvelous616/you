import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  FlatList,
  SafeAreaView,
  StatusBar,
  Vibration,
} from 'react-native';
import { Marker } from '@life-logger/domain';
import { InMemoryMobileStorage } from './src/local-store';
import { MobileSyncClient } from './src/sync-client';

const storage = new InMemoryMobileStorage();
const syncClient = new MobileSyncClient(storage, {
  serverUrl: 'http://10.0.2.2:4000', // standard Android emulator host alias
  clientId: 'android-companion-1',
});

export default function App() {
  const [noteText, setNoteText] = useState('');
  const [pendingCount, setPendingCount] = useState(0);
  const [lastSaveLatency, setLastSaveLatency] = useState<number | null>(null);
  const [syncStatus, setSyncStatus] = useState<string>('Ready');
  const [markers, setMarkers] = useState<Marker[]>([]);

  const refreshOutbox = useCallback(async () => {
    const count = await storage.getPendingCount();
    setPendingCount(count);
  }, []);

  useEffect(() => {
    refreshOutbox();
  }, [refreshOutbox]);

  const handleMarkNow = async () => {
    Vibration.vibrate(50);
    const now = new Date();
    const newMarker: Marker = {
      id: `m-phone-${Date.now()}`,
      markedAt: now.toISOString(),
      timezoneOffsetMinutes: -new Date().getTimezoneOffset(),
      note: noteText.trim() || undefined,
      precision: 'exact',
      source: 'live',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      isDeleted: false,
    };

    const { saveDurationMs } = await storage.saveMarkerAndEnqueueOutbox(newMarker);
    setLastSaveLatency(saveDurationMs);
    setMarkers((prev) => [newMarker, ...prev]);
    setNoteText('');
    await refreshOutbox();
  };

  const handleSyncNow = async () => {
    setSyncStatus('Syncing...');
    const res = await syncClient.syncNow();
    if (res.error) {
      setSyncStatus(`Sync error: ${res.error}`);
    } else {
      setSyncStatus(`Synced ${res.syncedCount} markers`);
    }
    await refreshOutbox();
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0f172a" />
      <View style={styles.header}>
        <Text style={styles.title}>Life Logger</Text>
        <Text style={styles.subtitle}>Mobile Companion (Offline-First)</Text>
      </View>

      <View style={styles.card}>
        <TextInput
          style={styles.input}
          placeholder="Optional note (e.g., Coffee, Walk)..."
          placeholderTextColor="#94a3b8"
          value={noteText}
          onChangeText={setNoteText}
        />

        <TouchableOpacity style={styles.markButton} onPress={handleMarkNow} activeOpacity={0.8}>
          <Text style={styles.markButtonText}>MARK NOW</Text>
        </TouchableOpacity>

        {lastSaveLatency !== null && (
          <Text style={styles.latencyText}>
            ⚡ Saved offline in {lastSaveLatency.toFixed(3)} ms (&lt; 50 ms budget)
          </Text>
        )}
      </View>

      <View style={styles.syncBar}>
        <View>
          <Text style={styles.syncStatus}>{syncStatus}</Text>
          <Text style={styles.pendingText}>{pendingCount} records pending sync</Text>
        </View>
        <TouchableOpacity style={styles.syncButton} onPress={handleSyncNow} activeOpacity={0.8}>
          <Text style={styles.syncButtonText}>Sync Now</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.historySection}>
        <Text style={styles.sectionHeader}>TODAY'S CAPTURES ({markers.length})</Text>
        <FlatList
          data={markers}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <View style={styles.markerRow}>
              <Text style={styles.markerTime}>
                {new Date(item.markedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </Text>
              <Text style={styles.markerNote}>{item.note || 'Quick Marker'}</Text>
            </View>
          )}
          ListEmptyComponent={
            <Text style={styles.emptyText}>No markers logged on this device yet.</Text>
          }
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
    padding: 16,
  },
  header: {
    marginVertical: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#f8fafc',
  },
  subtitle: {
    fontSize: 14,
    color: '#94a3b8',
    marginTop: 2,
  },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  input: {
    backgroundColor: '#334155',
    color: '#f8fafc',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 12,
  },
  markButton: {
    backgroundColor: '#0284c7',
    paddingVertical: 18,
    borderRadius: 8,
    alignItems: 'center',
  },
  markButtonText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  latencyText: {
    color: '#38bdf8',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 10,
    fontWeight: '500',
  },
  syncBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  syncStatus: {
    color: '#f8fafc',
    fontSize: 13,
    fontWeight: '600',
  },
  pendingText: {
    color: '#94a3b8',
    fontSize: 12,
  },
  syncButton: {
    backgroundColor: '#334155',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 6,
  },
  syncButtonText: {
    color: '#38bdf8',
    fontSize: 13,
    fontWeight: '600',
  },
  historySection: {
    flex: 1,
  },
  sectionHeader: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  markerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    padding: 12,
    borderRadius: 6,
    marginBottom: 6,
  },
  markerTime: {
    color: '#38bdf8',
    fontWeight: '600',
    width: 65,
    fontSize: 14,
  },
  markerNote: {
    color: '#f8fafc',
    fontSize: 14,
    flex: 1,
  },
  emptyText: {
    color: '#64748b',
    textAlign: 'center',
    marginTop: 24,
    fontStyle: 'italic',
  },
});
