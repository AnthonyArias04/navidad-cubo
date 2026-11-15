const socket = io();

const PLACEHOLDER_IMG = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"><rect width="400" height="400" fill="%23142821"/><text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" font-size="120" fill="%23f5c451">🎄</text></svg>';

const portadaEl = document.getElementById('tv-portada');
const cancionEl = document.getElementById('tv-cancion');
const artistaEl = document.getElementById('tv-artista');

const bloquePedidoEl = document.getElementById('tv-bloque-pedido');
const usuarioEl = document.getElementById('tv-usuario');
const notaEl = document.getElementById('tv-nota');

const bloqueAmbienteEl = document.getElementById('tv-bloque-ambiente');

portadaEl.src = PLACEHOLDER_IMG;

socket.on('estado_actualizado', ({ actual }) => {
    if (!actual || !actual.cancion) {
        portadaEl.src = PLACEHOLDER_IMG;
        cancionEl.textContent = 'Ambiente Navideño';
        artistaEl.textContent = 'Escanea el QR del mural para pedir tu canción';
        bloquePedidoEl.hidden = true;
        bloqueAmbienteEl.hidden = false;
        return;
    }

    // Actualiza datos de la pista
    portadaEl.src = actual.cancion.imagen || PLACEHOLDER_IMG;
    cancionEl.textContent = actual.cancion.nombre;
    artistaEl.textContent = actual.cancion.artista;

    // Alterna entre plantilla de Pedido y plantilla de Feliz Navidad
    if (actual.modo === 'pedido') {
        bloquePedidoEl.hidden = false;
        bloqueAmbienteEl.hidden = true;

        usuarioEl.textContent = actual.nombre;
        notaEl.textContent = actual.nota ? `"${actual.nota}"` : '';
    } else {
        bloquePedidoEl.hidden = true;
        bloqueAmbienteEl.hidden = false;

        usuarioEl.textContent = '';
        notaEl.textContent = '';
    }
});