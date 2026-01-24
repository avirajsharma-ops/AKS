import React, { useState, useEffect } from 'react';
import { profileAPI } from '../services/api';
import { useAuth } from '../contexts/AuthContext';

function Profile() {
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [questions, setQuestions] = useState([]);
  const [askInput, setAskInput] = useState('');
  const [cloneResponse, setCloneResponse] = useState('');
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    loadProfile();
    loadQuestions();
  }, []);

  const loadProfile = async () => {
    try {
      const response = await profileAPI.get();
      setProfile(response.data);
    } catch (error) {
      console.error('Failed to load profile:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadQuestions = async () => {
    try {
      const response = await profileAPI.getQuestions();
      setQuestions(response.data.questions || []);
    } catch (error) {
      console.error('Failed to load questions:', error);
    }
  };

  const askClone = async (e) => {
    e.preventDefault();
    if (!askInput.trim() || asking) return;

    setAsking(true);
    setCloneResponse('');

    try {
      const response = await profileAPI.askClone(askInput);
      setCloneResponse(response.data.response);
      setAskInput('');
    } catch (error) {
      console.error('Failed to ask clone:', error);
    } finally {
      setAsking(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: '60px' }}>
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div>
      {/* Profile Header */}
      <div className="profile-header">
        <div className="profile-avatar">
          {user?.name?.charAt(0).toUpperCase() || '?'}
        </div>
        <h2 className="profile-name">{user?.name || 'Anonymous'}</h2>
        <p className="profile-completeness">
          Profile {profile?.completeness || 0}% complete
        </p>
        <div className="progress-bar">
          <div 
            className="progress-fill" 
            style={{ width: `${profile?.completeness || 0}%` }}
          />
        </div>
      </div>

      {/* Ask your clone */}
      <div className="card">
        <h3 className="card-title">💬 Ask Your Clone</h3>
        <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '16px' }}>
          Test how well your AI clone knows you
        </p>
        
        <form onSubmit={askClone}>
          <input
            type="text"
            className="input"
            value={askInput}
            onChange={(e) => setAskInput(e.target.value)}
            placeholder="e.g., What's my favorite food?"
          />
          <button 
            type="submit" 
            className="btn btn-primary" 
            style={{ width: '100%', marginTop: '12px' }}
            disabled={asking || !askInput.trim()}
          >
            {asking ? <div className="spinner" /> : 'Ask'}
          </button>
        </form>

        {cloneResponse && (
          <div className="response-bubble" style={{ marginTop: '16px' }}>
            <p>{cloneResponse}</p>
          </div>
        )}
      </div>

      {/* Suggested questions */}
      {questions.length > 0 && (
        <div className="card">
          <h3 className="card-title">❓ Help Me Learn More</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '16px' }}>
            Answer these to improve your profile
          </p>
          {questions.map((q, i) => (
            <div 
              key={i}
              style={{
                background: 'var(--bg-tertiary)',
                padding: '12px',
                borderRadius: '8px',
                marginBottom: '8px',
                fontSize: '14px',
                cursor: 'pointer'
              }}
              onClick={() => setAskInput(q)}
            >
              {q}
            </div>
          ))}
        </div>
      )}

      {/* Profile Sections */}
      {profile?.profile && (
        <>
          {/* Preferences */}
          {profile.profile.topPreferences && (
            <div className="card">
              <h3 className="card-title">❤️ Preferences</h3>
              
              {profile.profile.topPreferences.food?.length > 0 && (
                <div style={{ marginBottom: '16px' }}>
                  <h4 style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                    Food
                  </h4>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {profile.profile.topPreferences.food.map((f, i) => (
                      <span key={i} style={{
                        background: f.sentiment === 'likes' 
                          ? 'rgba(16, 185, 129, 0.2)' 
                          : 'rgba(239, 68, 68, 0.2)',
                        padding: '6px 12px',
                        borderRadius: '20px',
                        fontSize: '13px'
                      }}>
                        {f.sentiment === 'likes' ? '👍' : '👎'} {f.item}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {profile.profile.topPreferences.activities?.length > 0 && (
                <div>
                  <h4 style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                    Activities
                  </h4>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {profile.profile.topPreferences.activities.map((a, i) => (
                      <span key={i} style={{
                        background: 'var(--bg-tertiary)',
                        padding: '6px 12px',
                        borderRadius: '20px',
                        fontSize: '13px'
                      }}>
                        🎯 {a.item}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {!profile.profile.topPreferences.food?.length && 
               !profile.profile.topPreferences.activities?.length && (
                <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
                  No preferences learned yet. Keep talking!
                </p>
              )}
            </div>
          )}

          {/* Relationships */}
          {profile.profile.relationships?.length > 0 && (
            <div className="card">
              <h3 className="card-title">👥 People You Know</h3>
              {profile.profile.relationships.slice(0, 5).map((r, i) => (
                <div key={i} style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '8px 0',
                  borderBottom: i < 4 ? '1px solid var(--border)' : 'none'
                }}>
                  <span>{r.name}</span>
                  <span style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
                    {r.relationship || 'Unknown'}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Knowledge Areas */}
          {profile.profile.knowledgeAreas?.length > 0 && (
            <div className="card">
              <h3 className="card-title">🧠 Topics You Know</h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {profile.profile.knowledgeAreas.slice(0, 10).map((k, i) => (
                  <span key={i} style={{
                    background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
                    padding: '6px 12px',
                    borderRadius: '20px',
                    fontSize: '13px'
                  }}>
                    {k.topic}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Empty state */}
      {profile?.completeness < 10 && (
        <div className="card" style={{ textAlign: 'center' }}>
          <span style={{ fontSize: '48px' }}>🌱</span>
          <h3 style={{ marginTop: '16px', marginBottom: '8px' }}>Just Getting Started</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
            Talk more to help your AI clone learn about you. Share your thoughts, 
            preferences, and stories!
          </p>
        </div>
      )}
    </div>
  );
}

export default Profile;
