require('dotenv').config();

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI;

let accessToken = null;
let refreshToken = null;
let tokenExpiraEn = 0;

function estaAutenticado() {
    return Boolean(refreshToken);
}

// 1. Genera el enlace para autorizar la cuenta Premium de la laptop Host
function generarUrlLogin() {
    const params = new URLSearchParams({
        client_id: CLIENT_ID,
        response_type: 'code',
        redirect_uri: REDIRECT_URI,
        show_dialog: 'true',
        scope: 'user-modify-playback-state user-read-playback-state user-read-currently-playing playlist-read-private playlist-read-collaborative'
    });
    return `https://accounts.spotify.com/authorize?${params.toString()}`;
}

// 2. Intercambia el código temporal de la URL por los tokens de sesión
async function intercambiarCodigo(code) {
    const authHeader = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
    const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI
    });

    const res = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Basic ${authHeader}`
        },
        body: body.toString()
    });

    const data = await res.json();
    if (!res.ok || !data.access_token) {
        throw new Error(`Error al obtener token: ${JSON.stringify(data)}`);
    }

    accessToken = data.access_token;
    if (data.refresh_token) refreshToken = data.refresh_token;
    tokenExpiraEn = Date.now() + (data.expires_in * 1000);
}

// 3. Devuelve un token vigente (lo renueva automáticamente 1 min antes de vencer)
async function obtenerTokenValido() {
    if (!refreshToken) {
        throw new Error('Spotify no ha sido autorizado todavía en el Host.');
    }

    if (Date.now() >= tokenExpiraEn - 60000) {
        const authHeader = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
        const body = new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken
        });

        const res = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': `Basic ${authHeader}`
            },
            body: body.toString()
        });

        const data = await res.json();
        if (!res.ok) {
            throw new Error(`Error al renovar token: ${JSON.stringify(data)}`);
        }

        accessToken = data.access_token;
        if (data.refresh_token) refreshToken = data.refresh_token;
        tokenExpiraEn = Date.now() + (data.expires_in * 1000);
    }

    return accessToken;
}

// Estandariza los datos de cada canción para las TVs y los celulares
function formatearCancion(track) {
    return {
        uri: track.uri,
        nombre: track.name,
        artista: track.artists.map(a => a.name).join(', '),
        imagen: track.album.images[0]?.url || '',
        duracion_ms: track.duration_ms
    };
}

// 4. Busca canciones según lo que escriba el usuario en su celular
async function buscarCanciones(consulta) {
    const token = await obtenerTokenValido();
    const params = new URLSearchParams({
        q: consulta,
        type: 'track',
        limit: '6'
    });

    const res = await fetch(`https://api.spotify.com/v1/search?${params.toString()}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });

    const data = await res.json();
    if (!res.ok) {
        throw new Error(`Error en búsqueda de Spotify: ${JSON.stringify(data)}`);
    }

    return data.tracks.items.map(formatearCancion);
}

// 5. Descarga las canciones de una playlist navideña para el modo ambiente
async function cargarPlaylistNavidena(playlistId) {
    const token = await obtenerTokenValido();
    // Limpia el ID por si la variable de entorno tiene la URL completa o ?si=...
    const idLimpio = playlistId.replace(/^.*playlist\//, '').split('?')[0].trim();

    const res = await fetch(`https://api.spotify.com/v1/playlists/${idLimpio}/tracks?limit=50`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });

    const data = await res.json();
    if (!res.ok) {
        throw new Error(`Error al cargar playlist navideña: ${JSON.stringify(data)}`);
    }

    return data.items
        .filter(item => item.track && item.track.uri)
        .map(item => formatearCancion(item.track));
}

// 6. Fuerza el cambio de canción en la app de escritorio de Spotify
async function reproducirCancion(uri) {
    const token = await obtenerTokenValido();

    const resDisp = await fetch('https://api.spotify.com/v1/me/player/devices', {
        headers: { 'Authorization': `Bearer ${token}` }
    });

    let deviceId = null;
    if (resDisp.ok) {
        const { devices } = await resDisp.json();
        const laptop =
            devices.find(d => d.is_active && d.type === 'Computer') ||
            devices.find(d => d.type === 'Computer' && !d.name.toLowerCase().includes('web player')) ||
            devices.find(d => d.is_active) ||
            devices[0];

        if (laptop) {
            deviceId = laptop.id;
            console.log(`[Spotify] Dispositivo destino: ${laptop.name} (activo: ${laptop.is_active})`);
        }
    }

    if (!deviceId) {
        throw new Error('No se detectó la app de Spotify abierta en esta laptop. Ábrela y dale Play 1 segundo.');
    }

    await fetch(`https://api.spotify.com/v1/me/player/pause?device_id=${deviceId}`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}` }
    }).catch(() => {});

    await new Promise(resolve => setTimeout(resolve, 250));

    const res = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
        method: 'PUT',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            uris: [uri],
            position_ms: 0
        })
    });

    if (res.status !== 204 && res.status !== 202) {
        const data = await res.json().catch(() => ({}));
        throw new Error(`Error al reproducir (${res.status}): ${JSON.stringify(data)}`);
    }

    await new Promise(resolve => setTimeout(resolve, 450));
    const estado = await obtenerEstadoReproductor();
    if (estado && estado.item && estado.item.uri !== uri) {
        console.log('[Spotify] Aplicando salto forzado por cola...');
        await fetch(`https://api.spotify.com/v1/me/player/queue?uri=${encodeURIComponent(uri)}&device_id=${deviceId}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        await fetch(`https://api.spotify.com/v1/me/player/next?device_id=${deviceId}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
    }

    return true;
}

// 7. Consulta el progreso actual para saber cuándo terminó la pista
async function obtenerEstadoReproductor() {
    const token = await obtenerTokenValido();
    const res = await fetch('https://api.spotify.com/v1/me/player', {
        headers: { 'Authorization': `Bearer ${token}` }
    });

    if (res.status === 204 || !res.ok) return null;
    return await res.json();
}

module.exports = {
    estaAutenticado,
    generarUrlLogin,
    intercambiarCodigo,
    buscarCanciones,
    cargarPlaylistNavidena,
    reproducirCancion,
    obtenerEstadoReproductor
};