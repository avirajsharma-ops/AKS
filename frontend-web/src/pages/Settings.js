import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { userAPI, profileAPI } from '../services/api';

function Settings() {
  const { user, updatePermissions, logout } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      const response = await userAPI.getStats();
      setStats(response.data);
    } catch (error) {
      console.error('Failed to load stats:', error);
    }
  };

  const handlePermissionToggle = async (permission) => {
    setLoading(true);
    try {
      await updatePermissions({
        [permission]: !user.permissions[permission]
      });
    } catch (error) {
      console.error('Failed to update permission:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const handleExportData = async () => {
    try {
      const response = await userAPI.exportData();
      const blob = new Blob([JSON.stringify(response.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `aks-data-export-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to export data:', error);
    }
  };

  const handleResetProfile = async () => {
    if (!window.confirm('This will delete all learned data. Are you sure?')) return;
    
    try {
      await profileAPI.reset();
      alert('Profile reset successfully');
    } catch (error) {
      console.error('Failed to reset profile:', error);
    }
  };

  const handleDeleteAccount = async () => {
    try {
      await userAPI.deleteAccount();
      await logout();
      navigate('/login');
    } catch (error) {
      console.error('Failed to delete account:', error);
    }
  };

  return (
    <div>
      <h2 style={{ marginBottom: '24px' }}>⚙️ Settings</h2>

      {/* Account Info */}
      <div className="card">
        <h3 className="card-title">Account</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div className="profile-avatar" style={{ width: '50px', height: '50px', fontSize: '20px' }}>
            {user?.name?.charAt(0).toUpperCase() || '?'}
          </div>
          <div>
            <p style={{ fontWeight: '600' }}>{user?.name}</p>
            <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>{user?.email}</p>
          </div>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="card">
          <h3 className="card-title">Statistics</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <p style={{ fontSize: '24px', fontWeight: '700' }}>{stats.stats?.totalTranscripts || 0}</p>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Transcripts</p>
            </div>
            <div>
              <p style={{ fontSize: '24px', fontWeight: '700' }}>{stats.profileCompleteness || 0}%</p>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Profile Complete</p>
            </div>
            <div>
              <p style={{ fontSize: '24px', fontWeight: '700' }}>{stats.dataPoints || 0}</p>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Data Points</p>
            </div>
            <div>
              <p style={{ fontSize: '24px', fontWeight: '700' }}>
                {stats.memberSince ? new Date(stats.memberSince).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '-'}
              </p>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Member Since</p>
            </div>
          </div>
        </div>
      )}

      {/* Privacy Settings */}
      <div className="card">
        <h3 className="card-title">Privacy & Permissions</h3>
        
        <div className="toggle-container">
          <div className="toggle-label">
            <span className="toggle-title">Background Listening</span>
            <span className="toggle-desc">Allow AKS to listen when app is open</span>
          </div>
          <label className="toggle">
            <input
              type="checkbox"
              checked={user?.permissions?.backgroundListening || false}
              onChange={() => handlePermissionToggle('backgroundListening')}
              disabled={loading}
            />
            <span className="toggle-slider"></span>
          </label>
        </div>

        <div className="toggle-container">
          <div className="toggle-label">
            <span className="toggle-title">Data Collection</span>
            <span className="toggle-desc">Store transcripts to build your profile</span>
          </div>
          <label className="toggle">
            <input
              type="checkbox"
              checked={user?.permissions?.dataCollection || false}
              onChange={() => handlePermissionToggle('dataCollection')}
              disabled={loading}
            />
            <span className="toggle-slider"></span>
          </label>
        </div>

        <div className="toggle-container">
          <div className="toggle-label">
            <span className="toggle-title">Voice Cloning</span>
            <span className="toggle-desc">Create AI voice from your samples</span>
          </div>
          <label className="toggle">
            <input
              type="checkbox"
              checked={user?.permissions?.voiceCloning || false}
              onChange={() => handlePermissionToggle('voiceCloning')}
              disabled={loading}
            />
            <span className="toggle-slider"></span>
          </label>
        </div>

        <div className="toggle-container" style={{ borderBottom: 'none' }}>
          <div className="toggle-label">
            <span className="toggle-title">Analytics</span>
            <span className="toggle-desc">Share anonymous usage data</span>
          </div>
          <label className="toggle">
            <input
              type="checkbox"
              checked={user?.permissions?.shareAnalytics || false}
              onChange={() => handlePermissionToggle('shareAnalytics')}
              disabled={loading}
            />
            <span className="toggle-slider"></span>
          </label>
        </div>
      </div>

      {/* Data Management */}
      <div className="card">
        <h3 className="card-title">Data Management</h3>
        
        <button 
          className="btn btn-secondary" 
          style={{ width: '100%', marginBottom: '12px' }}
          onClick={handleExportData}
        >
          📥 Export My Data
        </button>

        <button 
          className="btn btn-secondary" 
          style={{ width: '100%', marginBottom: '12px' }}
          onClick={handleResetProfile}
        >
          🔄 Reset Profile
        </button>

        <button 
          className="btn btn-danger" 
          style={{ width: '100%' }}
          onClick={() => setShowDeleteConfirm(true)}
        >
          🗑️ Delete Account
        </button>
      </div>

      {/* Logout */}
      <button 
        className="btn btn-secondary" 
        style={{ width: '100%', marginTop: '16px' }}
        onClick={handleLogout}
      >
        Sign Out
      </button>

      {/* Delete confirmation modal */}
      {showDeleteConfirm && (
        <div className="modal-overlay">
          <div className="modal">
            <h2 className="modal-title">Delete Account?</h2>
            <p className="modal-text">
              This will permanently delete your account and all associated data. This action cannot be undone.
            </p>
            <div className="modal-actions">
              <button 
                className="btn btn-secondary"
                onClick={() => setShowDeleteConfirm(false)}
              >
                Cancel
              </button>
              <button 
                className="btn btn-danger"
                onClick={handleDeleteAccount}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Version */}
      <p style={{ 
        textAlign: 'center', 
        color: 'var(--text-secondary)', 
        fontSize: '12px',
        marginTop: '24px'
      }}>
        AKS v1.0.0
      </p>
    </div>
  );
}

export default Settings;
