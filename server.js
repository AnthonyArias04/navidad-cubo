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
let cancionesAmbiente = [];     // Pool de canciones navideñas para la mañana
let indicesUsados = new Set();  // Evita repetir canciones navideñas hasta agotar la lista
let reproduccionActual = null;  // { modo: 'ambiente' | 'pedido', nombre, nota, cancion }
let cambiandoCancion = false;   // Candado para evitar saltos dobles en el monitoreo

// Reemplaza la función anterior soloRedLocal por esta:
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

// Protege la vista del panel de control (entrarás con https://tu-app.onrender.com/host?key=clave_segura_cubo)
app.get('/host', verificarHost, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'host.html'));
});
// --- RUTAS DE LAS 3 INTERFACES ---
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/tv', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'tv.html'));
});


// --- RUTAS DE AUTENTICACIÓN SPOTIFY (Solo se usan en la PC Host) ---
app.get('/login', (req, res) => {
    res.redirect(spotify.generarUrlLogin());
});

app.get('/callback', async (req, res) => {
    res.redirect(`/host?key=${encodeURIComponent(process.env.HOST_PASSWORD)}`);
    const code = req.query.code;
    if (!code) return res.status(400).send('Falta el código de autorización.');

    try {
        await spotify.intercambiarCodigo(code);
        await cargarMusicaAmbiente();
        res.redirect('/host');
    } catch (error) {
        console.error('Error en /callback:', error.message);
        res.status(500).send('Error al conectar con Spotify: ' + error.message);
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

    // Respaldo automático: si no pusiste ID en .env o Spotify bloqueó la playlist, busca villancicos
    if (cancionesAmbiente.length === 0) {
        const b1 = await spotify.buscarCanciones('villancicos navidad');
        const b2 = await spotify.buscarCanciones('christmas classics');
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
        if (colaPedidos.length > 0) {
            // Hay solicitudes de usuarios esperando
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
            // Cola vacía: entra el Modo Ambiente (Mañana / sin pedidos)
            const pistaNavidena = obtenerCancionAmbienteAleatoria();
            if (pistaNavidena) {
                await spotify.reproducirCancion(pistaNavidena.uri);
                reproduccionActual = {
                    modo: 'ambiente',
                    nombre: null,
                    nota: null,
                    cancion: pistaNavidena
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
    // Apenas se conecta un teléfono o una TV, recibe el estado actual
    const esHostAutorizado = socket.handshake.auth?.password === process.env.HOST_PASSWORD;    
    if (esHostAutorizado) {
    socket.on('iniciar_musica', () => avanzarMusica());
    socket.on('siguiente_cancion', () => avanzarMusica());
    // ...resto de eventos exclusivos del host (eliminar de cola, pausar, etc.)
}
    socket.emit('estado_actualizado', {
        autenticado: spotify.estaAutenticado(),
        actual: reproduccionActual,
        cola: colaPedidos
    });

    // Un usuario envía una canción desde su móvil
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

        // Si estaba sonando música de ambiente (o nada), entra el pedido de inmediato
        if (!reproduccionActual || reproduccionActual.modo === 'ambiente') {
            await reproducirSiguiente();
        } else {
            emitirEstadoGlobal();
        }
    });

    // Controles manuales desde la vista /host
    socket.on('host_iniciar', async () => {
    if (!esConexionLocal) return;
    await reproducirSiguiente();
    });

    socket.on('host_siguiente', async () => {
    if (!esConexionLocal) return;
    await reproducirSiguiente();
    });
});

// --- VIGILANTE AUTOMÁTICO DE PROGRESO (Cada 3 segundos) ---
// Dentro del vigilante que revisa Spotify cada 4 segundos:
setInterval(async () => {
    if (!spotify.estaAutenticado() || pausadoManualmente) return;
    try {
        const estado = await spotify.obtenerEstado(accessToken);
        if (!estado) return;

        // Si está sonando la playlist pero ya cayó una petición en la cola, dar prioridad a la petición
        if (reproduciendoPlaylist && cola.length > 0) {
            await avanzarMusica();
            return;
        }

        // Si la pista actual terminó (no está sonando y el progreso volvió a 0)
        if (!estado.is_playing && estado.progress_ms === 0) {
            await avanzarMusica();
        }
    } catch (err) {
        console.error('Error en vigilante:', err.message);
    }
}, 4000);

server.listen(PORT, () => {
    console.log(`Servidor activo en puerto ${PORT}`);
});