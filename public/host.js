const params = new URLSearchParams(window.location.search);
const hostPassword = params.get('key') || '';

// Conectar Socket.io enviando la contraseña del Host
const socket = io({
    auth: { password: hostPassword }
});

// Mantener despierto el servidor gratuito cada 5 minutos
setInterval(() => {
    fetch('/ping').catch(() => {});
}, 5 * 60 * 1000);

const PLACEHOLDER_IMG = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"><rect width="200" height="200" fill="%23142821"/><text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" font-size="64" fill="%23f5c451">♫</text></svg>';

// Elementos del DOM
const estadoAuthEl = document.getElementById('host-estado-auth');
const seccionLoginEl = document.getElementById('host-seccion-login');
const seccionControlesEl = document.getElementById('host-seccion-controles');
const btnIniciar = document.getElementById('btn-iniciar');
const btnSiguiente = document.getElementById('btn-siguiente');
const alertaErrorEl = document.getElementById('host-alerta-error');

const modoActualEl = document.getElementById('host-modo-actual');
const portadaEl = document.getElementById('host-portada');
const cancionEl = document.getElementById('host-cancion');
const artistaEl = document.getElementById('host-artista');
const detalleUsuarioEl = document.getElementById('host-detalle-usuario');

const contadorColaEl = document.getElementById('host-contador-cola');
const listaColaEl = document.getElementById('host-lista-cola');

portadaEl.src = PLACEHOLDER_IMG;

// Controles manuales
btnIniciar.addEventListener('click', () => {
    alertaErrorEl.textContent = '';
    socket.emit('host_iniciar');
});

btnSiguiente.addEventListener('click', () => {
    alertaErrorEl.textContent = '';
    socket.emit('host_siguiente');
});

// Escucha actualizaciones del servidor en tiempo real
socket.on('estado_actualizado', ({ autenticado, actual, cola }) => {
    // 1. Estado de sesión con Spotify
    if (autenticado) {
        estadoAuthEl.textContent = 'Conectado';
        estadoAuthEl.style.color = '#1db954';
        seccionLoginEl.hidden = true;
        seccionControlesEl.hidden = false;
    } else {
        estadoAuthEl.textContent = 'Desconectado';
        estadoAuthEl.style.color = '#ef4444';
        seccionLoginEl.hidden = false;
        seccionControlesEl.hidden = true;
    }

    // 2. Monitor de lo que está sonando
    if (actual && actual.cancion) {
        alertaErrorEl.textContent = '';
        portadaEl.src = actual.cancion.imagen || PLACEHOLDER_IMG;
        cancionEl.textContent = actual.cancion.nombre;
        artistaEl.textContent = actual.cancion.artista;

        if (actual.modo === 'pedido') {
            modoActualEl.textContent = 'Petición de Visitante';
            detalleUsuarioEl.textContent = actual.nota
                ? `Pedida por: ${actual.nombre} — "${actual.nota}"`
                : `Pedida por: ${actual.nombre}`;
        } else {
            modoActualEl.textContent = 'Modo Ambiente Navideño';
            detalleUsuarioEl.textContent = 'Reproducción automática aleatoria';
        }
    } else {
        modoActualEl.textContent = 'Detenido';
        portadaEl.src = PLACEHOLDER_IMG;
        cancionEl.textContent = 'Ninguna pista activa';
        artistaEl.textContent = '';
        detalleUsuarioEl.textContent = '';
    }

    // 3. Renderizado de la cola de espera
    contadorColaEl.textContent = cola.length;
    listaColaEl.innerHTML = '';

    if (cola.length === 0) {
        const vacio = document.createElement('p');
        vacio.textContent = 'No hay peticiones en espera.';
        vacio.style.color = '#94a3b8';
        listaColaEl.appendChild(vacio);
        return;
    }

    cola.forEach((item) => {
        const li = document.createElement('li');
        const infoCancion = document.createElement('strong');
        infoCancion.textContent = `${item.cancion.nombre} - ${item.cancion.artista}`;

        const infoUsuario = document.createElement('div');
        infoUsuario.textContent = item.nota
            ? `Por: ${item.nombre} | Nota: "${item.nota}"`
            : `Por: ${item.nombre}`;

        li.appendChild(infoCancion);
        li.appendChild(infoUsuario);
        listaColaEl.appendChild(li);
    });
});

// Muestra errores de Spotify (ej. si la app de escritorio no está abierta)
socket.on('error_host', (mensaje) => {
    alertaErrorEl.textContent = mensaje;
});