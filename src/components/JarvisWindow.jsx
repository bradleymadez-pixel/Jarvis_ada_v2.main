import React, { useState, useEffect, useRef } from 'react';
import { X, Send, Play, Pause, SkipForward, SkipBack, Cloud, Camera, Cpu, Globe } from 'lucide-react';

// Very small keyword parser. Not AI - just pattern matching on the typed text,
// so these commands work even before you have a Gemini key set up.
function parseCommand(raw) {
    const text = raw.trim();
    const lower = text.toLowerCase();

    if (/\b(what'?s the |what is the |)time\b/.test(lower)) {
        return { event: 'get_time' };
    }
    if (/\b(what'?s the |what is the |today'?s |)date\b/.test(lower)) {
        return { event: 'get_date' };
    }
    if (/^(pause|stop)( music| song| spotify)?$/.test(lower)) {
        return { event: 'spotify_pause' };
    }
    if (/^(next|skip)( track| song)?$/.test(lower)) {
        return { event: 'spotify_next' };
    }
    if (/^(previous|back|last)( track| song)?$/.test(lower)) {
        return { event: 'spotify_previous' };
    }
    let m = lower.match(/^play\s+(.+)/);
    if (m) {
        return { event: 'spotify_play', data: { query: m[1] } };
    }
    m = lower.match(/weather(?:\s+(?:in|for|at))?\s+(.+)/);
    if (m) {
        return { event: 'get_weather', data: { location: m[1] } };
    }
    if (/screenshot/.test(lower)) {
        return { event: 'take_screenshot' };
    }
    if (/(system stats|cpu|ram|memory usage|disk usage)/.test(lower)) {
        return { event: 'get_system_stats' };
    }
    m = lower.match(/^(?:open|search|google)\s+(.+)/);
    if (m) {
        return { event: 'open_url', data: { query: m[1] } };
    }
    return null;
}

const JarvisWindow = ({
    socket,
    position,
    onClose,
    activeDragElement,
    setActiveDragElement,
    onMouseDown,
    zIndex = 40
}) => {
    const [input, setInput] = useState('');
    const [log, setLog] = useState([
        { type: 'system', text: 'Type a command, or use the buttons below.' }
    ]);
    const logEndRef = useRef(null);

    useEffect(() => {
        const addLog = (type) => (data) => {
            let text;
            if (type === 'error') text = data?.msg || 'Something went wrong.';
            else if (data?.msg) text = data.msg;
            else text = JSON.stringify(data);
            setLog((prev) => [...prev, { type, text }]);
        };

        const onStatus = addLog('status');
        const onError = addLog('error');
        const onWeather = (data) => {
            setLog((prev) => [...prev, {
                type: 'status',
                text: `${data.location}: ${data.temperature_f}°F, humidity ${data.humidity_pct}%, wind ${data.wind_mph}mph (H:${data.high_f}° L:${data.low_f}°)`
            }]);
        };
        const onSystemStats = (data) => {
            setLog((prev) => [...prev, {
                type: 'status',
                text: `CPU ${data.cpu_percent}% | RAM ${data.ram_percent}% (${data.ram_used_gb}/${data.ram_total_gb} GB) | Disk ${data.disk_percent}% (${data.disk_used_gb}/${data.disk_total_gb} GB)`
            }]);
        };
        const onScreenshot = (data) => {
            setLog((prev) => [...prev, { type: 'status', text: `Screenshot saved: ${data.path}` }]);
        };

        socket.on('status', onStatus);
        socket.on('error', onError);
        socket.on('weather_result', onWeather);
        socket.on('system_stats_result', onSystemStats);
        socket.on('screenshot_result', onScreenshot);

        return () => {
            socket.off('status', onStatus);
            socket.off('error', onError);
            socket.off('weather_result', onWeather);
            socket.off('system_stats_result', onSystemStats);
            socket.off('screenshot_result', onScreenshot);
        };
    }, [socket]);

    useEffect(() => {
        logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [log]);

    const runCommand = (raw) => {
        const parsed = parseCommand(raw);
        setLog((prev) => [...prev, { type: 'user', text: raw }]);
        if (!parsed) {
            setLog((prev) => [...prev, {
                type: 'error',
                text: "Didn't recognize that. Try: \"play [song]\", \"weather in [city]\", \"what time is it\", \"screenshot\", \"system stats\", \"open [site]\"."
            }]);
            return;
        }
        socket.emit(parsed.event, parsed.data);
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!input.trim()) return;
        runCommand(input);
        setInput('');
    };

    const quickAction = (event, data, label) => {
        setLog((prev) => [...prev, { type: 'user', text: label }]);
        socket.emit(event, data);
    };

    return (
        <div
            id="jarvis-basic"
            onMouseDown={onMouseDown}
            className={`absolute flex flex-col gap-2 p-4 rounded-xl backdrop-blur-md bg-black/60 border border-cyan-500/30 transition-all duration-200 select-none
                ${activeDragElement === 'jarvis-basic' ? 'ring-2 ring-cyan-400 shadow-[0_0_30px_rgba(34,211,238,0.3)]' : 'shadow-[0_0_20px_rgba(6,182,212,0.1)]'}
            `}
            style={{
                left: position.x,
                top: position.y,
                width: '360px',
                minHeight: '300px',
                transform: 'translate(-50%, -50%)',
                zIndex: zIndex
            }}
        >
            {/* Header */}
            <div data-drag-handle className="flex items-center justify-between pb-2 border-b border-white/10 mb-2 cursor-grab active:cursor-grabbing">
                <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                    <h3 className="font-bold text-cyan-400 tracking-wider text-sm">JARVIS BASICS</h3>
                </div>
                <button
                    onClick={onClose}
                    className="p-1 rounded hover:bg-white/10 transition-colors text-white/50 hover:text-white"
                >
                    <X size={16} />
                </button>
            </div>

            {/* Quick action buttons */}
            <div className="grid grid-cols-4 gap-2 pb-2 border-b border-white/10 mb-2">
                <button onClick={() => quickAction('spotify_play', {}, 'Resume')} title="Resume" className="flex flex-col items-center gap-1 p-2 rounded-lg bg-white/5 hover:bg-cyan-500/20 border border-white/10 hover:border-cyan-500/40 text-cyan-300 transition-all">
                    <Play size={16} /><span className="text-[9px]">Play</span>
                </button>
                <button onClick={() => quickAction('spotify_pause', {}, 'Pause')} title="Pause" className="flex flex-col items-center gap-1 p-2 rounded-lg bg-white/5 hover:bg-cyan-500/20 border border-white/10 hover:border-cyan-500/40 text-cyan-300 transition-all">
                    <Pause size={16} /><span className="text-[9px]">Pause</span>
                </button>
                <button onClick={() => quickAction('spotify_previous', {}, 'Previous track')} title="Previous" className="flex flex-col items-center gap-1 p-2 rounded-lg bg-white/5 hover:bg-cyan-500/20 border border-white/10 hover:border-cyan-500/40 text-cyan-300 transition-all">
                    <SkipBack size={16} /><span className="text-[9px]">Prev</span>
                </button>
                <button onClick={() => quickAction('spotify_next', {}, 'Next track')} title="Next" className="flex flex-col items-center gap-1 p-2 rounded-lg bg-white/5 hover:bg-cyan-500/20 border border-white/10 hover:border-cyan-500/40 text-cyan-300 transition-all">
                    <SkipForward size={16} /><span className="text-[9px]">Next</span>
                </button>
                <button onClick={() => quickAction('take_screenshot', {}, 'Take screenshot')} title="Screenshot" className="flex flex-col items-center gap-1 p-2 rounded-lg bg-white/5 hover:bg-cyan-500/20 border border-white/10 hover:border-cyan-500/40 text-cyan-300 transition-all">
                    <Camera size={16} /><span className="text-[9px]">Shot</span>
                </button>
                <button onClick={() => quickAction('get_system_stats', {}, 'System stats')} title="System Stats" className="flex flex-col items-center gap-1 p-2 rounded-lg bg-white/5 hover:bg-cyan-500/20 border border-white/10 hover:border-cyan-500/40 text-cyan-300 transition-all">
                    <Cpu size={16} /><span className="text-[9px]">Stats</span>
                </button>
                <button onClick={() => quickAction('get_weather', { location: 'current location' }, 'Weather')} title="Weather (edit location in chat)" className="flex flex-col items-center gap-1 p-2 rounded-lg bg-white/5 hover:bg-cyan-500/20 border border-white/10 hover:border-cyan-500/40 text-cyan-300 transition-all">
                    <Cloud size={16} /><span className="text-[9px]">Weather</span>
                </button>
                <button onClick={() => quickAction('open_url', { query: 'google.com' }, 'Open Google')} title="Open a site" className="flex flex-col items-center gap-1 p-2 rounded-lg bg-white/5 hover:bg-cyan-500/20 border border-white/10 hover:border-cyan-500/40 text-cyan-300 transition-all">
                    <Globe size={16} /><span className="text-[9px]">Open</span>
                </button>
            </div>

            {/* Log */}
            <div className="flex-1 overflow-y-auto max-h-[220px] scrollbar-hide flex flex-col gap-1.5 text-xs">
                {log.map((entry, i) => (
                    <div
                        key={i}
                        className={`px-2 py-1 rounded-lg max-w-[90%] ${
                            entry.type === 'user'
                                ? 'self-end bg-cyan-500/20 text-cyan-100'
                                : entry.type === 'error'
                                ? 'self-start bg-red-500/10 text-red-300 border border-red-500/20'
                                : 'self-start bg-white/5 text-white/70'
                        }`}
                    >
                        {entry.text}
                    </div>
                ))}
                <div ref={logEndRef} />
            </div>

            {/* Input */}
            <form onSubmit={handleSubmit} className="flex items-center gap-2 pt-2 border-t border-white/10 mt-2">
                <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder='Try: "play holiday", "weather in Perth"...'
                    className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder-white/30 focus:outline-none focus:border-cyan-500/50"
                />
                <button
                    type="submit"
                    className="p-2 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 transition-all"
                >
                    <Send size={14} />
                </button>
            </form>
        </div>
    );
};

export default JarvisWindow;
