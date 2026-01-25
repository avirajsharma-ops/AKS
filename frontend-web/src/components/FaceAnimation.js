import React from 'react';

const FaceAnimation = () => {
  return (
    <iframe
      src="/Face.html"
      title="Face Animation"
      style={{
        width: '100vw',
        height: '100vh',
        border: 'none',
        display: 'block',
        overflow: 'hidden',
        position: 'absolute',
        top: 0,
        left: 0
      }}
      allow="camera"
    />
  );
};

export default FaceAnimation;
