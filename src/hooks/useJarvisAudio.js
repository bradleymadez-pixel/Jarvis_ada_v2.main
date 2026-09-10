import { useEffect, useRef } from 'react';

// Gemini expects 16-bit PCM, mono, 16kHz for input.
const SEND_SAMPLE_RATE = 16000;
// Jarvis's voice audio arrives as 16-bit PCM, mono, 24kHz.
const RECEIVE_SAMPLE_RATE = 24000;
// ~100ms per chunk sent to the backend - a good balance of latency vs.
// socket overhead.
const CAPTURE_CHUNK_SAMPLES = 1600; // at 16kHz, 1600 samples = 100ms

function floatTo16BitPCM(float32Array) {
    const buffer = new ArrayBuffer(float32Array.length * 2);
    const view = new DataView(buffer);
    for (let i = 0; i < float32Array.length; i++) {
        const s = Math.max(-1, Math.min(1, float32Array[i]));
        view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); // little-endian
    }
    return buffer;
}

function downsampleBuffer(buffer, inputSampleRate, outputSampleRate) {
    if (outputSampleRate === inputSampleRate) return buffer;
    const ratio = inputSampleRate / outputSampleRate;
    const newLength = Math.round(buffer.length / ratio);
    const result = new Float32Array(newLength);
    let offsetResult = 0;
    let offsetBuffer = 0;
    while (offsetResult < newLength) {
        const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
        let accum = 0, count = 0;
        for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
            accum += buffer[i];
            count++;
        }
        result[offsetResult] = count > 0 ? accum / count : 0;
        offsetResult++;
        offsetBuffer = nextOffsetBuffer;
    }
    return result;
}

function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}

/**
 * Handles browser-side mic capture (sent to the backend as raw PCM) and
 * browser-side playback of Jarvis's voice (received as raw PCM), for use
 * when the backend is running in HOSTED_MODE (a cloud server with no local
 * mic/camera/speakers of its own).
 *
 * In local/Electron mode (HOSTED_MODE=false), the backend already has real
 * hardware access, so this hook stays fully inactive.
 */
export default function useJarvisAudio({ socket, isHostedMode, isMuted, isConnected }) {
    const captureCtxRef = useRef(null);
    const captureStreamRef = useRef(null);
    const processorRef = useRef(null);
    const sourceRef = useRef(null);
    const pcmBufferRef = useRef([]); // accumulates downsampled samples until we have a full chunk

    const playbackCtxRef = useRef(null);
    const nextPlayTimeRef = useRef(0);

    // --- Mic capture: browser -> backend ---
    useEffect(() => {
        if (!isHostedMode || !isConnected || isMuted) {
            // Tear down any active capture
            if (processorRef.current) {
                processorRef.current.disconnect();
                processorRef.current = null;
            }
            if (sourceRef.current) {
                sourceRef.current.disconnect();
                sourceRef.current = null;
            }
            if (captureStreamRef.current) {
                captureStreamRef.current.getTracks().forEach((t) => t.stop());
                captureStreamRef.current = null;
            }
            return;
        }

        let cancelled = false;

        (async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        channelCount: 1,
                        echoCancellation: true,
                        noiseSuppression: true,
                    },
                });
                if (cancelled) {
                    stream.getTracks().forEach((t) => t.stop());
                    return;
                }
                captureStreamRef.current = stream;

                const ctx = new (window.AudioContext || window.webkitAudioContext)();
                captureCtxRef.current = ctx;
                const source = ctx.createMediaStreamSource(stream);
                sourceRef.current = source;

                // ScriptProcessorNode is deprecated but universally supported
                // and simple - fine for this use case. (Could upgrade to an
                // AudioWorklet later for lower latency.)
                const processor = ctx.createScriptProcessor(4096, 1, 1);
                processorRef.current = processor;
                pcmBufferRef.current = [];

                processor.onaudioprocess = (e) => {
                    const input = e.inputBuffer.getChannelData(0);
                    const downsampled = downsampleBuffer(input, ctx.sampleRate, SEND_SAMPLE_RATE);

                    // Accumulate into our rolling buffer
                    const combined = new Float32Array(pcmBufferRef.current.length + downsampled.length);
                    combined.set(pcmBufferRef.current, 0);
                    combined.set(downsampled, pcmBufferRef.current.length);

                    let offset = 0;
                    while (combined.length - offset >= CAPTURE_CHUNK_SAMPLES) {
                        const chunk = combined.slice(offset, offset + CAPTURE_CHUNK_SAMPLES);
                        const pcm16 = floatTo16BitPCM(chunk);
                        socket.emit('mic_audio_chunk', { audio: arrayBufferToBase64(pcm16) });
                        offset += CAPTURE_CHUNK_SAMPLES;
                    }
                    pcmBufferRef.current = combined.slice(offset);
                };

                source.connect(processor);
                processor.connect(ctx.destination); // required by some browsers to keep the graph alive; produces silence
            } catch (err) {
                console.error('[Jarvis Audio] Mic capture failed:', err);
            }
        })();

        return () => {
            cancelled = true;
            if (processorRef.current) {
                processorRef.current.disconnect();
                processorRef.current = null;
            }
            if (sourceRef.current) {
                sourceRef.current.disconnect();
                sourceRef.current = null;
            }
            if (captureStreamRef.current) {
                captureStreamRef.current.getTracks().forEach((t) => t.stop());
                captureStreamRef.current = null;
            }
            if (captureCtxRef.current) {
                captureCtxRef.current.close();
                captureCtxRef.current = null;
            }
        };
    }, [isHostedMode, isConnected, isMuted, socket]);

    // --- Playback: backend -> browser speakers ---
    useEffect(() => {
        if (!isHostedMode) return;

        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        playbackCtxRef.current = ctx;
        nextPlayTimeRef.current = ctx.currentTime;

        const onAudioData = (data) => {
            const bytes = data?.data;
            if (!bytes || bytes.length === 0) return;

            // bytes is an array of ints representing raw 16-bit PCM (little-endian), mono, 24kHz
            const sampleCount = bytes.length / 2;
            const float32 = new Float32Array(sampleCount);
            for (let i = 0; i < sampleCount; i++) {
                const lo = bytes[i * 2];
                const hi = bytes[i * 2 + 1];
                let val = (hi << 8) | lo;
                if (val >= 0x8000) val -= 0x10000;
                float32[i] = val / 0x8000;
            }

            const audioBuffer = ctx.createBuffer(1, sampleCount, RECEIVE_SAMPLE_RATE);
            audioBuffer.copyToChannel(float32, 0);

            const source = ctx.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(ctx.destination);

            const now = ctx.currentTime;
            const startAt = Math.max(now, nextPlayTimeRef.current);
            source.start(startAt);
            nextPlayTimeRef.current = startAt + audioBuffer.duration;
        };

        socket.on('audio_data', onAudioData);
        return () => {
            socket.off('audio_data', onAudioData);
            ctx.close();
        };
    }, [isHostedMode, socket]);
}
