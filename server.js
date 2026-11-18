require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const spotify = require('./spotify');
const { limpiarTexto } = require('./filtro');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = parseInt(process.env.PORT, 10) || 3000;
const PLAYLIST_ID = process.env.SPOTIFY_PLAYLIST_ID || '';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- ESTADO GLOBAL EN MEMORIA ---
let colaPedidos = [];           // Lista de espera de los usuarios
let cancionesAmbiente = [];     // Pool de canciones navideñas para ambiente
let indicesUsados = new Set();  // Evita repetir canciones navideñas hasta agotar la lista
let reproduccionActual = null;  // { modo: 'ambiente' | 'pedido', nombre, nota, cancion, iniciadoEn, progresoMaximo }
let cambiandoCancion = false;   // Candado para evitar saltos dobles en el monitoreo

function verificarHost(req, res, next) {
    const claveUrl = req.headers['x-host-password'] || req.query.key;
    const tieneCookieValida = req.headers.cookie?.includes(`host_key=${process.env.HOST_PASSWORD}`);

    if (claveUrl === process.env.HOST_PASSWORD) {
        res.setHeader('Set-Cookie', `host_key=${process.env.HOST_PASSWORD}; Path=/; HttpOnly; SameSite=Lax`);
        return next();
    }

    if (tieneCookieValida) {
        return next();
    }

    return res.status(403).send('Acceso denegado: contraseña de Host inválida.');
}

// Ruta ligera para evitar que el servidor gratuito se suspenda
app.get('/ping', (req, res) => {
    res.status(200).send('ok');
});

// Protege la vista del panel de control
app.get('/host', verificarHost, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'host.html'));
});

// --- RUTAS DE LAS INTERFACES ---
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/tv', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'tv.html'));
});

// --- AUTENTICACIÓN CON SPOTIFY ---
app.get('/login', verificarHost, (req, res) => {
    res.redirect(spotify.generarUrlLogin());
});

app.get('/callback', async (req, res) => {
    if (req.query.error) {
        console.error('Spotify devolvió error en /callback:', req.query.error);
        return res.status(400).send(`Error de Spotify: ${req.query.error}`);
    }

    const code = req.query.code;
    if (!code) {
        return res.redirect(`/host?key=${encodeURIComponent(process.env.HOST_PASSWORD)}`);
    }

    try {
        // Guarda los tokens dentro de spotify.js para que estaAutenticado() devuelva true
        await spotify.intercambiarCodigo(code);
        console.log('Spotify conectado correctamente. Token guardado.');

        // Carga la playlist navideña de ambiente
        await cargarMusicaAmbiente();
        emitirEstadoGlobal();

        return res.redirect(`/host?key=${encodeURIComponent(process.env.HOST_PASSWORD)}`);
    } catch (err) {
        console.error('Excepción en /callback:', err.message);
        if (!res.headersSent) {
            return res.status(500).send(`Error interno conectando con Spotify: ${err.message}`);
        }
    }
});

// --- API REST PARA BÚSQUEDA Y ESTADO ---
app.get('/api/buscar', async (req, res) => {
    const q = (req.query.q || '').trim();
    if (!q) return res.json([]);

    try {
        const resultados = await spotify.buscarCanciones(q);
        res.json(resultados);
    } catch (error) {
        console.error('Error en búsqueda:', error.message);
        res.status(500).json({ error: 'No se pudo buscar en Spotify.' });
    }
});

app.get('/api/estado', (req, res) => {
    res.json({
        autenticado: spotify.estaAutenticado(),
        actual: reproduccionActual,
        cola: colaPedidos
    });
});

// --- LÓGICA DE REPRODUCCIÓN ---
async function cargarMusicaAmbiente() {
    try {
        if (PLAYLIST_ID) {
            cancionesAmbiente = await spotify.cargarPlaylistNavidena(PLAYLIST_ID);
        }
    } catch (error) {
        console.warn('No se pudo cargar la playlist por ID, usando búsqueda navideña de respaldo:', error.message);
    }

    if (cancionesAmbiente.length === 0) {
        const b1 = await spotify.buscarCanciones('Cumbias navidadeñas');
        const b2 = await spotify.buscarCanciones('Pop Navidad');
        cancionesAmbiente = [...b1, ...b2];
    }
    console.log(`Música de ambiente cargada: ${cancionesAmbiente.length} pistas listas.`);
}

function obtenerCancionAmbienteAleatoria() {
    if (cancionesAmbiente.length === 0) return null;

    if (indicesUsados.size >= cancionesAmbiente.length) {
        indicesUsados.clear();
    }

    let indice;
    do {
        indice = Math.floor(Math.random() * cancionesAmbiente.length);
    } while (indicesUsados.has(indice));

    indicesUsados.add(indice);
    return cancionesAmbiente[indice];
}

function emitirEstadoGlobal() {
    io.emit('estado_actualizado', {
        autenticado: spotify.estaAutenticado(),
        actual: reproduccionActual,
        cola: colaPedidos
    });
}

async function reproducirSiguiente() {
    if (cambiandoCancion || !spotify.estaAutenticado()) return;
    cambiandoCancion = true;

    try {
        if (cancionesAmbiente.length === 0 && colaPedidos.length === 0) {
            await cargarMusicaAmbiente();
        }

        if (colaPedidos.length > 0) {
            const siguiente = colaPedidos.shift();
            await spotify.reproducirCancion(siguiente.cancion.uri);

            reproduccionActual = {
                modo: 'pedido',
                nombre: siguiente.nombre,
                nota: siguiente.nota,
                cancion: siguiente.cancion,
                iniciadoEn: Date.now(),
                progresoMaximo: 0
            };
        } else {
            const pistaNavidena = obtenerCancionAmbienteAleatoria();
            if (pistaNavidena) {
                await spotify.reproducirCancion(pistaNavidena.uri);
                reproduccionActual = {
                    modo: 'ambiente',
                    nombre: null,
                    nota: null,
                    cancion: pistaNavidena,
                    iniciadoEn: Date.now(),
                    progresoMaximo: 0
                };
            }
        }
        emitirEstadoGlobal();
    } catch (error) {
        console.error('Error al cambiar de canción:', error.message);
        io.emit('error_host', error.message);
    } finally {
        cambiandoCancion = false;
    }
}

// --- EVENTOS EN TIEMPO REAL (SOCKET.IO) ---
io.on('connection', (socket) => {
    const claveSocket = socket.handshake.auth?.password;
    const cookieSocket = socket.handshake.headers.cookie || '';
    const esHostAutorizado =
        claveSocket === process.env.HOST_PASSWORD ||
        cookieSocket.includes(`host_key=${process.env.HOST_PASSWORD}`);

    if (esHostAutorizado) {
        socket.on('host_iniciar', () => reproducirSiguiente());
        socket.on('host_siguiente', () => reproducirSiguiente());
    }

    socket.emit('estado_actualizado', {
        autenticado: spotify.estaAutenticado(),
        actual: reproduccionActual,
        cola: colaPedidos
    });

    socket.on('nuevo_pedido', async (datos) => {
        if (!datos || !datos.nombre || !datos.cancion) return;

        const nombreLimpio = limpiarTexto(datos.nombre, 35);
        const notaLimpia = limpiarTexto(datos.nota, 120);

        if (!nombreLimpio) return;

        const pedido = {
            id: Date.now().toString(),
            nombre: nombreLimpio,
            nota: notaLimpia,
            cancion: datos.cancion
        };

        colaPedidos.push(pedido);

        if (!reproduccionActual || reproduccionActual.modo === 'ambiente') {
            await reproducirSiguiente();
        } else {
            emitirEstadoGlobal();
        }
    });
});

// --- VIGILANTE AUTOMÁTICO DE PROGRESO (Cada 3 segundos) ---
setInterval(async () => {
    if (!spotify.estaAutenticado() || !reproduccionActual || cambiandoCancion) return;

    try {
        const estado = await spotify.obtenerEstadoReproductor();
        if (!estado) return;

        if (estado.is_playing) {
            reproduccionActual.progresoMaximo = Math.max(
                reproduccionActual.progresoMaximo || 0,
                estado.progress_ms || 0
            );
            return;
        }

        // Detecta cuando la pista terminó y Spotify volvió el progreso a 0
        const yaAvanzo = (reproduccionActual.progresoMaximo || 0) > 3000;
        const tiempoTranscurrido = Date.now() - (reproduccionActual.iniciadoEn || 0) > 6000;

        if (!estado.is_playing && estado.progress_ms === 0 && (yaAvanzo || tiempoTranscurrido)) {
            await reproducirSiguiente();
        }
    } catch (err) {
        console.error('Error en vigilante:', err.message);
    }
}, 3000);

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor activo en puerto ${PORT}`);
});