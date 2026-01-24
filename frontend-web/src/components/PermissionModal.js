import React from 'react';

function PermissionModal({ onAccept, onDecline }) {
  return (
    <div className="modal-overlay">
      <div className="modal">
        <div style={{ textAlign: 'center', marginBottom: '20px' }}>
          <span style={{ fontSize: '48px' }}>🎤</span>
        </div>
        
        <h2 className="modal-title">Enable Listening?</h2>
        
        <div className="modal-text">
          <p style={{ marginBottom: '16px' }}>
            To create your AI clone, AKS needs permission to:
          </p>
          
          <ul style={{ paddingLeft: '20px', marginBottom: '16px' }}>
            <li style={{ marginBottom: '8px' }}>
              <strong>Listen to your speech</strong> - To transcribe and learn from what you say
            </li>
            <li style={{ marginBottom: '8px' }}>
              <strong>Store your data</strong> - To build your personalized profile
            </li>
            <li>
              <strong>Run in background</strong> - For continuous learning (optional)
            </li>
          </ul>
          
          <p style={{ 
            fontSize: '13px', 
            background: 'var(--bg-tertiary)', 
            padding: '12px',
            borderRadius: '8px',
            marginTop: '16px'
          }}>
            <strong>Your privacy matters:</strong> All data is encrypted and only used to 
            personalize your experience. You can delete everything anytime.
          </p>
        </div>
        
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onDecline}>
            Not Now
          </button>
          <button className="btn btn-primary" onClick={onAccept}>
            Enable
          </button>
        </div>
      </div>
    </div>
  );
}

export default PermissionModal;
