import React, { useState, useEffect } from 'react';
import { transcriptAPI } from '../services/api';

function History() {
  const [transcripts, setTranscripts] = useState([]);
  const [topics, setTopics] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('recent');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [transcriptsRes, topicsRes, sessionsRes] = await Promise.all([
        transcriptAPI.getAll({ limit: 20 }),
        transcriptAPI.getTopics(),
        transcriptAPI.getSessions()
      ]);
      
      setTranscripts(transcriptsRes.data.transcripts || []);
      setTopics(topicsRes.data.topics || []);
      setSessions(sessionsRes.data.sessions || []);
    } catch (error) {
      console.error('Failed to load history:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery.trim() || searching) return;

    setSearching(true);
    try {
      const response = await transcriptAPI.search(searchQuery, 10);
      setSearchResults(response.data.results || []);
    } catch (error) {
      console.error('Search failed:', error);
    } finally {
      setSearching(false);
    }
  };

  const clearSearch = () => {
    setSearchQuery('');
    setSearchResults(null);
  };

  const deleteTranscript = async (id) => {
    if (!window.confirm('Delete this transcript?')) return;
    
    try {
      await transcriptAPI.delete(id);
      setTranscripts(prev => prev.filter(t => t._id !== id));
    } catch (error) {
      console.error('Failed to delete:', error);
    }
  };

  const formatDate = (date) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
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
      <h2 style={{ marginBottom: '24px' }}>📜 History</h2>

      {/* Search */}
      <form onSubmit={handleSearch} style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', gap: '12px' }}>
          <input
            type="text"
            className="input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search your transcripts..."
            style={{ flex: 1 }}
          />
          <button 
            type="submit" 
            className="btn btn-primary"
            disabled={searching}
          >
            {searching ? <div className="spinner" style={{ width: '20px', height: '20px' }} /> : '🔍'}
          </button>
        </div>
      </form>

      {/* Search Results */}
      {searchResults && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 className="card-title" style={{ margin: 0 }}>
              Search Results ({searchResults.length})
            </h3>
            <button 
              onClick={clearSearch}
              style={{ 
                background: 'none', 
                border: 'none', 
                color: 'var(--text-secondary)',
                cursor: 'pointer'
              }}
            >
              Clear
            </button>
          </div>
          {searchResults.length > 0 ? (
            searchResults.map((result, i) => (
              <div key={i} style={{
                background: 'var(--bg-tertiary)',
                padding: '12px',
                borderRadius: '8px',
                marginBottom: '8px'
              }}>
                <p style={{ fontSize: '14px', marginBottom: '8px' }}>{result.content}</p>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                  Similarity: {(result.score * 100).toFixed(1)}%
                </p>
              </div>
            ))
          ) : (
            <p style={{ color: 'var(--text-secondary)' }}>No results found</p>
          )}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        {['recent', 'topics', 'sessions'].map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`btn ${activeTab === tab ? 'btn-primary' : 'btn-secondary'}`}
            style={{ flex: 1, padding: '10px' }}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Recent Transcripts */}
      {activeTab === 'recent' && (
        <div>
          {transcripts.length > 0 ? (
            transcripts.map((t) => (
              <div key={t._id} className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                    {formatDate(t.timestamps?.recordedAt || t.createdAt)}
                  </span>
                  <button
                    onClick={() => deleteTranscript(t._id)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--error)',
                      cursor: 'pointer',
                      fontSize: '12px'
                    }}
                  >
                    Delete
                  </button>
                </div>
                <p style={{ fontSize: '14px', lineHeight: '1.6' }}>{t.content}</p>
                {t.analysis?.topics?.length > 0 && (
                  <div style={{ marginTop: '12px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {t.analysis.topics.map((topic, i) => (
                      <span key={i} style={{
                        background: 'var(--bg-tertiary)',
                        padding: '4px 8px',
                        borderRadius: '12px',
                        fontSize: '11px',
                        color: 'var(--text-secondary)'
                      }}>
                        {topic}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))
          ) : (
            <div className="card" style={{ textAlign: 'center' }}>
              <p style={{ color: 'var(--text-secondary)' }}>No transcripts yet</p>
            </div>
          )}
        </div>
      )}

      {/* Topics */}
      {activeTab === 'topics' && (
        <div className="card">
          <h3 className="card-title">Topics Discussed</h3>
          {topics.length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {topics.map((t, i) => (
                <span key={i} style={{
                  background: 'var(--bg-tertiary)',
                  padding: '8px 14px',
                  borderRadius: '20px',
                  fontSize: '13px'
                }}>
                  {t._id} <span style={{ color: 'var(--text-secondary)' }}>({t.count})</span>
                </span>
              ))}
            </div>
          ) : (
            <p style={{ color: 'var(--text-secondary)' }}>No topics yet</p>
          )}
        </div>
      )}

      {/* Sessions */}
      {activeTab === 'sessions' && (
        <div>
          {sessions.length > 0 ? (
            sessions.map((s, i) => (
              <div key={i} className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <p style={{ fontWeight: '600', marginBottom: '4px' }}>
                      Session {sessions.length - i}
                    </p>
                    <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                      {formatDate(s.startTime)}
                    </p>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <p style={{ fontSize: '14px' }}>{s.transcriptCount} transcripts</p>
                    <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                      {(s.totalConfidence * 100).toFixed(0)}% avg confidence
                    </p>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="card" style={{ textAlign: 'center' }}>
              <p style={{ color: 'var(--text-secondary)' }}>No sessions yet</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default History;
