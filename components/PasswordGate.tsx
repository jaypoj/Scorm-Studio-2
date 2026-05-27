import React, { useState } from 'react';
import { LockKeyhole } from 'lucide-react';

const PASSWORD_HASH = '8a46d27734df62c17e5fcf8097160174b14f1ccd8181e4b8ae7c45d4398a7243';

const sha256 = async (value: string) => {
  const bytes = new TextEncoder().encode(value);
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hashBuffer)).map(byte => byte.toString(16).padStart(2, '0')).join('');
};

interface PasswordGateProps {
  onUnlock: () => void;
}

export const PasswordGate: React.FC<PasswordGateProps> = ({ onUnlock }) => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isChecking, setIsChecking] = useState(false);

  const unlock = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsChecking(true);
    setError('');
    try {
      if (await sha256(password) === PASSWORD_HASH) {
        sessionStorage.setItem('scorm_studio_unlocked', 'true');
        onUnlock();
        return;
      }
      setError('Incorrect password.');
      setPassword('');
    } finally {
      setIsChecking(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
      <form onSubmit={unlock} className="w-full max-w-sm bg-white text-slate-900 border border-slate-200 rounded-lg shadow-2xl p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded bg-blue-600 text-white flex items-center justify-center">
            <LockKeyhole className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-bold text-lg">SCORM Studio</h1>
            <p className="text-xs text-slate-500">Private project workspace</p>
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase text-slate-500 mb-1">Password</label>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full p-3 bg-white border border-slate-300 rounded text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            autoFocus
          />
          {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
        </div>
        <button
          type="submit"
          disabled={isChecking || !password}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-3 rounded"
        >
          {isChecking ? 'Checking...' : 'Unlock'}
        </button>
        <p className="text-[11px] text-slate-500 leading-relaxed">
          This gate limits casual access on GitHub Pages. Runtime API keys are entered after unlock and stored only in this browser.
        </p>
      </form>
    </div>
  );
};
