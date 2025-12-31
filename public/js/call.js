// ============================================
// Voice Bridge - Call Handler
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    // Elements
    const statusIndicator = document.getElementById('statusIndicator');
    const statusText = document.getElementById('statusText');
    const channelName = document.getElementById('channelName');
    const guildName = document.getElementById('guildName');
    const visualizer = document.getElementById('visualizer');
    const speakingIndicator = document.getElementById('speakingIndicator');
    const volumeSlider = document.getElementById('volumeSlider');
    const volumeValue = document.getElementById('volumeValue');
    const muteBtn = document.getElementById('muteBtn');
    const disconnectBtn = document.getElementById('disconnectBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const instructions = document.getElementById('instructions');
    const audioPlayer = document.getElementById('audioPlayer');

    // State
    let socket = null;
    let audioContext = null;
    let mediaStream = null;
    let audioProcessor = null;
    let isMuted = false;
    let isConnectedToChannel = false;

    // Check authentication first
    checkAuth();

    // ============================================
    // Authentication
    // ============================================

    async function checkAuth() {
        try {
            const response = await fetch('/api/check-auth');
            const data = await response.json();

            if (!data.authenticated) {
                window.location.href = '/';
                return;
            }

            // Initialize socket connection
            initSocket();
        } catch (error) {
            console.error('Auth check error:', error);
            window.location.href = '/';
        }
    }

    // ============================================
    // Socket.io Connection
    // ============================================

    function initSocket() {
        socket = io();

        socket.on('connect', () => {
            console.log('Connected to server');
            updateStatus('connecting', 'Connecting...');
        });

        socket.on('disconnect', () => {
            console.log('Disconnected from server');
            updateStatus('disconnected', 'Disconnected');
            isConnectedToChannel = false;
        });

        socket.on('error', (data) => {
            console.error('Socket error:', data.message);
            if (data.message === 'Not authenticated') {
                window.location.href = '/';
            }
        });

        socket.on('status', (data) => {
            console.log('Status update:', data);

            if (data.connected) {
                isConnectedToChannel = true;
                updateStatus('connected', 'Connected');
                channelName.textContent = data.channelName || 'Voice Channel';
                guildName.textContent = data.guildName || 'Discord Server';
                instructions.classList.add('hidden');

                // Start audio capture
                startAudioCapture();
            } else {
                isConnectedToChannel = false;
                updateStatus('disconnected', 'Not in channel');
                channelName.textContent = 'Waiting for connection...';
                guildName.textContent = 'Ask someone to ping the bot in Discord';
                instructions.classList.remove('hidden');

                // Stop audio capture
                stopAudioCapture();
            }
        });

        // Handle incoming audio from Discord
        socket.on('audio-in', (audioData) => {
            playIncomingAudio(audioData);
        });
    }

    // ============================================
    // Status Updates
    // ============================================

    function updateStatus(status, text) {
        statusIndicator.className = 'status-indicator ' + status;
        statusText.textContent = text;
    }

    // ============================================
    // Audio Capture (Browser -> Discord)
    // ============================================

    async function startAudioCapture() {
        if (mediaStream) return; // Already capturing

        try {
            // Request microphone access
            mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    sampleRate: 48000,
                    channelCount: 2
                },
                video: false
            });

            // Create audio context
            audioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: 48000
            });

            const source = audioContext.createMediaStreamSource(mediaStream);

            // Create script processor for capturing audio data
            audioProcessor = audioContext.createScriptProcessor(4096, 2, 2);

            let isSpeaking = false;
            let silenceTimeout = null;

            audioProcessor.onaudioprocess = (e) => {
                if (isMuted || !isConnectedToChannel) return;

                // Get audio data from both channels
                const leftChannel = e.inputBuffer.getChannelData(0);
                const rightChannel = e.inputBuffer.getChannelData(1);

                // Check if speaking (simple volume threshold)
                const volume = getAverageVolume(leftChannel);

                if (volume > 0.01) {
                    if (!isSpeaking) {
                        isSpeaking = true;
                        visualizer.classList.add('active');
                        speakingIndicator.classList.add('visible');
                    }

                    clearTimeout(silenceTimeout);
                    silenceTimeout = setTimeout(() => {
                        isSpeaking = false;
                        visualizer.classList.remove('active');
                        speakingIndicator.classList.remove('visible');
                    }, 300);

                    // Interleave stereo channels
                    const interleaved = interleave(leftChannel, rightChannel);

                    // Convert to 16-bit PCM
                    const pcm16 = floatTo16BitPCM(interleaved);

                    // Send to server
                    const base64Audio = arrayBufferToBase64(pcm16.buffer);
                    socket.emit('audio-out', base64Audio);
                }
            };

            // Connect the audio nodes
            source.connect(audioProcessor);
            audioProcessor.connect(audioContext.destination);

            console.log('Audio capture started');

        } catch (error) {
            console.error('Error starting audio capture:', error);
            alert('Could not access microphone. Please allow microphone access and refresh the page.');
        }
    }

    function stopAudioCapture() {
        if (audioProcessor) {
            audioProcessor.disconnect();
            audioProcessor = null;
        }

        if (audioContext) {
            audioContext.close();
            audioContext = null;
        }

        if (mediaStream) {
            mediaStream.getTracks().forEach(track => track.stop());
            mediaStream = null;
        }

        visualizer.classList.remove('active');
        speakingIndicator.classList.remove('visible');

        console.log('Audio capture stopped');
    }

    // ============================================
    // Audio Playback (Discord -> Browser)
    // ============================================

    let playbackContext = null;
    let gainNode = null;

    function initPlaybackContext() {
        if (!playbackContext) {
            playbackContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: 48000
            });
            gainNode = playbackContext.createGain();
            gainNode.connect(playbackContext.destination);
            gainNode.gain.value = volumeSlider.value / 100;
        }
    }

    function playIncomingAudio(base64Audio) {
        initPlaybackContext();

        try {
            // Decode base64 to ArrayBuffer
            const audioData = base64ToArrayBuffer(base64Audio);

            // Convert 16-bit PCM to float
            const pcm16 = new Int16Array(audioData);
            const floatData = new Float32Array(pcm16.length);

            for (let i = 0; i < pcm16.length; i++) {
                floatData[i] = pcm16[i] / 32768;
            }

            // Create audio buffer (stereo)
            const audioBuffer = playbackContext.createBuffer(2, floatData.length / 2, 48000);

            // Deinterleave stereo channels
            const leftChannel = audioBuffer.getChannelData(0);
            const rightChannel = audioBuffer.getChannelData(1);

            for (let i = 0; i < floatData.length / 2; i++) {
                leftChannel[i] = floatData[i * 2];
                rightChannel[i] = floatData[i * 2 + 1];
            }

            // Play the buffer
            const source = playbackContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(gainNode);
            source.start();

        } catch (error) {
            console.error('Error playing audio:', error);
        }
    }

    // ============================================
    // Audio Utilities
    // ============================================

    function getAverageVolume(array) {
        let sum = 0;
        for (let i = 0; i < array.length; i++) {
            sum += Math.abs(array[i]);
        }
        return sum / array.length;
    }

    function interleave(leftChannel, rightChannel) {
        const length = leftChannel.length + rightChannel.length;
        const result = new Float32Array(length);

        let index = 0;
        for (let i = 0; i < leftChannel.length; i++) {
            result[index++] = leftChannel[i];
            result[index++] = rightChannel[i];
        }

        return result;
    }

    function floatTo16BitPCM(input) {
        const output = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) {
            const s = Math.max(-1, Math.min(1, input[i]));
            output[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        return output;
    }

    function arrayBufferToBase64(buffer) {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }

    function base64ToArrayBuffer(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes.buffer;
    }

    // ============================================
    // Control Handlers
    // ============================================

    // Mute button
    muteBtn.addEventListener('click', () => {
        isMuted = !isMuted;
        muteBtn.classList.toggle('muted', isMuted);
        muteBtn.querySelector('.btn-label').textContent = isMuted ? 'Unmute' : 'Mute';

        if (socket) {
            socket.emit('mute', isMuted);
        }

        if (isMuted) {
            visualizer.classList.remove('active');
            speakingIndicator.classList.remove('visible');
        }
    });

    // Disconnect button
    disconnectBtn.addEventListener('click', () => {
        if (socket && isConnectedToChannel) {
            socket.emit('leave-voice');
        }
    });

    // Logout button
    logoutBtn.addEventListener('click', async () => {
        stopAudioCapture();

        if (socket) {
            socket.disconnect();
        }

        try {
            await fetch('/api/logout', { method: 'POST' });
        } catch (error) {
            console.error('Logout error:', error);
        }

        window.location.href = '/';
    });

    // Volume slider
    volumeSlider.addEventListener('input', () => {
        const value = volumeSlider.value;
        volumeValue.textContent = value + '%';

        if (gainNode) {
            gainNode.gain.value = value / 100;
        }
    });

    // Handle page unload
    window.addEventListener('beforeunload', () => {
        stopAudioCapture();
        if (socket) {
            socket.disconnect();
        }
    });
});
