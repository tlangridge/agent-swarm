import { useState } from 'react';
import ApiKeyManager from './ApiKeyManager';

interface SettingsDialogProps {
  dockerAvailable: boolean;
  dockerImageBuilt: boolean;
  onBuildDockerImage: () => Promise<void>;
  onClose: () => void;
}

export default function SettingsDialog({ dockerAvailable, dockerImageBuilt, onBuildDockerImage, onClose }: SettingsDialogProps) {
  const [building, setBuilding] = useState(false);

  const handleBuild = async () => {
    setBuilding(true);
    await onBuildDockerImage();
    setBuilding(false);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal settings-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Settings</h2>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>

        <div className="modal-body">
          <div className="settings-section">
            <div className="settings-section-title">API Keys</div>
            <p className="settings-description">
              Global defaults &mdash; used by all offices unless overridden.
            </p>
            <ApiKeyManager scope="global" />
          </div>

          <div className="settings-section">
            <div className="settings-section-title">Docker Sandbox</div>

            {!dockerAvailable ? (
              <>
                <div className="settings-docker-status">
                  <span className="settings-status-dot settings-status-unavailable" />
                  <span>Docker not detected</span>
                </div>
                <p className="settings-description">
                  Docker enables running agents in isolated containers. Install Docker to use sandbox mode:
                </p>
                <div className="settings-install-options">
                  <a href="https://www.docker.com/products/docker-desktop/" target="_blank" rel="noopener noreferrer" className="text-btn">
                    Docker Desktop
                  </a>
                  <span className="settings-install-divider">or</span>
                  <code className="settings-code">brew install --cask docker</code>
                </div>
              </>
            ) : !dockerImageBuilt && !building ? (
              <>
                <div className="settings-docker-status">
                  <span className="settings-status-dot settings-status-pending" />
                  <span>Image not built</span>
                </div>
                <p className="settings-description">
                  The sandbox image must be built before agents can run in Docker mode. This is a one-time setup that takes a few minutes.
                </p>
                <button className="primary-btn" onClick={handleBuild}>
                  Build Image
                </button>
              </>
            ) : building ? (
              <>
                <div className="settings-docker-status">
                  <span className="settings-status-dot settings-status-pending" />
                  <span>Building...</span>
                </div>
                <div className="warning-text" style={{ marginTop: 0 }}>
                  Building Docker image... (this may take a few minutes, check terminal for progress)
                </div>
              </>
            ) : (
              <>
                <div className="settings-docker-status">
                  <span className="settings-status-dot settings-status-ready" />
                  <span>Docker ready</span>
                </div>
                <p className="settings-description">
                  Rebuild when CLI tools release updates (e.g., new Claude Code version). Your login sessions, config, and workspace files are preserved.
                </p>
                <button className="secondary-btn" onClick={handleBuild}>
                  Rebuild Image
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
