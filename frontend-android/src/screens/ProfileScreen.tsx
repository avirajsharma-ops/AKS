import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import api from '../services/api';

interface Profile {
  preferences: {
    topics: string[];
    communicationStyle: string;
  };
  relationships: Array<{
    name: string;
    relationship: string;
  }>;
  knowledgeAreas: string[];
  goals: Array<{
    description: string;
    category: string;
  }>;
  personalityTraits: string[];
}

export default function ProfileScreen({ navigation }: any) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    try {
      const response = await api.get('/profile');
      setProfile(response.data);
    } catch (error) {
      console.error('Error fetching profile:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    fetchProfile();
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#6366f1" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backButton}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>AI Profile</Text>
        <View style={{ width: 30 }} />
      </View>

      <ScrollView
        style={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#6366f1" />}
      >
        {!profile ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>🧠</Text>
            <Text style={styles.emptyTitle}>No Profile Data Yet</Text>
            <Text style={styles.emptyText}>
              Start speaking with AKS to build your AI profile. The more you interact, the better your clone understands you.
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Communication Style</Text>
              <View style={styles.card}>
                <Text style={styles.cardText}>
                  {profile.preferences?.communicationStyle || 'Not analyzed yet'}
                </Text>
              </View>
            </View>

            {profile.personalityTraits?.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Personality Traits</Text>
                <View style={styles.tagContainer}>
                  {profile.personalityTraits.map((trait, index) => (
                    <View key={index} style={styles.tag}>
                      <Text style={styles.tagText}>{trait}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {profile.preferences?.topics?.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Topics of Interest</Text>
                <View style={styles.tagContainer}>
                  {profile.preferences.topics.map((topic, index) => (
                    <View key={index} style={[styles.tag, styles.topicTag]}>
                      <Text style={styles.tagText}>{topic}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {profile.knowledgeAreas?.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Knowledge Areas</Text>
                <View style={styles.tagContainer}>
                  {profile.knowledgeAreas.map((area, index) => (
                    <View key={index} style={[styles.tag, styles.knowledgeTag]}>
                      <Text style={styles.tagText}>{area}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {profile.relationships?.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Relationships</Text>
                {profile.relationships.map((rel, index) => (
                  <View key={index} style={styles.relationshipCard}>
                    <Text style={styles.relationshipName}>{rel.name}</Text>
                    <Text style={styles.relationshipType}>{rel.relationship}</Text>
                  </View>
                ))}
              </View>
            )}

            {profile.goals?.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Goals</Text>
                {profile.goals.map((goal, index) => (
                  <View key={index} style={styles.goalCard}>
                    <Text style={styles.goalCategory}>{goal.category}</Text>
                    <Text style={styles.goalDescription}>{goal.description}</Text>
                  </View>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f1a',
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#0f0f1a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    paddingTop: 50,
    backgroundColor: '#1a1a2e',
    borderBottomWidth: 1,
    borderBottomColor: '#2d2d44',
  },
  backButton: {
    fontSize: 24,
    color: '#6366f1',
    width: 30,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  emptyState: {
    alignItems: 'center',
    padding: 40,
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: '#888',
    textAlign: 'center',
    lineHeight: 22,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6366f1',
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  card: {
    backgroundColor: '#252540',
    borderRadius: 12,
    padding: 16,
  },
  cardText: {
    color: '#fff',
    fontSize: 15,
    lineHeight: 22,
  },
  tagContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tag: {
    backgroundColor: '#6366f1',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginRight: 8,
    marginBottom: 8,
  },
  topicTag: {
    backgroundColor: '#8b5cf6',
  },
  knowledgeTag: {
    backgroundColor: '#10b981',
  },
  tagText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '500',
  },
  relationshipCard: {
    backgroundColor: '#252540',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  relationshipName: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '500',
  },
  relationshipType: {
    color: '#888',
    fontSize: 13,
  },
  goalCard: {
    backgroundColor: '#252540',
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
  },
  goalCategory: {
    color: '#6366f1',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  goalDescription: {
    color: '#fff',
    fontSize: 14,
    lineHeight: 20,
  },
});
