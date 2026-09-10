import React, { useState } from 'react';
import { Lock, Unlock, KeyRound } from 'lucide-react';

/**
 * Password login for the hosted web app. Shown only when the backend
 * reports auth_required (HOSTED_MODE=true and AUTH_PASSWORD is set).
 * On success, calls onAuthenticated(token) so the parent can reconnect
 * the socket with that token attached.
 */
const PasswordLogin = ({ backendUrl, onAuthenticated }) => {
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isChecking, setIsChecking] = useState(false);
    const [isUnlocking, setIsUnlocking] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!password || isChecking) return;
        setIsChecking(true);
        setError('');
        try {
            const res = await fetch(`${backendUrl}/api/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password }),
            });
            const data = await res.json();
            if (data.success) {
                setIsUnlocking(true);
                setTimeout(() => onAuthenticated(data.token), 1500);
            } else {
                setError(data.error || 'Incorrect password');
                setIsChecking(false);
            }
        } catch (err) {
            setError('Could not reach Jarvis. Check your connection.');
            setIsChecking(false);
        }
    };

    const themeColor = isUnlocking ? 'text-green-500' : 'text-cyan-500';
    const borderColor = isUnlocking ? 'border-green-500' : 'border-cyan-500';
    const shadowColor = isUnlocking ? 'shadow-[0_0_50px_rgba(34,197,94,0.4)]' : 'shadow-[0_0_50px_rgba(34,211,238,0.2)]';
    const bgGradient = isUnlocking ? 'from-green-900/40 via-black to-black' : 'from-cyan-900/20 via-black to-black';

    return (
        <div className={`fixed inset-0 z-[9999] bg-black flex flex-col items-center justify-center font-mono select-none transition-all duration-[1500ms] ${isUnlocking ? 'opacity-0 scale-110 pointer-events-none' : 'opacity-100'}`}
            style={{ transitionDelay: isUnlocking ? '1000ms' : '0ms' }}>

            <div className={`absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] ${bgGradient} pointer-events-none transition-colors duration-[1500ms]`}></div>

            <form
                onSubmit={handleSubmit}
                className={`relative flex flex-col items-center gap-6 p-10 border ${borderColor}/30 rounded-lg bg-black/80 backdrop-blur-xl ${shadowColor} transition-all duration-[1500ms] w-[340px]`}
            >
                <div className={`text-2xl font-bold tracking-[0.3em] uppercase drop-shadow-[0_0_10px_currentColor] flex items-center gap-4 ${themeColor} transition-colors duration-1000`}>
                    {isUnlocking ? <Unlock size={28} /> : <Lock size={28} />}
                    JARVIS
                </div>

                <div className={`relative w-full flex items-center gap-2 border-2 ${borderColor}/50 rounded-lg bg-gray-900/60 px-3 py-2 transition-colors duration-500`}>
                    <KeyRound size={16} className={isUnlocking ? 'text-green-600' : 'text-cyan-600'} />
                    <input
                        type="password"
                        autoFocus
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        disabled={isChecking}
                        placeholder="Enter password"
                        className="flex-1 bg-transparent outline-none text-cyan-100 placeholder-cyan-800 text-sm tracking-wider"
                    />
                </div>

                {error && (
                    <div className="text-xs text-red-400 tracking-wide -mt-3">{error}</div>
                )}

                <button
                    type="submit"
                    disabled={isChecking || !password}
                    className={`w-full py-2 rounded-lg border ${borderColor}/50 text-sm tracking-widest uppercase transition-all
                        ${themeColor} hover:bg-cyan-500/10 disabled:opacity-40 disabled:cursor-not-allowed`}
                >
                    {isUnlocking ? 'Access Granted' : isChecking ? 'Verifying...' : 'Unlock'}
                </button>
            </form>
        </div>
    );
};

export default PasswordLogin;
